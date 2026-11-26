import {
  apiFetch,
  esc,
  formatBytes,
  formatDate,
  formatDateTime,
  formatDurationShort,
  formatInr,
  getAuthToken,
  getResponsiveImageSources,
  openImageLightbox,
  openModal,
  resolveVideoEmbed,
  showToast,
  store,
} from './api.js';

export const draftsListState = {
  q: '',
  typeGroup: 'all', // 'all' | 'articles' | 'videos' | 'pdfs'
  subjectId: '',
  categoryId: '',
  sort: 'newest', // 'newest' | 'oldest' | 'relevant'
  userPickedSort: false,
  page: 1,
  limit: 9,
  filtersOpen: false,
  scrollY: 0,
};

let activeDraftMenuCleanup = null;

export function cleanupDraftFloatingMenu() {
  if (activeDraftMenuCleanup) {
    activeDraftMenuCleanup();
    activeDraftMenuCleanup = null;
  }
}

export function buildDraftsListUrl() {
  const qs = new URLSearchParams();
  const qTrim = draftsListState.q.trim();
  if (qTrim) qs.set('q', qTrim);
  if (draftsListState.typeGroup && draftsListState.typeGroup !== 'all') {
    qs.set('typeGroup', draftsListState.typeGroup);
  }
  if (draftsListState.subjectId) qs.set('subjectId', draftsListState.subjectId);
  if (draftsListState.categoryId) qs.set('categoryId', draftsListState.categoryId);

  const effectiveSort =
    qTrim && !draftsListState.userPickedSort ? 'relevant' : draftsListState.sort || 'newest';
  qs.set('sort', effectiveSort);
  qs.set('page', String(draftsListState.page || 1));
  qs.set('limit', String(draftsListState.limit || 9));
  return `/api/creator/drafts?${qs.toString()}`;
}

function hasActiveDraftFilters() {
  return Boolean(
    draftsListState.q.trim() ||
      draftsListState.typeGroup !== 'all' ||
      draftsListState.subjectId ||
      draftsListState.categoryId ||
      draftsListState.sort !== 'newest'
  );
}

