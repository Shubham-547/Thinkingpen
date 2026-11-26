import { apiFetch, esc, formatInr } from './api.js';

function highlightMatchHtml(text, rawQuery) {
  const safeText = esc(text || '');
  const tokens = String(rawQuery || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 5);
  if (tokens.length === 0) return safeText;

  // Match safely against already HTML-escaped text on word fragments >= 2 chars
  const escapedTokens = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escapedTokens.join('|')})`, 'gi');
  return safeText.replace(
    regex,
    '<mark class="bg-indigo-100/80 dark:bg-sky-900/60 text-[#3a1fc7] dark:text-sky-200 rounded px-0.5 font-semibold">$1</mark>'
  );
}

/**
 * Attaches Google/YouTube-style categorized Smart Search autocomplete to any ScholarPress search form.
 */
export function attachSmartSearch({
  formEl,
  inputEl,
  onSelectQuery,
  dropdownAlign = 'left',
  minDropdownWidthClass = 'w-full',
} = {}) {
  if (!formEl || !inputEl) return () => {};
  if (inputEl.dataset.smartSearchBound === '1') return () => {};
  inputEl.dataset.smartSearchBound = '1';

  // Ensure form parent can position dropdown cleanly
  if (window.getComputedStyle(formEl).position === 'static') {
    formEl.style.position = 'relative';
  }

  // Inject clear button & tiny spinner right after inputEl (before submit button)
  const controlsWrap = document.createElement('span');
  controlsWrap.className = 'inline-flex items-center gap-1 shrink-0 mr-1';
  controlsWrap.innerHTML = `
    <span class="sp-ss-spinner hidden w-3.5 h-3.5 rounded-full border-2 border-indigo-200 border-t-[#5a1fd8] dark:border-slate-700 dark:border-t-sky-400 animate-spin" aria-hidden="true"></span>
    <button type="button" class="sp-ss-clear hidden p-1 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" aria-label="Clear search">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>
  `;
  inputEl.insertAdjacentElement('afterend', controlsWrap);

  const spinnerEl = controlsWrap.querySelector('.sp-ss-spinner');
  const clearBtn = controlsWrap.querySelector('.sp-ss-clear');

  const dropdownEl = document.createElement('div');
  dropdownEl.className = `hidden absolute ${
    dropdownAlign === 'right' ? 'right-0' : 'left-0'
  } top-full mt-2 z-50 ${minDropdownWidthClass} max-w-[94vw] bg-white dark:bg-[#111A2E] border border-indigo-100 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden text-left`;
  dropdownEl.setAttribute('role', 'listbox');
  formEl.appendChild(dropdownEl);

  let debounceTimer = null;
  let activeAbort = null;
  let activeIndex = -1;
  let flatOptions = [];

  const updateClearVisibility = () => {
    if (!clearBtn) return;
    clearBtn.classList.toggle('hidden', !inputEl.value.trim());
  };

  const closeDropdown = () => {
    dropdownEl.classList.add('hidden');
    activeIndex = -1;
  };

  const triggerQuerySelect = (queryText) => {
    const clean = String(queryText || '').trim();
    inputEl.value = clean;
    updateClearVisibility();
    closeDropdown();
    if (typeof onSelectQuery === 'function') {
      onSelectQuery(clean);
    } else {
      window.location.hash = clean ? `#/explore?q=${encodeURIComponent(clean)}` : '#/explore';
    }
  };

  const highlightActiveOption = () => {
    const els = dropdownEl.querySelectorAll('[data-ss-idx]');
    els.forEach((el) => {
      const idx = Number(el.dataset.ssIdx);
      const isAct = idx === activeIndex;
      el.classList.toggle('bg-indigo-50/90', isAct);
      el.classList.toggle('dark:bg-slate-800/90', isAct);
    });
  };

  const renderSuggestions = (data, rawQ) => {
    flatOptions = [];
    const sections = [];
    let itemIdx = 0;

    if (Array.isArray(data.recentSearches) && data.recentSearches.length > 0) {
      sections.push(`
        <div class="py-1.5">
          <div class="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Recent Searches</div>
          ${data.recentSearches
            .map((rq) => {
              const idx = itemIdx++;
              flatOptions.push({ type: 'query', value: rq });
              return `
                <button type="button" data-ss-idx="${idx}" class="w-full px-3.5 py-2 flex items-center gap-2.5 text-left text-xs sm:text-sm text-slate-700 dark:text-slate-200 hover:bg-indigo-50/70 dark:hover:bg-slate-800/70 transition-colors">
                  <svg class="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  <span class="truncate">${highlightMatchHtml(rq, rawQ)}</span>
                </button>
              `;
            })
            .join('')}
        </div>
      `);
    }

    if (Array.isArray(data.suggestedSearches) && data.suggestedSearches.length > 0) {
      sections.push(`
        <div class="py-1.5">
          <div class="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Suggested Searches</div>
          ${data.suggestedSearches
            .map((sq) => {
              const idx = itemIdx++;
              flatOptions.push({ type: 'query', value: sq });
              return `
                <button type="button" data-ss-idx="${idx}" class="w-full px-3.5 py-2 flex items-center gap-2.5 text-left text-xs sm:text-sm text-slate-800 dark:text-slate-100 hover:bg-indigo-50/70 dark:hover:bg-slate-800/70 transition-colors">
                  <svg class="w-3.5 h-3.5 text-[#5a1fd8] dark:text-sky-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                  <span class="truncate">${highlightMatchHtml(sq, rawQ)}</span>
                </button>
              `;
            })
            .join('')}
        </div>
      `);
    }

    if (Array.isArray(data.matchingVideos) && data.matchingVideos.length > 0) {
      sections.push(`
        <div class="py-1.5">
          <div class="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Matching Videos &amp; Resources</div>
          ${data.matchingVideos
            .map((mv) => {
              const idx = itemIdx++;
              const href = `#/content/${encodeURIComponent(mv.slug)}`;
              flatOptions.push({ type: 'href', value: href });
              const subMeta = [mv.classLevel, mv.subjectName || mv.categoryName, mv.contentType, mv.creatorName]
                .filter(Boolean)
                .slice(0, 3)
                .join(' · ');
              return `
                <a href="${href}" data-ss-idx="${idx}" class="w-full px-3.5 py-2 flex items-center justify-between gap-3 text-left hover:bg-indigo-50/70 dark:hover:bg-slate-800/70 transition-colors">
                  <div class="min-w-0 flex-1">
                    <div class="text-xs sm:text-sm font-medium text-slate-900 dark:text-white truncate">${highlightMatchHtml(mv.title, rawQ)}</div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${esc(subMeta)}</div>
                  </div>
                  <span class="text-[11px] font-mono font-semibold shrink-0 ${
                    mv.isFree ? 'text-emerald-700 dark:text-emerald-400' : 'text-[#0F2547] dark:text-sky-300'
                  }">${mv.isFree ? 'Free' : formatInr(mv.priceInr)}</span>
                </a>
              `;
            })
            .join('')}
        </div>
      `);
    }

    if (Array.isArray(data.subjects) && data.subjects.length > 0) {
      sections.push(`
        <div class="py-1.5">
          <div class="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Subjects &amp; Categories</div>
          ${data.subjects
            .map((sb) => {
              const idx = itemIdx++;
              const href =
                sb.kind === 'category'
                  ? `#/explore?category=${encodeURIComponent(sb.slug)}`
                  : `#/explore?subject=${encodeURIComponent(sb.slug)}`;
              flatOptions.push({ type: 'href', value: href });
              return `
                <a href="${href}" data-ss-idx="${idx}" class="w-full px-3.5 py-2 flex items-center justify-between gap-2 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-indigo-50/70 dark:hover:bg-slate-800/70 transition-colors">
                  <span class="truncate">${highlightMatchHtml(sb.name, rawQ)}</span>
                  <span class="text-[10px] text-slate-400 uppercase shrink-0">${esc(sb.kind)}</span>
                </a>
              `;
            })
            .join('')}
        </div>
      `);
    }

    if (Array.isArray(data.chaptersAndTopics) && data.chaptersAndTopics.length > 0) {
      sections.push(`
        <div class="py-1.5">
          <div class="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Chapters &amp; Topics</div>
          ${data.chaptersAndTopics
            .map((ct) => {
              const idx = itemIdx++;
              flatOptions.push({ type: 'query', value: ct.query });
              return `
                <button type="button" data-ss-idx="${idx}" class="w-full px-3.5 py-2 flex items-center gap-2.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-indigo-50/70 dark:hover:bg-slate-800/70 transition-colors">
                  <svg class="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
                  <span class="truncate">${highlightMatchHtml(ct.label, rawQ)}</span>
                </button>
              `;
            })
            .join('')}
        </div>
      `);
    }

    if (Array.isArray(data.popularSearches) && data.popularSearches.length > 0) {
      sections.push(`
        <div class="py-1.5">
          <div class="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Popular Searches</div>
          ${data.popularSearches
            .map((pq) => {
              const idx = itemIdx++;
              flatOptions.push({ type: 'query', value: pq });
              return `
                <button type="button" data-ss-idx="${idx}" class="w-full px-3.5 py-2 flex items-center gap-2.5 text-left text-xs sm:text-sm text-slate-700 dark:text-slate-200 hover:bg-indigo-50/70 dark:hover:bg-slate-800/70 transition-colors">
                  <svg class="w-3.5 h-3.5 text-orange-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
                  <span class="truncate">${esc(pq)}</span>
                </button>
              `;
            })
            .join('')}
        </div>
      `);
    }

    if (sections.length === 0) {
      closeDropdown();
      return;
    }

    dropdownEl.innerHTML = `<div class="max-h-[65vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">${sections.join('')}</div>`;
    activeIndex = -1;
    dropdownEl.classList.remove('hidden');

    dropdownEl.querySelectorAll('[data-ss-idx]').forEach((el) => {
      el.addEventListener('click', (e) => {
        const opt = flatOptions[Number(el.dataset.ssIdx)];
        if (!opt) return;
        if (opt.type === 'query') {
          e.preventDefault();
          triggerQuerySelect(opt.value);
        } else {
          closeDropdown();
        }
      });
    });
  };

  const fetchSuggestions = async (rawQ) => {
    if (activeAbort) {
      try {
        activeAbort.abort();
      } catch {}
    }
    activeAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    spinnerEl?.classList.remove('hidden');

    try {
      const data = await apiFetch(
        `/api/search/suggestions?q=${encodeURIComponent(rawQ)}`,
        { signal: activeAbort?.signal, noCache: true }
      );
      renderSuggestions(data, rawQ);
    } catch (err) {
      if (err?.name !== 'AbortError') closeDropdown();
    } finally {
      spinnerEl?.classList.add('hidden');
    }
  };

  const onInput = () => {
    updateClearVisibility();
    clearTimeout(debounceTimer);
    const val = inputEl.value.trim();
    debounceTimer = setTimeout(() => fetchSuggestions(val), val ? 240 : 120);
  };

  const onFocus = () => {
    updateClearVisibility();
    fetchSuggestions(inputEl.value.trim());
  };

  const onKeyDown = (e) => {
    if (dropdownEl.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      closeDropdown();
      return;
    }
    if (e.key === 'ArrowDown') {
      if (flatOptions.length === 0) return;
      e.preventDefault();
      activeIndex = (activeIndex + 1) % flatOptions.length;
      highlightActiveOption();
      return;
    }
    if (e.key === 'ArrowUp') {
      if (flatOptions.length === 0) return;
      e.preventDefault();
      activeIndex = activeIndex <= 0 ? flatOptions.length - 1 : activeIndex - 1;
      highlightActiveOption();
      return;
    }
    if (e.key === 'Enter' && activeIndex >= 0 && flatOptions[activeIndex]) {
      e.preventDefault();
      const opt = flatOptions[activeIndex];
      if (opt.type === 'query') {
        triggerQuerySelect(opt.value);
      } else {
        closeDropdown();
        window.location.hash = opt.value;
      }
    }
  };

  const onClear = () => {
    inputEl.value = '';
    updateClearVisibility();
    inputEl.focus();
    fetchSuggestions('');
  };

  const onDocClick = (e) => {
    if (!formEl.contains(e.target)) {
      closeDropdown();
    }
  };

  const onSubmitClose = () => {
    clearTimeout(debounceTimer);
    closeDropdown();
  };

  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('focus', onFocus);
  inputEl.addEventListener('keydown', onKeyDown);
  clearBtn?.addEventListener('click', onClear);
  formEl.addEventListener('submit', onSubmitClose);
  document.addEventListener('click', onDocClick);
  updateClearVisibility();

  return () => {
    clearTimeout(debounceTimer);
    if (activeAbort) {
      try {
        activeAbort.abort();
      } catch {}
    }
    inputEl.removeEventListener('input', onInput);
    inputEl.removeEventListener('focus', onFocus);
    inputEl.removeEventListener('keydown', onKeyDown);
    clearBtn?.removeEventListener('click', onClear);
    formEl.removeEventListener('submit', onSubmitClose);
    document.removeEventListener('click', onDocClick);
  };
}