function getCompactTypeMeta(c) {
  const group = c.typeGroup || (
    c.contentType === 'Video Lectures' || c.contentType === 'Online Tutorials'
      ? 'videos'
      : c.contentType === 'PDF / Documents' || c.contentType === 'E-books'
      ? 'pdfs'
      : 'articles'
  );
  if (group === 'videos') {
    return {
      group,
      shortLabel: c.contentType === 'Online Tutorials' ? 'Tutorial' : 'Video',
      badgeCls: 'bg-violet-50 text-[#5a1fd8] dark:bg-violet-950/60 dark:text-violet-300',
      iconPath:
        'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    };
  }
  if (group === 'pdfs') {
    return {
      group,
      shortLabel: c.contentType === 'E-books' ? 'E-Book' : 'PDF',
      badgeCls: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
      iconPath:
        'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z',
    };
  }
  return {
    group,
    shortLabel:
      c.contentType === 'Articles'
        ? 'Article'
        : c.contentType === 'Notes'
        ? 'Notes'
        : c.contentType || 'Article',
    badgeCls: 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
    iconPath:
      'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  };
}

function renderDraftMediaHtml(c, isMobileCompact = false) {
  const meta = getCompactTypeMeta(c);
  const isVideo = meta.group === 'videos';
  const sizeCls = isMobileCompact
    ? 'w-32 h-24 rounded-xl'
    : 'aspect-[16/9] w-full rounded-t-2xl';
  const fallbackBg =
    meta.group === 'videos'
      ? 'bg-gradient-to-br from-[#1b1046] via-[#341a86] to-[#0f172a]'
      : meta.group === 'pdfs'
      ? 'bg-gradient-to-br from-[#2a1638] via-[#4c1d95] to-[#1e1b4b]'
      : 'bg-gradient-to-br from-[#1e1b4b] via-[#3730a3] to-[#312e81]';

  const fallbackInner = `
    <div class="w-full h-full ${fallbackBg} flex flex-col justify-between p-3 text-white select-none">
      <div class="flex items-center justify-end">
        <span class="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/15">${esc(meta.shortLabel)}</span>
      </div>
      <div class="font-display ${isMobileCompact ? 'text-xs' : 'text-sm'} font-semibold leading-snug line-clamp-2">${esc(c.title)}</div>
    </div>
  `;

  let imgHtml = fallbackInner;
  if (c.coverImageUrl) {
    const sources = getResponsiveImageSources(c.coverImageUrl, isMobileCompact ? 320 : 480);
    const src = sources?.fallbackSrc || c.coverImageUrl;
    imgHtml = `
      <img
        src="${esc(src)}"
        alt="${esc(c.title)}"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
      />
      <div style="display:none" class="absolute inset-0 ${fallbackBg} flex-col justify-between p-3 text-white select-none">
        <div class="flex items-center justify-end">
          <span class="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/15">${esc(meta.shortLabel)}</span>
        </div>
        <div class="font-display ${isMobileCompact ? 'text-xs' : 'text-sm'} font-semibold leading-snug line-clamp-2">${esc(c.title)}</div>
      </div>
    `;
  }

  return `
    <div class="${sizeCls} relative overflow-hidden bg-slate-100 dark:bg-slate-900 shrink-0">
      <a href="#/creator/drafts/${c.id}/preview" class="drf-nav-preview block w-full h-full" data-id="${c.id}">
        ${imgHtml}
      </a>
      <span class="pointer-events-none absolute top-2 left-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#5a1fd8]/90 text-white shadow-sm">
        Draft
      </span>
      ${
        isVideo
          ? `<a href="#/creator/drafts/${c.id}/preview" aria-label="Preview video" class="drf-nav-preview absolute inset-0 m-auto w-10 h-10 rounded-full bg-slate-950/65 text-white border border-white/40 flex items-center justify-center hover:scale-105 transition-transform" data-id="${c.id}">
              <svg class="w-4.5 h-4.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </a>`
          : ''
      }
      ${
        !isMobileCompact
          ? `<button
              type="button"
              data-id="${c.id}"
              aria-label="More actions for ${esc(c.title)}"
              aria-haspopup="menu"
              aria-expanded="false"
              class="drf-menu-trigger absolute top-2 right-2 w-9 h-9 rounded-full bg-white/95 dark:bg-[#111A2E]/95 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700 shadow-sm flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 transition-colors"
            >
              <svg class="w-4.5 h-4.5" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="12" cy="19" r="1.75"/></svg>
            </button>`
          : ''
      }
    </div>
  `;
}

function renderPaginationPages(currentPage, totalPages) {
  if (totalPages <= 1) return '';
  const pages = [];
  const start = Math.max(1, currentPage - 1);
  const end = Math.min(totalPages, currentPage + 1);
  for (let p = start; p <= end; p += 1) {
    pages.push(p);
  }
  return pages
    .map(
      (p) => `
      <button
        type="button"
        data-page="${p}"
        class="drf-page-btn min-w-[36px] min-h-[36px] px-2.5 text-xs font-semibold rounded-lg border transition-colors tabular-nums ${
          p === currentPage
            ? 'bg-[#5a1fd8] border-[#5a1fd8] text-white'
            : 'bg-white dark:bg-[#111A2E] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
        }"
      >
        ${p}
      </button>
    `
    )
    .join('');
}

function renderDraftsDynamicRegionHtml(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const counts = payload?.counts || { all: 0, articles: 0, videos: 0, pdfs: 0 };
  const pagination = payload?.pagination || { page: 1, limit: 9, total: items.length, totalPages: 1 };
  const meta = payload?.filtersMeta || { categories: [], subjects: [] };

  const subjOptions = (store.subjects?.length ? store.subjects : meta.subjects || []);
  const catOptions = (store.categories?.length ? store.categories : meta.categories || []);

  const startIdx = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const endIdx = Math.min(pagination.total, pagination.page * pagination.limit);
  const isFiltered = hasActiveDraftFilters();

  const typeTabs = [
    {
      key: 'all',
      label: 'All Drafts',
      count: counts.all,
      icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    },
    {
      key: 'articles',
      label: 'Articles',
      count: counts.articles,
      icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2',
    },
    {
      key: 'videos',
      label: 'Videos',
      count: counts.videos,
      icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    {
      key: 'pdfs',
      label: 'PDFs',
      count: counts.pdfs,
      icon: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z',
    },
  ];

  return `
    <!-- Filter Strip: Type Pills + Subject / Category / Sort -->
    <div class="space-y-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5 max-w-full">
          ${typeTabs
            .map((t) => {
              const active = draftsListState.typeGroup === t.key;
              return `
                <button
                  type="button"
                  data-type-group="${t.key}"
                  class="drf-type-btn min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                    active
                      ? 'bg-[#5a1fd8] border-[#5a1fd8] text-white'
                      : 'bg-white dark:bg-[#111A2E] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
                  }"
                >
                  <svg class="w-3.5 h-3.5 shrink-0 ${active ? 'text-white' : 'text-slate-500 dark:text-slate-400'}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${t.icon}"/></svg>
                  <span>${esc(t.label)}</span>
                  <span class="px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${
                    active
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }">${t.count}</span>
                </button>
              `;
            })
            .join('')}
        </div>

        <!-- Desktop inline Subject / Category / Sort dropdowns -->
        <div class="hidden sm:flex flex-wrap items-center gap-2 ml-auto">
          <select
            id="drf-subject-select-desktop"
            aria-label="Filter by Subject"
            class="drf-subject-select min-h-[38px] px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-[#5a1fd8] dark:focus:border-sky-400"
          >
            <option value="">By Subject</option>
            ${subjOptions
              .map(
                (s) =>
                  `<option value="${s.id}" ${String(draftsListState.subjectId) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`
              )
              .join('')}
          </select>

          <select
            id="drf-category-select-desktop"
            aria-label="Filter by Category"
            class="drf-category-select min-h-[38px] px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-[#5a1fd8] dark:focus:border-sky-400"
          >
            <option value="">By Category</option>
            ${catOptions
              .map(
                (c) =>
                  `<option value="${c.id}" ${String(draftsListState.categoryId) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`
              )
              .join('')}
          </select>

          <select
            id="drf-sort-select-desktop"
            aria-label="Sort drafts"
            class="drf-sort-select min-h-[38px] px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-[#5a1fd8] dark:focus:border-sky-400"
          >
            <option value="newest" ${draftsListState.sort === 'newest' ? 'selected' : ''}>Sort: Newest First</option>
            <option value="oldest" ${draftsListState.sort === 'oldest' ? 'selected' : ''}>Sort: Oldest First</option>
          </select>
        </div>
      </div>

      <!-- Mobile expandable Filters panel -->
      <div id="drf-mobile-filters-panel" class="${draftsListState.filtersOpen ? 'grid sm:hidden' : 'hidden'} grid-cols-1 gap-2 p-3 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
        <select
          id="drf-subject-select-mobile"
          aria-label="Filter by Subject"
          class="drf-subject-select w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs font-medium text-slate-700 dark:text-slate-200"
        >
          <option value="">By Subject</option>
          ${subjOptions
            .map(
              (s) =>
                `<option value="${s.id}" ${String(draftsListState.subjectId) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`
            )
            .join('')}
        </select>

        <select
          id="drf-category-select-mobile"
          aria-label="Filter by Category"
          class="drf-category-select w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs font-medium text-slate-700 dark:text-slate-200"
        >
          <option value="">By Category</option>
          ${catOptions
            .map(
              (c) =>
                `<option value="${c.id}" ${String(draftsListState.categoryId) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`
            )
            .join('')}
        </select>

        <select
          id="drf-sort-select-mobile"
          aria-label="Sort drafts"
          class="drf-sort-select w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs font-medium text-slate-700 dark:text-slate-200"
        >
          <option value="newest" ${draftsListState.sort === 'newest' ? 'selected' : ''}>Sort: Newest First</option>
          <option value="oldest" ${draftsListState.sort === 'oldest' ? 'selected' : ''}>Sort: Oldest First</option>
        </select>
      </div>
    </div>

    <!-- Draft Cards Grid / List -->
    ${
      items.length
        ? `<div id="drf-cards-grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            ${items
              .map((c) => {
                const tmeta = getCompactTypeMeta(c);
                const createdLabel = formatDate(c.createdAt);
                const updatedSameAsCreated =
                  !c.updatedAt ||
                  Math.abs(new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()) < 60_000;
                const updatedLabel = updatedSameAsCreated ? '—' : formatDate(c.updatedAt);
                const secondaryTag = c.classLevel || c.subjectName || c.categoryName || '';

                return `
                  <article data-content-id="${c.id}" class="group bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden flex flex-col hover:border-slate-300 dark:hover:border-slate-700 transition-colors shadow-xs">
                    <!-- Desktop/Tablet vertical top cover -->
                    <div class="hidden sm:block">
                      ${renderDraftMediaHtml(c, false)}
                    </div>

                    <!-- Desktop/Tablet Card Body -->
                    <div class="hidden sm:flex flex-col flex-1 p-4 space-y-2.5">
                      <a href="#/creator/drafts/${c.id}/preview" class="drf-nav-preview font-display text-base font-semibold text-slate-900 dark:text-white hover:text-[#5a1fd8] dark:hover:text-sky-300 leading-snug line-clamp-2" data-id="${c.id}">
                        ${esc(c.title)}
                      </a>
                      <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">
                        ${esc(c.shortDescription)}
                      </p>

                      <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${tmeta.badgeCls}">
                          <svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${tmeta.iconPath}"/></svg>
                          ${esc(tmeta.shortLabel)}
                        </span>
                        ${
                          secondaryTag
                            ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-indigo-50 text-indigo-700 dark:bg-slate-800 dark:text-slate-200 truncate max-w-[140px]">${esc(secondaryTag)}</span>`
                            : ''
                        }
                        ${
                          !c.isFree
                            ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 tabular-nums">${formatInr(c.priceInr)}</span>`
                            : ''
                        }
                      </div>

                      <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-1 mt-auto">
                        <span>Created: <strong class="font-medium text-slate-700 dark:text-slate-300">${esc(createdLabel)}</strong></span>
                        <span>Updated: <strong class="font-medium text-slate-700 dark:text-slate-300">${esc(updatedLabel)}</strong></span>
                      </div>

                      <div class="grid grid-cols-2 gap-2.5 pt-2">
                        <a
                          href="#/creator/drafts/${c.id}/preview"
                          data-id="${c.id}"
                          class="drf-nav-preview min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 dark:bg-[#0B1120] dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors"
                        >
                          <svg class="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                          <span>Preview</span>
                        </a>
                        <a
                          href="#/creator/edit/${c.id}?from=drafts"
                          data-id="${c.id}"
                          class="drf-nav-edit min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white text-xs font-semibold transition-colors"
                        >
                          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                          <span>Edit</span>
                        </a>
                      </div>
                    </div>

                    <!-- Mobile Horizontal Card Layout -->
                    <div class="sm:hidden p-3.5 space-y-3">
                      <div class="flex items-start gap-3">
                        ${renderDraftMediaHtml(c, true)}
                        <div class="min-w-0 flex-1">
                          <div class="flex items-start justify-between gap-1.5">
                            <a href="#/creator/drafts/${c.id}/preview" class="drf-nav-preview font-display text-sm font-semibold text-slate-900 dark:text-white leading-snug line-clamp-2" data-id="${c.id}">
                              ${esc(c.title)}
                            </a>
                            <button
                              type="button"
                              data-id="${c.id}"
                              aria-label="More actions for ${esc(c.title)}"
                              aria-haspopup="menu"
                              aria-expanded="false"
                              class="drf-menu-trigger min-w-[40px] min-h-[40px] -mr-2 -mt-1.5 flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                            >
                              <svg class="w-4.5 h-4.5" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="12" cy="19" r="1.75"/></svg>
                            </button>
                          </div>
                          <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                            ${esc(c.shortDescription)}
                          </p>
                          <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold ${tmeta.badgeCls}">
                              ${esc(tmeta.shortLabel)}
                            </span>
                            ${
                              secondaryTag
                                ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-medium bg-indigo-50 text-indigo-700 dark:bg-slate-800 dark:text-slate-200 truncate max-w-[115px]">${esc(secondaryTag)}</span>`
                                : ''
                            }
                          </div>
                        </div>
                      </div>

                      <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                        <span>Created: ${esc(createdLabel)}</span>
                        <span>Updated: ${esc(updatedLabel)}</span>
                      </div>

                      <div class="grid grid-cols-2 gap-2">
                        <a
                          href="#/creator/drafts/${c.id}/preview"
                          data-id="${c.id}"
                          class="drf-nav-preview min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100 text-xs font-semibold"
                        >
                          <span>Preview</span>
                        </a>
                        <a
                          href="#/creator/edit/${c.id}?from=drafts"
                          data-id="${c.id}"
                          class="drf-nav-edit min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#5a1fd8] text-white text-xs font-semibold"
                        >
                          <span>Edit</span>
                        </a>
                      </div>
                    </div>
                  </article>
                `;
              })
              .join('')}
          </div>`
        : counts.all === 0
        ? `<div class="bg-white dark:bg-[#111A2E] border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center space-y-3">
            <div class="w-12 h-12 rounded-2xl bg-violet-50 dark:bg-violet-950/60 text-[#5a1fd8] dark:text-violet-300 flex items-center justify-center mx-auto">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            </div>
            <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">No Draft Content Yet</h2>
            <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">Create your first content and save it as a draft to refine, preview, and publish anytime.</p>
            <div class="pt-1">
              <a href="#/creator/upload" class="inline-flex items-center gap-1.5 min-h-[42px] px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white transition-colors">
                + Upload New Content
              </a>
            </div>
          </div>`
        : `<div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center space-y-3">
            <h2 class="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white">No matching drafts found</h2>
            <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400">Try a different search phrase or clear your active filters.</p>
            ${
              isFiltered
                ? `<button type="button" id="drf-empty-clear-btn" class="min-h-[40px] px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
                    Clear Filters
                  </button>`
                : ''
            }
          </div>`
    }

    <!-- Pagination Footer -->
    ${
      pagination.total > 0
        ? `<div class="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              Showing <strong class="text-slate-800 dark:text-slate-200">${startIdx}–${endIdx}</strong> of <strong class="text-slate-800 dark:text-slate-200">${pagination.total}</strong> draft${pagination.total === 1 ? '' : 's'}
            </div>
            ${
              pagination.totalPages > 1
                ? `<div class="flex items-center gap-1.5">
                    <button
                      type="button"
                      data-page="${pagination.page - 1}"
                      ${pagination.page <= 1 ? 'disabled' : ''}
                      aria-label="Previous page"
                      class="drf-page-btn min-w-[36px] min-h-[36px] px-2.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      ‹
                    </button>
                    ${renderPaginationPages(pagination.page, pagination.totalPages)}
                    <button
                      type="button"
                      data-page="${pagination.page + 1}"
                      ${pagination.page >= pagination.totalPages ? 'disabled' : ''}
                      aria-label="Next page"
                      class="drf-page-btn min-w-[36px] min-h-[36px] px-2.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      ›
                    </button>
                  </div>`
                : ''
            }
          </div>`
        : ''
    }
  `;
}

export function renderDraftContentSectionHtml(payload) {
  return `
    <div id="drf-list-root" class="space-y-4 sm:space-y-5">
      <!-- Page Header -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-start gap-3 min-w-0">
          <div class="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-violet-50 dark:bg-violet-950/60 text-[#5a1fd8] dark:text-violet-300 flex items-center justify-center shrink-0 mt-0.5 border border-violet-100 dark:border-violet-900/50">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          </div>
          <div class="min-w-0">
            <h1 class="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white leading-tight">Draft Content</h1>
            <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">Manage your draft content and complete them before publishing.</p>
          </div>
        </div>
        <a
          href="#/creator/upload"
          class="inline-flex items-center gap-1.5 min-h-[42px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white transition-colors whitespace-nowrap shrink-0 shadow-xs"
        >
          <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
          <span>+ Upload New Content</span>
        </a>
      </div>

      <!-- Simple Clean Search Input + Clear / Mobile Filters Buttons -->
      <div class="flex flex-col sm:flex-row sm:items-center gap-2.5">
        <div class="relative flex-1 flex items-center">
          <svg class="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35"/></svg>
          <input
            type="search"
            id="drf-search-input"
            value="${esc(draftsListState.q)}"
            placeholder="Search content..."
            autocomplete="off"
            class="w-full min-h-[44px] pl-10 pr-10 py-2 text-sm rounded-full sm:rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#5a1fd8] dark:focus:border-sky-400"
          />
          <button
            type="button"
            id="drf-search-clear"
            aria-label="Clear search"
            class="${draftsListState.q ? 'flex' : 'hidden'} absolute right-2 w-8 h-8 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="flex items-center justify-center sm:justify-end gap-2 shrink-0">
          <button
            type="button"
            id="drf-clear-all-btn"
            class="min-h-[40px] sm:min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            <svg class="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            <span>Clear</span>
          </button>

          <button
            type="button"
            id="drf-filters-toggle"
            aria-expanded="${draftsListState.filtersOpen ? 'true' : 'false'}"
            class="sm:hidden min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap ${
              draftsListState.filtersOpen || draftsListState.subjectId || draftsListState.categoryId || draftsListState.sort !== 'newest'
                ? 'border-[#5a1fd8] text-[#5a1fd8] bg-violet-50/70 dark:border-sky-400 dark:text-sky-300 dark:bg-sky-950/40'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-700 dark:text-slate-200'
            }"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>
            <span>Filters</span>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
          </button>
        </div>
      </div>

      <!-- Dynamic Region (preserves search input focus during typing) -->
      <div id="drf-dynamic-region" class="space-y-4 sm:space-y-5">
        ${renderDraftsDynamicRegionHtml(payload)}
      </div>
    </div>
  `;
}

export async function renderDraftPreviewHtml(payload) {
  const c = payload?.content;
  const files = Array.isArray(payload?.files) ? payload.files : [];

  if (!c) {
    return `
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center space-y-3">
        <div class="text-base font-semibold text-slate-900 dark:text-white">Draft preview unavailable</div>
        <p class="text-xs text-slate-500 dark:text-slate-400">This draft could not be found or has been moved to the Recovery Bin.</p>
        <a href="#/creator/drafts" class="inline-flex items-center px-4 py-2 text-xs font-semibold rounded-xl bg-[#5a1fd8] text-white">← Back to Drafts</a>
      </div>
    `;
  }

  const authToken = await getAuthToken();
  const withAuthParam = (url) => {
    if (!url) return '';
    if (url.includes('ft=')) return url;
    if (!authToken) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(authToken)}`;
  };

  const tmeta = getCompactTypeMeta(c);
  const pdfFiles = files.filter((f) => f.fileType === 'pdf');
  const videoFiles = files.filter((f) => f.fileType === 'video');
  const imageFiles = files.filter((f) => f.fileType === 'image');
  const docFiles = files.filter((f) => f.fileType === 'document');

  const plainBody = String(c.bodyHtml || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasProse = plainBody.length > 0;
  const isLongProse = plainBody.length > 320;
  const hasAnyContent = hasProse || files.length > 0;

  const createdStr = formatDate(c.createdAt);
  const updatedStr = formatDate(c.updatedAt || c.createdAt);
  const subjectCat = [c.subjectName || c.categoryName, c.classLevel].filter(Boolean);

  return `
    <div id="drf-preview-root" class="space-y-4 sm:space-y-5 max-w-4xl mx-auto">
      <!-- Top Header Bar matching Draft Preview Layout -->
      <div class="flex items-start gap-3">
        <a
          href="#/creator/drafts"
          aria-label="Back to Drafts"
          class="min-w-[42px] min-h-[42px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shrink-0"
        >
          <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
        </a>
        <div class="w-10 h-10 rounded-full bg-violet-50 dark:bg-violet-950/60 text-[#5a1fd8] dark:text-violet-300 flex items-center justify-center shrink-0">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
        </div>
        <div class="min-w-0">
          <h1 class="font-display text-lg sm:text-2xl font-semibold text-slate-900 dark:text-white leading-tight">Preview Draft Content</h1>
          <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">This is how your content will look when published.</p>
        </div>
      </div>

      <!-- Main Preview Surface -->
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5 shadow-xs">
        <!-- Type + Draft & Pricing Row -->
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${tmeta.badgeCls}">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${tmeta.iconPath}"/></svg>
              ${esc(tmeta.shortLabel)}
            </span>
            <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-violet-100 text-[#5a1fd8] dark:bg-violet-950/60 dark:text-violet-300">
              ${c.status === 'draft' ? 'Draft' : esc(c.status)}
            </span>
          </div>

          <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold tabular-nums ${
            c.isFree
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
              : 'bg-blue-50 text-[#0F2547] dark:bg-sky-950/60 dark:text-sky-300'
          }">
            ${c.isFree ? 'Free' : `Paid · ${formatInr(c.priceInr)}`}
          </span>
        </div>

        <!-- Title -->
        <h2 class="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white leading-snug">
          ${esc(c.title)}
        </h2>

        <!-- Cover Image -->
        ${
          c.coverImageUrl
            ? `<div class="aspect-[16/8] sm:aspect-[16/7] w-full rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 relative">
                <img
                  src="${esc(getResponsiveImageSources(c.coverImageUrl, 960)?.fallbackSrc || c.coverImageUrl)}"
                  alt="${esc(c.title)}"
                  class="w-full h-full object-cover"
                  onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
                />
                <div style="display:none" class="absolute inset-0 bg-gradient-to-br from-[#23196e] via-[#4125b8] to-[#1e1b4b] p-6 flex-col justify-between text-white">
                  <span class="text-xs text-indigo-200">ScholarPress Draft Preview</span>
                  <span class="font-display text-xl font-semibold">${esc(c.title)}</span>
                </div>
              </div>`
            : ''
        }

        <!-- Subject / Category / Class & Created / Updated Dates -->
        <div class="space-y-2 pb-4 border-b border-slate-100 dark:border-slate-800 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
          ${
            subjectCat.length
              ? `<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                  ${c.subjectName || c.categoryName ? `<span class="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200"><svg class="w-4 h-4 text-[#5a1fd8] dark:text-violet-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>${esc(c.subjectName || c.categoryName)}</span>` : ''}
                  ${c.classLevel ? `<span class="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200"><svg class="w-4 h-4 text-[#5a1fd8] dark:text-violet-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 14l9-5-9-5-9 5 9 5z"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"/></svg>${esc(c.classLevel)}</span>` : ''}
                  ${c.language ? `<span class="text-slate-500 dark:text-slate-400">${esc(c.language)}</span>` : ''}
                </div>`
              : ''
          }
          <div class="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>Created: <strong class="text-slate-700 dark:text-slate-300">${esc(createdStr)}</strong></span>
            <span>Updated: <strong class="text-slate-700 dark:text-slate-300">${esc(updatedStr)}</strong></span>
            <span class="font-mono text-[11px] tabular-nums">${c.durationSeconds ? esc(formatDurationShort(c.durationSeconds)) : `${c.readingTimeMins || 5} min read`}</span>
          </div>
        </div>

        <!-- Description Section -->
        <section class="space-y-2">
          <h3 class="flex items-center gap-2 font-display text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
            <svg class="w-4 h-4 text-[#5a1fd8] dark:text-violet-300 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            <span>Description</span>
          </h3>
          <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">${esc(c.shortDescription)}</p>
        </section>

        <!-- Content Preview Section -->
        <section class="space-y-3">
          <h3 class="flex items-center gap-2 font-display text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
            <svg class="w-4 h-4 text-[#5a1fd8] dark:text-violet-300 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span>Content Preview</span>
          </h3>

          ${
            videoFiles.length
              ? `<div class="space-y-4">
                  ${videoFiles
                    .map((vf) => {
                      if (vf.externalVideoUrl) {
                        const resolved = resolveVideoEmbed(vf.externalVideoUrl);
                        const embedSrc = resolved ? resolved.embedUrl : vf.externalVideoUrl;
                        return `
                          <div class="space-y-1.5">
                            <div class="relative aspect-video w-full rounded-xl overflow-hidden bg-black border border-slate-200 dark:border-slate-800">
                              <iframe src="${esc(embedSrc)}" title="${esc(vf.originalName || c.title)}" class="w-full h-full border-0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                            </div>
                            <div class="text-xs text-slate-500 dark:text-slate-400 truncate">${esc(vf.originalName || c.title)}</div>
                          </div>
                        `;
                      }
                      return `
                        <div class="space-y-1.5">
                          <video controls controlsList="nodownload" class="w-full rounded-xl bg-black max-h-[460px]" src="${esc(withAuthParam(vf.accessUrl))}"></video>
                          <div class="text-xs text-slate-500 dark:text-slate-400">${esc(vf.originalName)} · ${formatBytes(vf.sizeBytes)}</div>
                        </div>
                      `;
                    })
                    .join('')}
                </div>`
              : ''
          }

          ${
            pdfFiles.length
              ? `<div class="space-y-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] p-3.5 sm:p-4">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="text-xs font-semibold text-slate-800 dark:text-slate-200">PDF Preview</span>
                    <div class="flex items-center gap-1.5 text-xs">
                      <button type="button" id="drf-pdf-zoom-out" class="min-w-[32px] min-h-[32px] px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E]">−</button>
                      <span id="drf-pdf-zoom-label" class="font-mono tabular-nums w-11 text-center">100%</span>
                      <button type="button" id="drf-pdf-zoom-in" class="min-w-[32px] min-h-[32px] px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E]">+</button>
                      <button type="button" id="drf-pdf-fullscreen-btn" class="min-h-[32px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] font-semibold text-[#5a1fd8] dark:text-sky-400">Full Screen</button>
                    </div>
                  </div>
                  ${pdfFiles
                    .map(
                      (pf, idx) => `
                      <div class="space-y-1.5">
                        <div class="relative overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 h-[360px] sm:h-[460px]">
                          <iframe ${idx === 0 ? 'id="drf-pdf-frame"' : ''} src="${esc(withAuthParam(pf.accessUrl))}#toolbar=1" title="${esc(pf.originalName)}" class="w-full h-full border-0 origin-top-left"></iframe>
                        </div>
                        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span class="truncate">${esc(pf.originalName)} · ${formatBytes(pf.sizeBytes)}</span>
                          <a href="${esc(withAuthParam(`${pf.accessUrl}${pf.accessUrl.includes('?') ? '&' : '?'}download=1`))}" class="font-semibold text-[#5a1fd8] dark:text-sky-400 hover:underline whitespace-nowrap">Download PDF</a>
                        </div>
                      </div>
                    `
                    )
                    .join('')}
                </div>`
              : ''
          }

          ${
            imageFiles.length
              ? `<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  ${imageFiles
                    .map((imgF) => {
                      const fullSrc = withAuthParam(imgF.accessUrl);
                      const thumbSrc = `${fullSrc}${fullSrc.includes('?') ? '&' : '?'}w=480`;
                      return `
                        <button type="button" data-gallery-src="${esc(fullSrc)}" data-gallery-name="${esc(imgF.originalName)}" class="drf-prev-gallery group text-left rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120]">
                          <div class="aspect-[4/3] w-full overflow-hidden">
                            <img src="${esc(thumbSrc)}" alt="${esc(imgF.originalName)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200" />
                          </div>
                          <div class="px-2.5 py-1.5 text-[11px] text-slate-600 dark:text-slate-300 truncate">${esc(imgF.originalName)}</div>
                        </button>
                      `;
                    })
                    .join('')}
                </div>`
              : ''
          }

          ${
            hasProse
              ? `<div class="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-[#0B1120] p-4 space-y-2">
                  <div id="drf-preview-prose" class="reading-prose text-sm ${isLongProse ? 'max-h-40 overflow-hidden' : ''}">${c.bodyHtml}</div>
                  ${
                    isLongProse
                      ? `<div class="flex justify-end">
                          <button type="button" id="drf-read-more-btn" data-expanded="false" class="text-xs font-semibold text-[#5a1fd8] dark:text-sky-400 hover:underline">Read More ▾</button>
                        </div>`
                      : ''
                  }
                </div>`
              : !hasAnyContent
              ? `<div class="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-[#0B1120] p-4 text-xs text-slate-500 dark:text-slate-400">
                  No full article text or downloadable media files are attached yet. Click <strong>Edit Draft</strong> to complete your content before publishing.
                </div>`
              : ''
          }

          ${
            docFiles.length
              ? `<div class="space-y-2.5">
                  ${docFiles
                    .map(
                      (df) => `
                      <div class="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] space-y-1 text-xs">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <span class="font-medium text-slate-900 dark:text-slate-100">${esc(df.originalName)} · ${formatBytes(df.sizeBytes)}</span>
                          <a href="${esc(withAuthParam(`${df.accessUrl}${df.accessUrl.includes('?') ? '&' : '?'}download=1`))}" class="font-semibold text-[#5a1fd8] dark:text-sky-400 hover:underline whitespace-nowrap">Download File</a>
                        </div>
                        <p class="text-[11px] text-slate-500 dark:text-slate-400">${esc(df.previewNote || 'Inline browser preview is not supported for this document format. Download the file to view it.')}</p>
                      </div>
                    `
                    )
                    .join('')}
                </div>`
              : ''
          }
        </section>
      </div>

      <!-- Bottom Action Buttons Bar -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 pt-1">
        <a
          href="#/creator/edit/${c.id}?from=drafts"
          class="min-h-[46px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-semibold transition-colors"
        >
          <svg class="w-4 h-4 text-[#5a1fd8] dark:text-violet-300 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          <span>Edit Draft</span>
        </a>

        ${
          c.status === 'draft'
            ? `<button
                type="button"
                id="drf-publish-btn"
                data-id="${c.id}"
                class="min-h-[46px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white text-sm font-semibold transition-colors shadow-xs"
              >
                <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>
                <span>Publish Content</span>
              </button>`
            : `<a
                href="#/creator/pending"
                class="min-h-[46px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white text-sm font-semibold transition-colors"
              >
                <span>View Status</span>
              </a>`
        }

        <a
          href="#/creator/drafts"
          class="min-h-[46px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] hover:bg-slate-50 dark:hover:bg-slate-800 text-[#5a1fd8] dark:text-sky-400 text-sm font-semibold transition-colors"
        >
          <span>← Back to Drafts</span>
        </a>
      </div>
    </div>
  `;
}

/**
 * Three-dot action menu on Draft Cards:
 * STRICTLY ONLY 4 options: Preview Content, Edit Content, Duplicate Content, Delete Content.
 * Never includes "Move to Draft".
 */
export function openDraftActionMenu({ triggerEl, item, onPreview, onEdit, onDuplicate, onDelete }) {
  cleanupDraftFloatingMenu();
  if (!triggerEl || !item) return;

  const isMobile = window.innerWidth < 640;
  const root = document.createElement('div');
  root.id = 'drf-action-menu-root';
  root.className = 'fixed inset-0 z-50';

  const menuOptionsHtml = `
    <button type="button" data-action="preview" role="menuitem" class="drf-menu-item w-full min-h-[46px] px-4 py-2.5 flex items-center gap-3 text-left text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors">
      <svg class="w-4.5 h-4.5 text-slate-500 dark:text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
      <span>Preview Content</span>
    </button>
    <button type="button" data-action="edit" role="menuitem" class="drf-menu-item w-full min-h-[46px] px-4 py-2.5 flex items-center gap-3 text-left text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors">
      <svg class="w-4.5 h-4.5 text-slate-500 dark:text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
      <span>Edit Content</span>
    </button>
    <button type="button" data-action="duplicate" role="menuitem" class="drf-menu-item w-full min-h-[46px] px-4 py-2.5 flex items-center gap-3 text-left text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors">
      <svg class="w-4.5 h-4.5 text-slate-500 dark:text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
      <span>Duplicate Content</span>
    </button>
    <div class="my-1 border-t border-slate-100 dark:border-slate-800"></div>
    <button type="button" data-action="delete" role="menuitem" class="drf-menu-item w-full min-h-[46px] px-4 py-2.5 flex items-center gap-3 text-left text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors">
      <svg class="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      <span>Delete Content</span>
    </button>
  `;

  if (isMobile) {
    root.innerHTML = `
      <div id="drf-menu-backdrop" class="fixed inset-0 bg-slate-950/60 backdrop-blur-[2px]"></div>
      <div id="drf-menu-panel" role="menu" aria-label="Draft content actions" class="fixed inset-x-0 bottom-0 bg-white dark:bg-[#111A2E] border-t border-slate-200 dark:border-slate-800 rounded-t-2xl shadow-2xl pb-5 pt-2.5 overflow-hidden">
        <div class="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mb-3"></div>
        <div class="px-4 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="font-display text-sm font-semibold text-slate-900 dark:text-white truncate">${esc(item.title)}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400 truncate">${esc(item.contentType)} · Draft</div>
          </div>
          <button type="button" id="drf-menu-close-btn" aria-label="Close menu" class="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="py-1.5">${menuOptionsHtml}</div>
      </div>
    `;
  } else {
    root.innerHTML = `
      <div id="drf-menu-backdrop" class="fixed inset-0 bg-transparent"></div>
      <div id="drf-menu-panel" role="menu" aria-label="Draft content actions" class="fixed w-52 bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1.5 overflow-hidden">
        ${menuOptionsHtml}
      </div>
    `;
  }

  document.body.appendChild(root);
  triggerEl.setAttribute('aria-expanded', 'true');

  if (!isMobile) {
    const panel = document.getElementById('drf-menu-panel');
    if (panel) {
      const rect = triggerEl.getBoundingClientRect();
      const panelW = panel.offsetWidth || 208;
      const panelH = panel.offsetHeight || 210;
      const left = Math.max(12, Math.min(window.innerWidth - panelW - 12, rect.right - panelW));
      const fitsBelow = rect.bottom + 6 + panelH <= window.innerHeight - 12;
      const top = fitsBelow
        ? rect.bottom + 6
        : Math.max(12, rect.top - panelH - 6);
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') closeMenu();
  };

  const closeMenu = () => {
    document.removeEventListener('keydown', onKeyDown);
    triggerEl.setAttribute('aria-expanded', 'false');
    root.remove();
    activeDraftMenuCleanup = null;
  };

  activeDraftMenuCleanup = closeMenu;
  document.addEventListener('keydown', onKeyDown);
  document.getElementById('drf-menu-backdrop')?.addEventListener('click', closeMenu);
  document.getElementById('drf-menu-close-btn')?.addEventListener('click', closeMenu);

  root.querySelectorAll('.drf-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      closeMenu();
      if (action === 'preview') onPreview?.(item);
      else if (action === 'edit') onEdit?.(item);
      else if (action === 'duplicate') onDuplicate?.(item);
      else if (action === 'delete') onDelete?.(item);
    });
  });
}

function handleDeleteDraft(item, onSuccess) {
  openModal({
    title: 'Delete Draft',
    widthClass: 'max-w-sm',
    bodyHtml: `
      <div class="text-center space-y-4">
        <div class="w-12 h-12 rounded-full mx-auto flex items-center justify-center bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </div>
        <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Are you sure you want to delete <strong class="text-slate-900 dark:text-white">"${esc(item.title)}"</strong>? It will be moved to Trash where you can recover it within 15 days.
        </p>
        <div class="grid grid-cols-2 gap-2.5 pt-2">
          <button type="button" id="drf-del-cancel" class="min-h-[42px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">Cancel</button>
          <button type="button" id="drf-del-confirm" class="min-h-[42px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white">Delete Draft</button>
        </div>
      </div>
    `,
    onMount: (close) => {
      document.getElementById('drf-del-cancel')?.addEventListener('click', close);
      const confirmBtn = document.getElementById('drf-del-confirm');
      confirmBtn?.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Deleting...';
        try {
          const res = await apiFetch(`/api/creator/contents/${item.id}`, { method: 'DELETE' });
          close();
          showToast(res?.message || 'Draft moved to Trash.', 'success');
          await onSuccess?.();
        } catch (err) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Delete Draft';
          showToast(err?.message || 'Unable to delete draft.', 'error');
        }
      });
    },
  });
}

export function wireDraftsListEvents(container, initialPayload) {
  let currentPayload = initialPayload;
  let searchDebounce = null;
  let requestSeq = 0;
  let isMutating = false;

  const updateSearchClearBtn = () => {
    const clearBtn = document.getElementById('drf-search-clear');
    const searchInput = document.getElementById('drf-search-input');
    if (clearBtn && searchInput) {
      const hasVal = searchInput.value.trim().length > 0;
      clearBtn.classList.toggle('hidden', !hasVal);
      clearBtn.classList.toggle('flex', hasVal);
    }
  };

  const refreshDynamicRegion = async () => {
    const regionEl = document.getElementById('drf-dynamic-region');
    if (!regionEl) return;
    const seq = ++requestSeq;
    regionEl.style.opacity = '0.65';
    try {
      const fresh = await apiFetch(buildDraftsListUrl(), { noCache: true });
      if (seq !== requestSeq) return;
      currentPayload = fresh;
      regionEl.innerHTML = renderDraftsDynamicRegionHtml(fresh);
      regionEl.style.opacity = '1';
      bindDynamicControls();
    } catch (err) {
      if (seq !== requestSeq) return;
      regionEl.style.opacity = '1';
      showToast(err?.message || 'Unable to load draft content.', 'error');
    }
  };

  const resetAllFilters = () => {
    draftsListState.q = '';
    draftsListState.typeGroup = 'all';
    draftsListState.subjectId = '';
    draftsListState.categoryId = '';
    draftsListState.sort = 'newest';
    draftsListState.userPickedSort = false;
    draftsListState.page = 1;
    const searchInput = document.getElementById('drf-search-input');
    if (searchInput) searchInput.value = '';
    updateSearchClearBtn();
    refreshDynamicRegion();
  };

  const searchInput = document.getElementById('drf-search-input');
  searchInput?.addEventListener('input', () => {
    updateSearchClearBtn();
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      draftsListState.q = searchInput.value;
      draftsListState.page = 1;
      refreshDynamicRegion();
    }, 260);
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchDebounce) clearTimeout(searchDebounce);
      draftsListState.q = searchInput.value;
      draftsListState.page = 1;
      refreshDynamicRegion();
    }
  });

  document.getElementById('drf-search-clear')?.addEventListener('click', () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    draftsListState.q = '';
    draftsListState.page = 1;
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    updateSearchClearBtn();
    refreshDynamicRegion();
  });

  document.getElementById('drf-clear-all-btn')?.addEventListener('click', resetAllFilters);

  document.getElementById('drf-filters-toggle')?.addEventListener('click', () => {
    draftsListState.filtersOpen = !draftsListState.filtersOpen;
    const panel = document.getElementById('drf-mobile-filters-panel');
    const toggleBtn = document.getElementById('drf-filters-toggle');
    panel?.classList.toggle('hidden', !draftsListState.filtersOpen);
    panel?.classList.toggle('grid', draftsListState.filtersOpen);
    panel?.classList.toggle('sm:hidden', draftsListState.filtersOpen);
    toggleBtn?.setAttribute('aria-expanded', draftsListState.filtersOpen ? 'true' : 'false');
  });

  const bindDynamicControls = () => {
    const region = document.getElementById('drf-dynamic-region');
    if (!region) return;

    region.querySelectorAll('.drf-type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextGroup = btn.dataset.typeGroup || 'all';
        if (draftsListState.typeGroup === nextGroup) return;
        draftsListState.typeGroup = nextGroup;
        draftsListState.page = 1;
        refreshDynamicRegion();
      });
    });

    region.querySelectorAll('.drf-subject-select').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        draftsListState.subjectId = e.target.value || '';
        draftsListState.page = 1;
        refreshDynamicRegion();
      });
    });

    region.querySelectorAll('.drf-category-select').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        draftsListState.categoryId = e.target.value || '';
        draftsListState.page = 1;
        refreshDynamicRegion();
      });
    });

    region.querySelectorAll('.drf-sort-select').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        draftsListState.sort = e.target.value || 'newest';
        draftsListState.userPickedSort = true;
        draftsListState.page = 1;
        refreshDynamicRegion();
      });
    });

    document.getElementById('drf-empty-clear-btn')?.addEventListener('click', resetAllFilters);

    region.querySelectorAll('.drf-page-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextPage = Number(btn.dataset.page);
        if (!nextPage || nextPage < 1 || nextPage === draftsListState.page) return;
        draftsListState.page = nextPage;
        refreshDynamicRegion();
      });
    });

    region.querySelectorAll('.drf-nav-preview, .drf-nav-edit').forEach((link) => {
      link.addEventListener('click', () => {
        draftsListState.scrollY = window.scrollY;
      });
    });

    region.querySelectorAll('.drf-menu-trigger').forEach((triggerEl) => {
      triggerEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = Number(triggerEl.dataset.id);
        const item = (currentPayload?.items || []).find((x) => Number(x.id) === id);
        if (!item) return;

        openDraftActionMenu({
          triggerEl,
          item,
          onPreview: (selected) => {
            draftsListState.scrollY = window.scrollY;
            window.location.hash = `#/creator/drafts/${selected.id}/preview`;
          },
          onEdit: (selected) => {
            draftsListState.scrollY = window.scrollY;
            window.location.hash = `#/creator/edit/${selected.id}?from=drafts`;
          },
          onDuplicate: async (selected) => {
            if (isMutating) return;
            isMutating = true;
            showToast('Creating draft duplicate...', 'info');
            try {
              const res = await apiFetch(`/api/creator/contents/${selected.id}/duplicate`, { method: 'POST' });
              showToast(res?.message || 'Draft duplicated successfully.', 'success');
              await refreshDynamicRegion();
            } catch (err) {
              showToast(err?.message || 'Unable to duplicate draft.', 'error');
            } finally {
              isMutating = false;
            }
          },
          onDelete: (selected) => {
            handleDeleteDraft(selected, refreshDynamicRegion);
          },
        });
      });
    });
  };

  bindDynamicControls();

  if (draftsListState.scrollY > 0) {
    const targetY = draftsListState.scrollY;
    draftsListState.scrollY = 0;
    requestAnimationFrame(() => window.scrollTo({ top: targetY, behavior: 'instant' }));
  }
}

export function wireDraftPreviewEvents(container, detailPayload) {
  const c = detailPayload?.content;
  if (!c) return;

  // Read More toggle for prose preview
  const readMoreBtn = document.getElementById('drf-read-more-btn');
  const proseBox = document.getElementById('drf-preview-prose');
  readMoreBtn?.addEventListener('click', () => {
    const expanded = readMoreBtn.dataset.expanded === 'true';
    readMoreBtn.dataset.expanded = expanded ? 'false' : 'true';
    proseBox?.classList.toggle('max-h-40', expanded);
    proseBox?.classList.toggle('overflow-hidden', expanded);
    readMoreBtn.textContent = expanded ? 'Read More ▾' : 'Show Less ▴';
  });

  // PDF zoom + fullscreen
  let pdfZoom = 100;
  const applyZoom = () => {
    const frame = document.getElementById('drf-pdf-frame');
    const label = document.getElementById('drf-pdf-zoom-label');
    if (frame && label) {
      frame.style.transform = `scale(${pdfZoom / 100})`;
      frame.style.width = `${10000 / pdfZoom}%`;
      frame.style.height = `${10000 / pdfZoom}%`;
      label.textContent = `${pdfZoom}%`;
    }
  };
  document.getElementById('drf-pdf-zoom-in')?.addEventListener('click', () => {
    pdfZoom = Math.min(150, pdfZoom + 15);
    applyZoom();
  });
  document.getElementById('drf-pdf-zoom-out')?.addEventListener('click', () => {
    pdfZoom = Math.max(70, pdfZoom - 15);
    applyZoom();
  });
  document.getElementById('drf-pdf-fullscreen-btn')?.addEventListener('click', () => {
    const frame = document.getElementById('drf-pdf-frame');
    const src = frame?.getAttribute('src');
    if (!src) return;
    openModal({
      title: frame.getAttribute('title') || 'PDF Document Preview',
      widthClass: 'max-w-6xl',
      bodyHtml: `
        <div class="w-full h-[80vh] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950">
          <iframe src="${esc(src)}" class="w-full h-full border-0" title="Full Screen PDF Preview"></iframe>
        </div>
      `,
    });
  });

  // Attached image gallery lightbox
  const galleryBtns = Array.from(container.querySelectorAll('.drf-prev-gallery'));
  galleryBtns.forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      const images = galleryBtns.map((b, i) => ({
        src: b.dataset.gallerySrc,
        title: b.dataset.galleryName || `Image ${i + 1}`,
      }));
      openImageLightbox({ images, startIndex: idx });
    });
  });

  // Publish Draft button with confirmation modal + copyright check
  document.getElementById('drf-publish-btn')?.addEventListener('click', () => {
    openModal({
      title: 'Publish Content',
      widthClass: 'max-w-md',
      bodyHtml: `
        <div class="space-y-4">
          <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Ready to publish <strong class="text-slate-900 dark:text-white">"${esc(c.title)}"</strong>?
            Once published, your content will go live or enter moderation review depending on platform approval rules.
          </p>
          ${
            !c.ownershipConfirmed
              ? `<label class="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] text-xs text-slate-700 dark:text-slate-300">
                  <input type="checkbox" id="drf-pub-ownership" class="mt-0.5 rounded" />
                  <span>I confirm that I am the original author or hold explicit legal rights to publish this educational resource.</span>
                </label>`
              : ''
          }
          <div class="grid grid-cols-2 gap-2.5 pt-2">
            <button type="button" id="drf-pub-cancel" class="min-h-[42px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">Cancel</button>
            <button type="button" id="drf-pub-confirm" class="min-h-[42px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white">Confirm Publish</button>
          </div>
        </div>
      `,
      onMount: (close) => {
        document.getElementById('drf-pub-cancel')?.addEventListener('click', close);
        const confirmBtn = document.getElementById('drf-pub-confirm');
        confirmBtn?.addEventListener('click', async () => {
          const ownershipCheckbox = document.getElementById('drf-pub-ownership');
          const confirmed = c.ownershipConfirmed || Boolean(ownershipCheckbox?.checked);
          if (!confirmed) {
            showToast('Please confirm copyright ownership before publishing.', 'error');
            return;
          }
          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Publishing...';
          try {
            const res = await apiFetch(`/api/creator/contents/${c.id}/publish`, {
              method: 'POST',
              body: { ownershipConfirmed: confirmed },
            });
            close();
            showToast(res?.message || 'Content submitted for publication!', 'success');
            window.location.hash =
              res?.status === 'pending' ? '#/creator/pending' : '#/creator/published';
          } catch (err) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm Publish';
            showToast(err?.message || 'Unable to publish draft.', 'error');
          }
        });
      },
    });
  });
}
