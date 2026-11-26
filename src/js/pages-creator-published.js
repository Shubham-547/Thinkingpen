import {
  apiFetch,
  CONTENT_TYPES,
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

export const publishedListState = {
  q: '',
  tier: 'all',
  contentType: '',
  categoryId: '',
  subjectId: '',
  dateRange: 'all',
  sort: 'latest',
  page: 1,
  limit: 10,
  filtersOpen: false,
  scrollY: 0,
};

let activeFloatingMenuCleanup = null;

export function cleanupPublishedFloatingMenu() {
  if (activeFloatingMenuCleanup) {
    activeFloatingMenuCleanup();
    activeFloatingMenuCleanup = null;
  }
}

export function buildPublishedListUrl() {
  const qs = new URLSearchParams();
  if (publishedListState.q.trim()) qs.set('q', publishedListState.q.trim());
  if (publishedListState.tier !== 'all') qs.set('tier', publishedListState.tier);
  if (publishedListState.contentType) qs.set('contentType', publishedListState.contentType);
  if (publishedListState.categoryId) qs.set('categoryId', publishedListState.categoryId);
  if (publishedListState.subjectId) qs.set('subjectId', publishedListState.subjectId);
  if (publishedListState.dateRange !== 'all') qs.set('dateRange', publishedListState.dateRange);
  qs.set('sort', publishedListState.sort || 'latest');
  qs.set('page', String(publishedListState.page || 1));
  qs.set('limit', String(publishedListState.limit || 10));
  return `/api/creator/published?${qs.toString()}`;
}

function formatCompactCount(num) {
  const n = Number(num || 0);
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString('en-IN');
}

function getTitleInitials(title) {
  const words = String(title || 'SP').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'SP';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function renderCardThumbHtml(url, title, sizeClass = 'w-24 h-20 sm:w-32 sm:h-24') {
  const initials = getTitleInitials(title);
  if (!url) {
    return `
      <div class="${sizeClass} rounded-xl bg-gradient-to-br from-[#0F2547] via-[#1B3B6F] to-[#27467B] text-white flex flex-col items-center justify-center p-2 shrink-0 select-none">
        <span class="font-display text-sm sm:text-base font-semibold tracking-tight">${esc(initials)}</span>
      </div>
    `;
  }
  const sources = getResponsiveImageSources(url, 320);
  const src = sources?.fallbackSrc || url;
  return `
    <div class="${sizeClass} rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/70 shrink-0 relative">
      <img src="${esc(src)}" alt="${esc(title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
      <div style="display:none" class="absolute inset-0 bg-gradient-to-br from-[#0F2547] via-[#1B3B6F] to-[#27467B] text-white items-center justify-center font-display text-sm font-semibold">${esc(initials)}</div>
    </div>
  `;
}

function buildMetaLine(c) {
  const parts = [];
  if (c.classLevel) parts.push(c.classLevel);
  if (c.subjectName) parts.push(c.subjectName);
  else if (c.categoryName) parts.push(c.categoryName);
  if (c.contentType) parts.push(c.contentType);
  return parts;
}

function hasActiveFilters() {
  return Boolean(
    publishedListState.q.trim() ||
      publishedListState.tier !== 'all' ||
      publishedListState.contentType ||
      publishedListState.categoryId ||
      publishedListState.subjectId ||
      publishedListState.dateRange !== 'all' ||
      publishedListState.sort !== 'latest'
  );
}

function countAdvancedFilters() {
  let n = 0;
  if (publishedListState.contentType) n += 1;
  if (publishedListState.categoryId) n += 1;
  if (publishedListState.subjectId) n += 1;
  if (publishedListState.dateRange !== 'all') n += 1;
  return n;
}

export function renderPublishedContentSectionHtml(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const counts = payload?.counts || { all: 0, free: 0, paid: 0 };
  const pagination = payload?.pagination || { page: 1, limit: 10, total: items.length, totalPages: 1 };
  const meta = payload?.filtersMeta || { contentTypes: [], categories: [], subjects: [] };

  const typeOptions = Array.from(new Set([...(meta.contentTypes || []), ...CONTENT_TYPES]));
  const catOptions = meta.categories?.length ? meta.categories : store.categories || [];
  const subOptions = meta.subjects?.length ? meta.subjects : store.subjects || [];
  const advCount = countAdvancedFilters();
  const isFiltered = hasActiveFilters();

  const startIdx = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const endIdx = Math.min(pagination.total, pagination.page * pagination.limit);

  return `
    <div id="pub-list-root" class="space-y-4 sm:space-y-5">
      <!-- Page Header -->
      <div class="flex flex-wrap items-start sm:items-center justify-between gap-3">
        <div class="flex items-start gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-blue-50 dark:bg-sky-950/60 text-[#0F2547] dark:text-sky-400 flex items-center justify-center shrink-0 mt-0.5">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          </div>
          <div class="min-w-0">
            <h1 class="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white leading-tight">Published Content</h1>
            <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">Manage your published content and track its performance.</p>
          </div>
        </div>
        <a href="#/creator/upload" class="inline-flex items-center gap-1.5 min-h-[42px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors whitespace-nowrap shrink-0">
          <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
          <span>Upload</span>
        </a>
      </div>

      <!-- Search + Filter Controls -->
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 sm:p-4 space-y-3">
        <!-- Search Input -->
        <div class="relative flex items-center">
          <svg class="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35"/></svg>
          <input
            type="search"
            id="pub-search-input"
            value="${esc(publishedListState.q)}"
            placeholder="Search published content by title, subject, category, or tags..."
            class="w-full min-h-[44px] pl-10 pr-10 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#0F2547] dark:focus:border-sky-400"
          />
          ${
            publishedListState.q
              ? `<button type="button" id="pub-search-clear" aria-label="Clear search" class="absolute right-2 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>`
              : ''
          }
        </div>

        <!-- Tier Filter Pills + Sort + Advanced Filters Toggle -->
        <div class="flex flex-wrap items-center justify-between gap-2.5">
          <div class="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
            ${[
              { key: 'all', label: `All (${counts.all})` },
              { key: 'free', label: `Free (${counts.free})` },
              { key: 'paid', label: `Paid (${counts.paid})` },
            ]
              .map(
                (t) => `
              <button
                type="button"
                data-tier="${t.key}"
                class="pub-tier-btn min-h-[38px] px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums border ${
                  publishedListState.tier === t.key
                    ? 'bg-[#0F2547] border-[#0F2547] text-white dark:bg-sky-500 dark:border-sky-500 dark:text-slate-950'
                    : 'bg-slate-50 dark:bg-[#0B1120] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                }"
              >
                ${esc(t.label)}
              </button>
            `
              )
              .join('')}
          </div>

          <div class="flex items-center gap-2 ml-auto">
            <button
              type="button"
              id="pub-filters-toggle"
              aria-expanded="${publishedListState.filtersOpen ? 'true' : 'false'}"
              class="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                publishedListState.filtersOpen || advCount > 0
                  ? 'border-[#0F2547] text-[#0F2547] bg-blue-50/70 dark:border-sky-400 dark:text-sky-300 dark:bg-sky-950/40'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>
              <span>Filters${advCount > 0 ? ` (${advCount})` : ''}</span>
            </button>

            <label for="pub-sort-select" class="sr-only">Sort published content</label>
            <select
              id="pub-sort-select"
              class="min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0F2547] dark:focus:border-sky-400"
            >
              <option value="latest" ${publishedListState.sort === 'latest' ? 'selected' : ''}>Sort by: Latest</option>
              <option value="oldest" ${publishedListState.sort === 'oldest' ? 'selected' : ''}>Sort by: Oldest</option>
              <option value="views" ${publishedListState.sort === 'views' ? 'selected' : ''}>Sort by: Most Viewed</option>
              <option value="downloads" ${publishedListState.sort === 'downloads' ? 'selected' : ''}>Sort by: Most Downloaded</option>
              <option value="sales" ${publishedListState.sort === 'sales' ? 'selected' : ''}>Sort by: Most Sales</option>
              <option value="title" ${publishedListState.sort === 'title' ? 'selected' : ''}>Sort by: Title (A–Z)</option>
            </select>
          </div>
        </div>

        <!-- Expandable Filter Controls (Content Type, Category, Subject, Date Published) -->
        <div id="pub-filters-panel" class="${publishedListState.filtersOpen ? 'grid' : 'hidden'} grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            <label for="pub-type-select" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Content Type</label>
            <select id="pub-type-select" class="w-full min-h-[40px] px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100">
              <option value="">All Content Types</option>
              ${typeOptions
                .map((t) => `<option value="${esc(t)}" ${publishedListState.contentType === t ? 'selected' : ''}>${esc(t)}</option>`)
                .join('')}
            </select>
          </div>
          <div>
            <label for="pub-category-select" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Category</label>
            <select id="pub-category-select" class="w-full min-h-[40px] px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100">
              <option value="">All Categories</option>
              ${catOptions
                .map((cat) => `<option value="${cat.id}" ${String(publishedListState.categoryId) === String(cat.id) ? 'selected' : ''}>${esc(cat.name)}</option>`)
                .join('')}
            </select>
          </div>
          <div>
            <label for="pub-subject-select" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Subject</label>
            <select id="pub-subject-select" class="w-full min-h-[40px] px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100">
              <option value="">All Subjects</option>
              ${subOptions
                .map((sub) => `<option value="${sub.id}" ${String(publishedListState.subjectId) === String(sub.id) ? 'selected' : ''}>${esc(sub.name)}</option>`)
                .join('')}
            </select>
          </div>
          <div>
            <label for="pub-date-select" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Date Published</label>
            <select id="pub-date-select" class="w-full min-h-[40px] px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100">
              <option value="all" ${publishedListState.dateRange === 'all' ? 'selected' : ''}>All Time</option>
              <option value="7d" ${publishedListState.dateRange === '7d' ? 'selected' : ''}>Last 7 Days</option>
              <option value="30d" ${publishedListState.dateRange === '30d' ? 'selected' : ''}>Last 30 Days</option>
              <option value="90d" ${publishedListState.dateRange === '90d' ? 'selected' : ''}>Last 90 Days</option>
              <option value="year" ${publishedListState.dateRange === 'year' ? 'selected' : ''}>This Year</option>
            </select>
          </div>
          ${
            isFiltered
              ? `<div class="sm:col-span-2 lg:col-span-4 flex justify-end pt-1">
                  <button type="button" id="pub-reset-filters-btn" class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">Reset all filters</button>
                </div>`
              : ''
          }
        </div>
      </div>

      <!-- Published Content Cards -->
      ${
        items.length
          ? `<div id="pub-cards-list" class="space-y-3.5">
              ${items
                .map((c) => {
                  const metaParts = buildMetaLine(c);
                  const pubDateLabel = formatDate(c.publishedAt || c.createdAt);
                  return `
                    <article data-content-id="${c.id}" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 sm:p-4 hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
                      <div class="flex items-start gap-3.5 sm:gap-4">
                        <a href="#/creator/published/${c.id}" class="pub-nav-detail shrink-0 block" data-id="${c.id}">
                          ${renderCardThumbHtml(c.coverImageUrl, c.title)}
                        </a>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-start justify-between gap-2">
                            <a href="#/creator/published/${c.id}" class="pub-nav-detail font-display text-sm sm:text-base font-semibold text-slate-900 dark:text-white hover:text-[#1B3B6F] dark:hover:text-sky-300 leading-snug line-clamp-2" data-id="${c.id}">
                              ${esc(c.title)}
                            </a>
                            <button
                              type="button"
                              data-id="${c.id}"
                              aria-label="More actions for ${esc(c.title)}"
                              aria-haspopup="menu"
                              aria-expanded="false"
                              class="pub-menu-trigger min-w-[44px] min-h-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                            >
                              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="12" cy="19" r="1.75"/></svg>
                            </button>
                          </div>

                          ${
                            metaParts.length
                              ? `<div class="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                  ${metaParts.map((p) => esc(p)).join(' · ')}
                                </div>`
                              : ''
                          }

                          <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-2">
                            <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold tabular-nums ${
                              c.isFree
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                                : 'bg-blue-50 text-[#0F2547] dark:bg-sky-950/60 dark:text-sky-300'
                            }">
                              ${c.isFree ? 'Free' : `Paid · ${formatInr(c.priceInr)}`}
                            </span>
                            <span class="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              Published
                            </span>
                            <span class="text-[11px] text-slate-400 dark:text-slate-500">· ${esc(pubDateLabel)}</span>
                          </div>
                        </div>
                      </div>

                      <!-- Bottom Metrics + View Details Row -->
                      <div class="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                          <span class="inline-flex items-center gap-1.5" title="${Number(c.viewsCount || 0).toLocaleString('en-IN')} views">
                            <svg class="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                            <span class="font-medium">${esc(formatCompactCount(c.viewsCount))}</span>
                          </span>
                          <span class="inline-flex items-center gap-1.5" title="${Number(c.downloadsCount || 0).toLocaleString('en-IN')} downloads">
                            <svg class="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                            <span class="font-medium">${esc(formatCompactCount(c.downloadsCount))}</span>
                          </span>
                          ${
                            !c.isFree
                              ? `<span class="inline-flex items-center gap-1.5" title="${Number(c.purchasesCount || 0).toLocaleString('en-IN')} paid sales">
                                  <svg class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 2.3a1 1 0 00.7 1.7H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z"/></svg>
                                  <span class="font-medium">${esc(formatCompactCount(c.purchasesCount))}</span>
                                </span>`
                              : ''
                          }
                        </div>

                        <a
                          href="#/creator/published/${c.id}"
                          data-id="${c.id}"
                          class="pub-nav-detail inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 ml-auto"
                        >
                          <svg class="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                          <span>View Details</span>
                          <span aria-hidden="true">→</span>
                        </a>
                      </div>
                    </article>
                  `;
                })
                .join('')}
            </div>`
          : counts.all === 0
          ? `<div class="bg-white dark:bg-[#111A2E] border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center space-y-3">
              <div class="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-sky-950/60 text-[#0F2547] dark:text-sky-400 flex items-center justify-center mx-auto">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              </div>
              <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">No published content yet</h2>
              <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">Upload educational notes, PDFs, e-books, or video lectures and submit them for publication to manage and track them here.</p>
              <div class="pt-1">
                <a href="#/creator/upload" class="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-xl bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors">
                  + Upload Your First Content
                </a>
              </div>
            </div>`
          : `<div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center space-y-3">
              <h2 class="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white">No matching published content</h2>
              <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400">Try adjusting your search keywords or clearing active filters.</p>
              <button type="button" id="pub-empty-reset-btn" class="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
                Clear Search &amp; Filters
              </button>
            </div>`
      }

      <!-- Pagination -->
      ${
        pagination.total > 0
          ? `<div class="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                Showing <strong class="text-slate-800 dark:text-slate-200">${startIdx}–${endIdx}</strong> of <strong class="text-slate-800 dark:text-slate-200">${pagination.total}</strong> published item${pagination.total === 1 ? '' : 's'}
              </div>
              ${
                pagination.totalPages > 1
                  ? `<div class="flex items-center gap-1.5">
                      <button type="button" data-page="${pagination.page - 1}" ${pagination.page <= 1 ? 'disabled' : ''} class="pub-page-btn min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800">Prev</button>
                      <span class="px-2.5 text-xs font-mono text-slate-600 dark:text-slate-300 tabular-nums">${pagination.page} / ${pagination.totalPages}</span>
                      <button type="button" data-page="${pagination.page + 1}" ${pagination.page >= pagination.totalPages ? 'disabled' : ''} class="pub-page-btn min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800">Next</button>
                    </div>`
                  : ''
              }
            </div>`
          : ''
      }
    </div>
  `;
}

export function renderPublishedDetailViewHtml(payload) {
  const c = payload?.content;
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const stats = payload?.stats || {};

  if (!c) {
    return `
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center space-y-3">
        <div class="text-base font-semibold text-slate-900 dark:text-white">Content not found</div>
        <p class="text-xs text-slate-500 dark:text-slate-400">This publication may have been moved to Trash or removed.</p>
        <a href="#/creator/published" class="inline-flex items-center px-4 py-2 text-xs font-semibold rounded-xl bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">← Back to Published Content</a>
      </div>
    `;
  }

  const metaItems = [
    c.classLevel,
    c.categoryName,
    c.subjectName,
    c.contentType,
    c.language,
  ].filter(Boolean);

  const fileSummaryParts = [];
  const pdfCount = files.filter((f) => f.fileType === 'pdf').length;
  const vidCount = files.filter((f) => f.fileType === 'video').length;
  const imgCount = files.filter((f) => f.fileType === 'image').length;
  const docCount = files.filter((f) => f.fileType === 'document').length;
  if (pdfCount) fileSummaryParts.push(`${pdfCount} PDF${pdfCount > 1 ? 's' : ''}`);
  if (vidCount) fileSummaryParts.push(`${vidCount} Video${vidCount > 1 ? 's' : ''}`);
  if (imgCount) fileSummaryParts.push(`${imgCount} Photo${imgCount > 1 ? 's' : ''}`);
  if (docCount) fileSummaryParts.push(`${docCount} Document${docCount > 1 ? 's' : ''}`);

  const statBoxes = [
    {
      label: 'Total Views',
      val: Number(stats.viewsCount || 0).toLocaleString('en-IN'),
      iconPath: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
      tone: 'text-sky-600 dark:text-sky-400',
    },
    {
      label: 'Unique Views',
      val: Number(stats.uniqueViewsCount || 0).toLocaleString('en-IN'),
      iconPath: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
      tone: 'text-indigo-600 dark:text-indigo-400',
    },
    {
      label: 'Downloads',
      val: Number(stats.downloadsCount || 0).toLocaleString('en-IN'),
      iconPath: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
      tone: 'text-blue-600 dark:text-sky-400',
    },
    {
      label: 'Likes',
      val: Number(stats.likesCount || 0).toLocaleString('en-IN'),
      iconPath: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
      tone: 'text-rose-600 dark:text-rose-400',
    },
    {
      label: 'Comments',
      val: Number(stats.commentsCount || 0).toLocaleString('en-IN'),
      iconPath: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
      tone: 'text-slate-600 dark:text-slate-300',
    },
  ];

  if (!c.isFree) {
    statBoxes.push(
      {
        label: 'Sales',
        val: Number(stats.salesCount || 0).toLocaleString('en-IN'),
        iconPath: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 2.3a1 1 0 00.7 1.7H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z',
        tone: 'text-emerald-600 dark:text-emerald-400',
      },
      {
        label: 'Total Earnings',
        val: formatInr(stats.netEarningsInr || 0),
        iconPath: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
        tone: 'text-emerald-700 dark:text-emerald-400',
      }
    );
  }

  return `
    <div id="pub-detail-root" class="space-y-5">
      <!-- Top Bar -->
      <div class="flex items-center justify-between gap-3">
        <button type="button" id="pub-detail-back-btn" class="inline-flex items-center gap-1.5 min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          <span>Back</span>
        </button>
        <h1 class="font-display text-base sm:text-xl font-semibold text-slate-900 dark:text-white truncate">Content Details</h1>
        <button
          type="button"
          id="pub-detail-menu-btn"
          data-id="${c.id}"
          aria-label="More content actions"
          aria-haspopup="menu"
          aria-expanded="false"
          class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shrink-0"
        >
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="12" cy="19" r="1.75"/></svg>
        </button>
      </div>

      <!-- Main Details Card -->
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        ${
          c.coverImageUrl
            ? `<div class="aspect-[16/8] sm:aspect-[16/7] w-full overflow-hidden bg-slate-100 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
                <img src="${esc(getResponsiveImageSources(c.coverImageUrl, 960)?.fallbackSrc || c.coverImageUrl)}" alt="${esc(c.title)}" class="w-full h-full object-cover" />
              </div>`
            : ''
        }

        <div class="p-4 sm:p-6 space-y-5">
          <!-- Title & Pricing -->
          <div class="space-y-2">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <h2 class="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white leading-snug">${esc(c.title)}</h2>
              <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold tabular-nums shrink-0 ${
                c.isFree
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                  : 'bg-blue-50 text-[#0F2547] dark:bg-sky-950/60 dark:text-sky-300'
              }">
                ${c.isFree ? 'Free' : `Paid · ${formatInr(c.priceInr)}`}
              </span>
            </div>

            ${
              metaItems.length
                ? `<div class="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                    ${metaItems.map((m) => esc(m)).join(' · ')}
                  </div>`
                : ''
            }

            ${
              c.chapter || c.topic || c.studyLabel
                ? `<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                    ${c.chapter ? `<span>Chapter: <strong>${esc(c.chapter)}</strong></span>` : ''}
                    ${c.topic ? `<span>Topic: <strong>${esc(c.topic)}</strong></span>` : ''}
                    ${c.studyLabel ? `<span>Label: <strong>${esc(c.studyLabel)}</strong></span>` : ''}
                  </div>`
                : ''
            }

            <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed pt-1">${esc(c.shortDescription)}</p>

            ${
              c.tags?.length
                ? `<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400 pt-1">
                    <span class="font-semibold text-slate-700 dark:text-slate-300">Tags:</span>
                    ${c.tags.map((t) => `<span>#${esc(t)}</span>`).join('<span aria-hidden="true">·</span>')}
                  </div>`
                : ''
            }
          </div>

          <!-- Real Performance Metrics Grid -->
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-2">
            ${statBoxes
              .map(
                (box) => `
              <div class="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200/80 dark:border-slate-800">
                <div class="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <svg class="w-4 h-4 shrink-0 ${box.tone}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${box.iconPath}"/></svg>
                  <span class="truncate">${esc(box.label)}</span>
                </div>
                <div class="font-mono text-lg sm:text-xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">${esc(box.val)}</div>
              </div>
            `
              )
              .join('')}
          </div>

          <!-- Metadata & Lifecycle Info -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50/80 dark:bg-[#0B1120] border border-slate-200/80 dark:border-slate-800 text-xs">
            <div class="space-y-1">
              <div class="text-slate-500 dark:text-slate-400">Published</div>
              <div class="font-medium text-slate-900 dark:text-slate-100">${esc(formatDateTime(c.publishedAt || c.createdAt))}</div>
            </div>
            <div class="space-y-1">
              <div class="text-slate-500 dark:text-slate-400">Last Updated</div>
              <div class="font-medium text-slate-900 dark:text-slate-100">${esc(formatDateTime(c.updatedAt))}</div>
            </div>
            ${
              c.authorName || c.publisherName
                ? `<div class="space-y-1">
                    <div class="text-slate-500 dark:text-slate-400">Attribution</div>
                    <div class="font-medium text-slate-900 dark:text-slate-100">${esc(c.authorName || 'Creator')}${c.publisherName ? ` · ${esc(c.publisherName)}` : ''}</div>
                  </div>`
                : ''
            }
            <div class="space-y-1">
              <div class="text-slate-500 dark:text-slate-400">Content Status &amp; Assets</div>
              <div class="flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center gap-1.5 font-semibold ${
                  c.status === 'approved'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }">
                  <span class="w-2 h-2 rounded-full ${c.status === 'approved' ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
                  ${c.status === 'approved' ? 'Published' : esc(c.status)}
                </span>
                ${fileSummaryParts.length ? `<span class="text-slate-500 dark:text-slate-400">· ${esc(fileSummaryParts.join(', '))}</span>` : ''}
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="pt-1 space-y-2.5">
            <div class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Actions</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <a
                href="#/creator/published/${c.id}/preview"
                class="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 text-sm font-semibold transition-colors"
              >
                <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <span>Preview Content</span>
              </a>

              <a
                href="#/creator/edit/${c.id}?from=published"
                class="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-semibold transition-colors"
              >
                <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                <span>Edit Content</span>
              </a>

              <a
                href="#/creator/published/${c.id}/analytics"
                class="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-semibold transition-colors"
              >
                <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                <span>View Analytics</span>
              </a>

              <button
                type="button"
                id="pub-detail-unpublish-btn"
                data-id="${c.id}"
                class="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-[#0B1120] hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400 text-sm font-semibold transition-colors"
              >
                <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
                <span>Unpublish Content</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function renderPublishedPreviewHtml(payload) {
  const c = payload?.content;
  const files = Array.isArray(payload?.files) ? payload.files : [];

  if (!c) {
    return `
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center space-y-3">
        <div class="text-base font-semibold text-slate-900 dark:text-white">Content preview unavailable</div>
        <a href="#/creator/published" class="inline-flex items-center px-4 py-2 text-xs font-semibold rounded-xl bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">← Back to Published Content</a>
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

  const pdfFiles = files.filter((f) => f.fileType === 'pdf');
  const videoFiles = files.filter((f) => f.fileType === 'video');
  const imageFiles = files.filter((f) => f.fileType === 'image');
  const docFiles = files.filter((f) => f.fileType === 'document');
  const metaItems = [c.classLevel, c.subjectName || c.categoryName, c.contentType, c.language].filter(Boolean);
  const hasProse = Boolean(c.bodyHtml && c.bodyHtml.replace(/<[^>]+>/g, '').trim().length > 0);
  const hasAnyContent = hasProse || files.length > 0;

  return `
    <div id="pub-preview-root" class="space-y-5">
      <!-- Top Bar -->
      <div class="flex items-center justify-between gap-3">
        <a href="#/creator/published/${c.id}" class="inline-flex items-center gap-1.5 min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          <span>Back</span>
        </a>
        <h1 class="font-display text-base sm:text-xl font-semibold text-slate-900 dark:text-white truncate">Content Preview</h1>
        <span class="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">Creator View</span>
      </div>

      <!-- Access Mode Banner -->
      <div class="px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
        <span>
          ${
            c.isFree
              ? 'Free publication — Showing full student-facing reading and media experience.'
              : `Paid publication (${formatInr(c.priceInr)}) — Previewing full unlocked content as creator. Unpurchased students see only the cover and summary.`
          }
        </span>
        <span class="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">${c.durationSeconds ? esc(formatDurationShort(c.durationSeconds)) : `${c.readingTimeMins || 5} min read`}</span>
      </div>

      <!-- Student-Facing Header -->
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        ${
          c.coverImageUrl
            ? `<div class="aspect-[16/8] sm:aspect-[16/7] w-full overflow-hidden bg-slate-100 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
                <img src="${esc(getResponsiveImageSources(c.coverImageUrl, 960)?.fallbackSrc || c.coverImageUrl)}" alt="${esc(c.title)}" class="w-full h-full object-cover" />
              </div>`
            : ''
        }
        <div class="p-4 sm:p-6 space-y-2">
          <h2 class="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white">${esc(c.title)}</h2>
          ${metaItems.length ? `<div class="text-xs sm:text-sm text-slate-500 dark:text-slate-400">${metaItems.map((m) => esc(m)).join(' · ')}</div>` : ''}
          <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed pt-1">${esc(c.shortDescription)}</p>
        </div>
      </div>

      <!-- Video Preview -->
      ${
        videoFiles.length
          ? `<section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
              <h3 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Video Lecture</h3>
              ${videoFiles
                .map((vf) => {
                  if (vf.externalVideoUrl) {
                    const resolved = resolveVideoEmbed(vf.externalVideoUrl);
                    const embedSrc = resolved ? resolved.embedUrl : vf.externalVideoUrl;
                    return `
                      <div class="space-y-2">
                        <div class="relative aspect-video w-full rounded-xl overflow-hidden bg-black border border-slate-200 dark:border-slate-800">
                          <iframe src="${esc(embedSrc)}" title="${esc(vf.originalName || c.title)}" class="w-full h-full border-0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                        </div>
                        <div class="text-xs text-slate-500 dark:text-slate-400 truncate">${esc(vf.originalName || c.title)}</div>
                      </div>
                    `;
                  }
                  return `
                    <div class="space-y-2">
                      <video controls controlsList="nodownload" class="w-full rounded-xl bg-black max-h-[480px]" src="${esc(withAuthParam(vf.accessUrl))}"></video>
                      <div class="text-xs text-slate-500 dark:text-slate-400">${esc(vf.originalName)} · ${formatBytes(vf.sizeBytes)}</div>
                    </div>
                  `;
                })
                .join('')}
            </section>`
          : ''
      }

      <!-- PDF Preview -->
      ${
        pdfFiles.length
          ? `<section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-display text-lg font-semibold text-slate-900 dark:text-white">PDF Document Preview</h3>
                <div class="flex items-center gap-2 text-xs">
                  <button type="button" id="pub-pdf-zoom-out" class="min-w-[34px] min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">−</button>
                  <span id="pub-pdf-zoom-label" class="font-mono tabular-nums w-12 text-center">100%</span>
                  <button type="button" id="pub-pdf-zoom-in" class="min-w-[34px] min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">+</button>
                  <button type="button" id="pub-pdf-fullscreen-btn" class="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-[#0F2547] dark:text-sky-400">Full Screen</button>
                </div>
              </div>
              ${pdfFiles
                .map(
                  (pf, idx) => `
                  <div class="space-y-2">
                    <div class="relative overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 h-[380px] sm:h-[500px]">
                      <iframe ${idx === 0 ? 'id="pub-pdf-frame"' : ''} src="${esc(withAuthParam(pf.accessUrl))}#toolbar=1" title="${esc(pf.originalName)}" class="w-full h-full border-0 origin-top-left"></iframe>
                    </div>
                    <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span class="truncate">${esc(pf.originalName)} · ${formatBytes(pf.sizeBytes)}</span>
                      <a href="${esc(withAuthParam(`${pf.accessUrl}${pf.accessUrl.includes('?') ? '&' : '?'}download=1`))}" class="font-semibold text-[#0F2547] dark:text-sky-400 hover:underline whitespace-nowrap">Download PDF</a>
                    </div>
                  </div>
                `
                )
                .join('')}
            </section>`
          : ''
      }

      <!-- Attached Images -->
      ${
        imageFiles.length
          ? `<section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-3">
              <h3 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Attached Images (${imageFiles.length})</h3>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                ${imageFiles
                  .map((imgF) => {
                    const fullSrc = withAuthParam(imgF.accessUrl);
                    const thumbSrc = `${fullSrc}${fullSrc.includes('?') ? '&' : '?'}w=480`;
                    return `
                      <button type="button" data-gallery-src="${esc(fullSrc)}" data-gallery-name="${esc(imgF.originalName)}" class="pub-prev-gallery group text-left rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120]">
                        <div class="aspect-[4/3] w-full overflow-hidden">
                          <img src="${esc(thumbSrc)}" alt="${esc(imgF.originalName)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200" />
                        </div>
                        <div class="px-2.5 py-1.5 text-[11px] text-slate-600 dark:text-slate-300 truncate">${esc(imgF.originalName)}</div>
                      </button>
                    `;
                  })
                  .join('')}
              </div>
            </section>`
          : ''
      }

      <!-- Rich-Text Body & Documents -->
      ${
        hasProse || docFiles.length || !hasAnyContent
          ? `<section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8 space-y-5">
              ${
                hasProse
                  ? `<div class="reading-prose">${c.bodyHtml}</div>`
                  : !hasAnyContent
                  ? `<p class="text-sm text-slate-500 dark:text-slate-400">No body text or media attachments are linked to this publication yet.</p>`
                  : ''
              }
              ${
                docFiles.length
                  ? `<div class="${hasProse ? 'pt-5 border-t border-slate-200 dark:border-slate-800' : ''} space-y-3">
                      <h3 class="text-sm font-semibold text-slate-900 dark:text-white">Attached Document Files</h3>
                      ${docFiles
                        .map(
                          (df) => `
                          <div class="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] space-y-1.5 text-xs">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                              <span class="font-medium text-slate-900 dark:text-slate-100">${esc(df.originalName)} · ${formatBytes(df.sizeBytes)}</span>
                              <a href="${esc(withAuthParam(`${df.accessUrl}${df.accessUrl.includes('?') ? '&' : '?'}download=1`))}" class="font-semibold text-[#0F2547] dark:text-sky-400 hover:underline whitespace-nowrap">Download File</a>
                            </div>
                            <p class="text-[11px] text-slate-500 dark:text-slate-400">${esc(df.previewNote || 'Inline browser preview is not supported for this document format. Download the file to view it.')}</p>
                          </div>
                        `
                        )
                        .join('')}
                    </div>`
                  : ''
              }
            </section>`
          : ''
      }

      <!-- Close Preview CTA -->
      <div>
        <a href="#/creator/published/${c.id}" class="w-full min-h-[46px] inline-flex items-center justify-center rounded-xl bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 text-sm font-semibold transition-colors">
          Close Preview
        </a>
      </div>
    </div>
  `;
}

export function renderPublishedAnalyticsHtml(payload) {
  const c = payload?.content;
  const stats = payload?.stats || {};
  const pc = stats.periodComparison || {};

  if (!c) {
    return `
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center space-y-3">
        <div class="text-base font-semibold text-slate-900 dark:text-white">Analytics unavailable</div>
        <a href="#/creator/published" class="inline-flex items-center px-4 py-2 text-xs font-semibold rounded-xl bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">← Back to Published Content</a>
      </div>
    `;
  }

  const metaItems = [c.classLevel, c.subjectName || c.categoryName, c.contentType].filter(Boolean);

  const metricCards = [
    {
      label: 'Total Views',
      val: Number(stats.viewsCount || 0).toLocaleString('en-IN'),
      sub: 'All-time views',
      tone: 'text-sky-600 dark:text-sky-400',
    },
    {
      label: 'Unique Views',
      val: Number(stats.uniqueViewsCount || 0).toLocaleString('en-IN'),
      sub: 'Signed-in readers',
      tone: 'text-indigo-600 dark:text-indigo-400',
    },
    {
      label: 'Downloads',
      val: Number(stats.downloadsCount || 0).toLocaleString('en-IN'),
      sub: `${Number(pc.downloadsLast30d || 0).toLocaleString('en-IN')} in last 30d`,
      tone: 'text-blue-600 dark:text-sky-400',
    },
    {
      label: 'Engagement',
      val: `${Number(stats.likesCount || 0).toLocaleString('en-IN')} / ${Number(stats.commentsCount || 0).toLocaleString('en-IN')}`,
      sub: 'Likes / Comments',
      tone: 'text-rose-600 dark:text-rose-400',
    },
  ];

  if (!c.isFree) {
    metricCards.push(
      {
        label: 'Sales',
        val: Number(stats.salesCount || 0).toLocaleString('en-IN'),
        sub: `${Number(pc.salesLast30d || 0).toLocaleString('en-IN')} in last 30d`,
        tone: 'text-emerald-600 dark:text-emerald-400',
      },
      {
        label: 'Revenue',
        val: formatInr(stats.netEarningsInr || 0),
        sub: `${formatInr(pc.earningsLast30dInr || 0)} in last 30d`,
        tone: 'text-emerald-700 dark:text-emerald-400',
      }
    );
  }

  const buildDeltaRow = (title, currentVal, growthPct, formatter = (v) => Number(v || 0).toLocaleString('en-IN')) => {
    const hasPct = growthPct !== null && growthPct !== undefined && !Number.isNaN(Number(growthPct));
    const pctNum = hasPct ? Number(growthPct) : 0;
    const pctText = hasPct
      ? `${pctNum > 0 ? '+' : ''}${pctNum.toFixed(1)}% compared to previous 30 days`
      : `${formatter(currentVal)} in the last 30 days (no prior 30-day baseline yet)`;
    const toneClass = hasPct
      ? pctNum > 0
        ? 'text-emerald-700 dark:text-emerald-400'
        : pctNum < 0
        ? 'text-red-600 dark:text-red-400'
        : 'text-slate-600 dark:text-slate-300'
      : 'text-slate-600 dark:text-slate-300';

    return `
      <div class="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs font-medium text-slate-600 dark:text-slate-300">${esc(title)}</span>
        <span class="text-xs font-semibold tabular-nums ${toneClass}">${esc(pctText)}</span>
      </div>
    `;
  };

  return `
    <div id="pub-analytics-root" class="space-y-5">
      <!-- Top Bar -->
      <div class="flex items-center justify-between gap-3">
        <a href="#/creator/published/${c.id}" class="inline-flex items-center gap-1.5 min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          <span>Back</span>
        </a>
        <h1 class="font-display text-base sm:text-xl font-semibold text-slate-900 dark:text-white truncate">Content Analytics</h1>
        <a href="#/creator/published/${c.id}/preview" class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline whitespace-nowrap">Preview</a>
      </div>

      <!-- Content Summary Card -->
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex items-center gap-3.5">
        ${renderCardThumbHtml(c.coverImageUrl, c.title, 'w-16 h-12 sm:w-20 sm:h-16')}
        <div class="min-w-0 flex-1">
          <div class="font-display text-sm sm:text-base font-semibold text-slate-900 dark:text-white truncate">${esc(c.title)}</div>
          ${metaItems.length ? `<div class="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">${metaItems.map((m) => esc(m)).join(' · ')}</div>` : ''}
          <div class="text-xs font-semibold mt-1 ${c.isFree ? 'text-emerald-700 dark:text-emerald-400' : 'text-[#0F2547] dark:text-sky-300'}">${c.isFree ? 'Free Publication' : `Paid · ${formatInr(c.priceInr)}`}</div>
        </div>
      </div>

      <!-- Metrics Grid -->
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        ${metricCards
          .map(
            (card) => `
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
            <div class="text-xs text-slate-500 dark:text-slate-400">${esc(card.label)}</div>
            <div class="font-mono text-xl sm:text-2xl font-bold mt-1 tabular-nums ${card.tone}">${esc(card.val)}</div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">${esc(card.sub)}</div>
          </div>
        `
          )
          .join('')}
      </div>

      <!-- Performance Overview -->
      <section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white">Performance Overview</h2>
          <span class="text-[11px] text-slate-500 dark:text-slate-400">30-Day Window</span>
        </div>
        <div class="space-y-2.5">
          ${buildDeltaRow('Downloads Trend', pc.downloadsLast30d, pc.downloadsGrowthPct)}
          ${
            !c.isFree
              ? `${buildDeltaRow('Paid Sales Trend', pc.salesLast30d, pc.salesGrowthPct)}
                 ${buildDeltaRow('Net Revenue Trend', pc.earningsLast30dInr, pc.earningsGrowthPct, (v) => formatInr(v))}`
              : ''
          }
        </div>
      </section>
    </div>
  `;
}

export function openPublishedActionMenu({ triggerEl, item, onPreview, onEdit, onDuplicate, onMoveToDraft, onDelete }) {
  cleanupPublishedFloatingMenu();
  if (!triggerEl || !item) return;

  const isMobile = window.innerWidth < 640;
  const root = document.createElement('div');
  root.id = 'pub-action-menu-root';
  root.className = 'fixed inset-0 z-50';

  const menuOptionsHtml = `
    <button type="button" data-action="preview" role="menuitem" class="pub-menu-item w-full min-h-[46px] px-4 py-2.5 flex items-center gap-3 text-left text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors">
      <svg class="w-4.5 h-4.5 text-slate-500 dark:text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      <span>Preview Content</span>
    </button>
    <button type="button" data-action="edit" role="menuitem" class="pub-menu-item w-full min-h-[46px] px-4 py-2.5 flex items-center gap-3 text-left text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors">
      <svg class="w-4.5 h-4.5 text-slate-500 dark:text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
      <span>Edit Content</span>
    </button>
    <button type="button" data-action="duplicate" role="menuitem" class="pub-menu-item w-full min-h-[46px] px-4 py-2.5 flex items-center gap-3 text-left text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors">
      <svg class="w-4.5 h-4.5 text-slate-500 dark:text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
      <span>Duplicate Content</span>
    </button>
    <button type="button" data-action="move-to-draft" role="menuitem" class="pub-menu-item w-full min-h-[46px] px-4 py-2.5 flex items-center gap-3 text-left text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors">
      <svg class="w-4.5 h-4.5 text-slate-500 dark:text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
      <span>Move to Draft</span>
    </button>
    <div class="my-1 border-t border-slate-100 dark:border-slate-800"></div>
    <button type="button" data-action="delete" role="menuitem" class="pub-menu-item w-full min-h-[46px] px-4 py-2.5 flex items-center gap-3 text-left text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors">
      <svg class="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      <span>Delete Content</span>
    </button>
  `;

  const metaParts = buildMetaLine(item);

  if (isMobile) {
    root.innerHTML = `
      <div id="pub-menu-backdrop" class="fixed inset-0 bg-slate-950/60 backdrop-blur-[2px]"></div>
      <div id="pub-menu-panel" role="menu" aria-label="Content actions" class="fixed inset-x-0 bottom-0 bg-white dark:bg-[#111A2E] border-t border-slate-200 dark:border-slate-800 rounded-t-2xl shadow-2xl pb-5 pt-2.5 overflow-hidden">
        <div class="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mb-3"></div>
        <div class="px-4 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            ${renderCardThumbHtml(item.coverImageUrl, item.title, 'w-14 h-11')}
            <div class="min-w-0">
              <div class="font-display text-sm font-semibold text-slate-900 dark:text-white truncate">${esc(item.title)}</div>
              ${metaParts.length ? `<div class="text-xs text-slate-500 dark:text-slate-400 truncate">${metaParts.map((p) => esc(p)).join(' · ')}</div>` : ''}
            </div>
          </div>
          <button type="button" id="pub-menu-close-btn" aria-label="Close menu" class="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="py-1.5">${menuOptionsHtml}</div>
      </div>
    `;
  } else {
    root.innerHTML = `
      <div id="pub-menu-backdrop" class="fixed inset-0 bg-transparent"></div>
      <div id="pub-menu-panel" role="menu" aria-label="Content actions" class="fixed w-56 bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1.5 overflow-hidden">
        ${menuOptionsHtml}
      </div>
    `;
  }

  document.body.appendChild(root);
  triggerEl.setAttribute('aria-expanded', 'true');

  if (!isMobile) {
    const panel = document.getElementById('pub-menu-panel');
    if (panel) {
      const rect = triggerEl.getBoundingClientRect();
      const panelW = panel.offsetWidth || 224;
      const panelH = panel.offsetHeight || 260;
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
    activeFloatingMenuCleanup = null;
  };

  activeFloatingMenuCleanup = closeMenu;
  document.addEventListener('keydown', onKeyDown);
  document.getElementById('pub-menu-backdrop')?.addEventListener('click', closeMenu);
  document.getElementById('pub-menu-close-btn')?.addEventListener('click', closeMenu);

  root.querySelectorAll('.pub-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      closeMenu();
      if (action === 'preview') onPreview?.(item);
      else if (action === 'edit') onEdit?.(item);
      else if (action === 'duplicate') onDuplicate?.(item);
      else if (action === 'move-to-draft') onMoveToDraft?.(item);
      else if (action === 'delete') onDelete?.(item);
    });
  });
}

function openConfirmDialog({ title, message, confirmLabel, confirmTone = 'danger', iconTone = 'red', iconPath, onConfirm }) {
  openModal({
    title,
    widthClass: 'max-w-sm',
    bodyHtml: `
      <div class="text-center space-y-4">
        <div class="w-12 h-12 rounded-full mx-auto flex items-center justify-center ${
          iconTone === 'amber'
            ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
            : 'bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400'
        }">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${iconPath}"/></svg>
        </div>
        <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">${esc(message)}</p>
        <div class="grid grid-cols-2 gap-2.5 pt-2">
          <button type="button" id="pub-confirm-cancel" class="min-h-[42px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            Cancel
          </button>
          <button type="button" id="pub-confirm-submit" class="min-h-[42px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl text-white transition-colors ${
            confirmTone === 'amber'
              ? 'bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950'
              : 'bg-red-600 hover:bg-red-700'
          }">
            ${esc(confirmLabel)}
          </button>
        </div>
      </div>
    `,
    onMount: (close) => {
      document.getElementById('pub-confirm-cancel')?.addEventListener('click', close);
      const confirmBtn = document.getElementById('pub-confirm-submit');
      confirmBtn?.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Processing...';
        try {
          await onConfirm(close);
        } catch (err) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = confirmLabel;
          showToast(err?.message || 'Action failed.', 'error');
        }
      });
    },
  });
}

async function handleDuplicateContent(item, onComplete) {
  showToast('Creating draft duplicate...', 'info');
  const res = await apiFetch(`/api/creator/contents/${item.id}/duplicate`, { method: 'POST' });
  const newDraft = res?.content;
  showToast(res?.message || 'Content duplicated as a draft.', 'success');
  if (newDraft?.id) {
    openModal({
      title: 'Draft Copy Created',
      widthClass: 'max-w-md',
      bodyHtml: `
        <div class="space-y-4">
          <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            A new independent draft copy <strong class="text-slate-900 dark:text-white">${esc(newDraft.title)}</strong> has been created with zeroed analytics.
          </p>
          <div class="flex flex-wrap justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button type="button" id="pub-dup-stay" class="min-h-[40px] px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">Stay Here</button>
            <button type="button" id="pub-dup-open" class="min-h-[40px] px-4 py-2 text-xs font-semibold rounded-xl bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Open Draft</button>
          </div>
        </div>
      `,
      onMount: (close) => {
        document.getElementById('pub-dup-stay')?.addEventListener('click', () => {
          close();
          onComplete?.();
        });
        document.getElementById('pub-dup-open')?.addEventListener('click', () => {
          close();
          window.location.hash = `#/creator/edit/${newDraft.id}?from=published`;
        });
      },
    });
  } else {
    onComplete?.();
  }
}

function handleMoveToDraft(item, onSuccess) {
  openConfirmDialog({
    title: 'Move to Draft?',
    message: `Are you sure you want to move "${item.title}" to Draft? It will be hidden from public listings while preserving your analytics, earnings, and student purchases.`,
    confirmLabel: 'Move to Draft',
    confirmTone: 'amber',
    iconTone: 'amber',
    iconPath: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4',
    onConfirm: async (close) => {
      const res = await apiFetch(`/api/creator/contents/${item.id}/move-to-draft`, { method: 'POST' });
      close();
      showToast(res?.message || 'Content moved to Draft successfully.', 'success');
      await onSuccess?.();
    },
  });
}

function handleDeleteContent(item, onSuccess) {
  openConfirmDialog({
    title: 'Delete Content',
    message: `Are you sure you want to delete "${item.title}"? This content will be moved to Trash. You may be able to recover it later.`,
    confirmLabel: 'Move to Trash',
    confirmTone: 'danger',
    iconTone: 'red',
    iconPath: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    onConfirm: async (close) => {
      const res = await apiFetch(`/api/creator/contents/${item.id}`, { method: 'DELETE' });
      close();
      showToast(res?.message || 'Content moved to Trash (recoverable for 15 days).', 'success');
      await onSuccess?.();
    },
  });
}

export function wirePublishedListEvents(container, initialPayload) {
  let currentPayload = initialPayload;
  let searchDebounce = null;
  let isMutating = false;

  const refreshList = async () => {
    const bodyEl = document.getElementById('creator-tab-body');
    if (!bodyEl) return;
    bodyEl.style.opacity = '0.65';
    try {
      const fresh = await apiFetch(buildPublishedListUrl(), { noCache: true });
      if (fresh.pagination && publishedListState.page > fresh.pagination.totalPages) {
        publishedListState.page = fresh.pagination.totalPages;
        const retry = await apiFetch(buildPublishedListUrl(), { noCache: true });
        currentPayload = retry;
      } else {
        currentPayload = fresh;
      }
      bodyEl.innerHTML = renderPublishedContentSectionHtml(currentPayload);
      bodyEl.style.opacity = '1';
      bindControls();
    } catch (err) {
      bodyEl.style.opacity = '1';
      showToast(err?.message || 'Unable to load published content.', 'error');
    }
  };

  const resetAllFilters = () => {
    publishedListState.q = '';
    publishedListState.tier = 'all';
    publishedListState.contentType = '';
    publishedListState.categoryId = '';
    publishedListState.subjectId = '';
    publishedListState.dateRange = 'all';
    publishedListState.sort = 'latest';
    publishedListState.page = 1;
    refreshList();
  };

  const bindControls = () => {
    const searchInput = document.getElementById('pub-search-input');
    searchInput?.addEventListener('input', () => {
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        publishedListState.q = searchInput.value;
        publishedListState.page = 1;
        refreshList();
      }, 280);
    });
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (searchDebounce) clearTimeout(searchDebounce);
        publishedListState.q = searchInput.value;
        publishedListState.page = 1;
        refreshList();
      }
    });

    document.getElementById('pub-search-clear')?.addEventListener('click', () => {
      publishedListState.q = '';
      publishedListState.page = 1;
      refreshList();
    });

    container.querySelectorAll('.pub-tier-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextTier = btn.dataset.tier || 'all';
        if (publishedListState.tier === nextTier) return;
        publishedListState.tier = nextTier;
        publishedListState.page = 1;
        refreshList();
      });
    });

    document.getElementById('pub-filters-toggle')?.addEventListener('click', () => {
      publishedListState.filtersOpen = !publishedListState.filtersOpen;
      const panel = document.getElementById('pub-filters-panel');
      const btn = document.getElementById('pub-filters-toggle');
      panel?.classList.toggle('hidden', !publishedListState.filtersOpen);
      panel?.classList.toggle('grid', publishedListState.filtersOpen);
      btn?.setAttribute('aria-expanded', publishedListState.filtersOpen ? 'true' : 'false');
    });

    document.getElementById('pub-sort-select')?.addEventListener('change', (e) => {
      publishedListState.sort = e.target.value || 'latest';
      publishedListState.page = 1;
      refreshList();
    });

    document.getElementById('pub-type-select')?.addEventListener('change', (e) => {
      publishedListState.contentType = e.target.value || '';
      publishedListState.page = 1;
      refreshList();
    });

    document.getElementById('pub-category-select')?.addEventListener('change', (e) => {
      publishedListState.categoryId = e.target.value || '';
      publishedListState.page = 1;
      refreshList();
    });

    document.getElementById('pub-subject-select')?.addEventListener('change', (e) => {
      publishedListState.subjectId = e.target.value || '';
      publishedListState.page = 1;
      refreshList();
    });

    document.getElementById('pub-date-select')?.addEventListener('change', (e) => {
      publishedListState.dateRange = e.target.value || 'all';
      publishedListState.page = 1;
      refreshList();
    });

    document.getElementById('pub-reset-filters-btn')?.addEventListener('click', resetAllFilters);
    document.getElementById('pub-empty-reset-btn')?.addEventListener('click', resetAllFilters);

    container.querySelectorAll('.pub-page-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextPage = Number(btn.dataset.page);
        if (!nextPage || nextPage < 1 || nextPage === publishedListState.page) return;
        publishedListState.page = nextPage;
        refreshList();
      });
    });

    container.querySelectorAll('.pub-nav-detail').forEach((link) => {
      link.addEventListener('click', () => {
        publishedListState.scrollY = window.scrollY;
      });
    });

    container.querySelectorAll('.pub-menu-trigger').forEach((triggerEl) => {
      triggerEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = Number(triggerEl.dataset.id);
        const item = (currentPayload?.items || []).find((x) => Number(x.id) === id);
        if (!item) return;

        openPublishedActionMenu({
          triggerEl,
          item,
          onPreview: (selected) => {
            publishedListState.scrollY = window.scrollY;
            window.location.hash = `#/creator/published/${selected.id}/preview`;
          },
          onEdit: (selected) => {
            publishedListState.scrollY = window.scrollY;
            window.location.hash = `#/creator/edit/${selected.id}?from=published`;
          },
          onDuplicate: async (selected) => {
            if (isMutating) return;
            isMutating = true;
            try {
              await handleDuplicateContent(selected);
            } catch (err) {
              showToast(err?.message || 'Unable to duplicate content.', 'error');
            } finally {
              isMutating = false;
            }
          },
          onMoveToDraft: (selected) => {
            handleMoveToDraft(selected, refreshList);
          },
          onDelete: (selected) => {
            handleDeleteContent(selected, refreshList);
          },
        });
      });
    });
  };

  bindControls();

  if (publishedListState.scrollY > 0) {
    const targetY = publishedListState.scrollY;
    publishedListState.scrollY = 0;
    requestAnimationFrame(() => window.scrollTo({ top: targetY, behavior: 'instant' }));
  }
}

export function wirePublishedSubViewEvents(container, subView, detailPayload) {
  const item = detailPayload?.content;
  if (!item) return;

  if (!subView) {
    // Content Details view handlers
    document.getElementById('pub-detail-back-btn')?.addEventListener('click', () => {
      window.location.hash = '#/creator/published';
    });

    const menuTrigger = document.getElementById('pub-detail-menu-btn');
    let isDuplicating = false;
    menuTrigger?.addEventListener('click', (e) => {
      e.preventDefault();
      openPublishedActionMenu({
        triggerEl: menuTrigger,
        item,
        onPreview: (selected) => {
          window.location.hash = `#/creator/published/${selected.id}/preview`;
        },
        onEdit: (selected) => {
          window.location.hash = `#/creator/edit/${selected.id}?from=published`;
        },
        onDuplicate: async (selected) => {
          if (isDuplicating) return;
          isDuplicating = true;
          try {
            await handleDuplicateContent(selected);
          } catch (err) {
            showToast(err?.message || 'Unable to duplicate content.', 'error');
          } finally {
            isDuplicating = false;
          }
        },
        onMoveToDraft: (selected) => {
          handleMoveToDraft(selected, () => {
            window.location.hash = '#/creator/published';
          });
        },
        onDelete: (selected) => {
          handleDeleteContent(selected, () => {
            window.location.hash = '#/creator/published';
          });
        },
      });
    });

    document.getElementById('pub-detail-unpublish-btn')?.addEventListener('click', () => {
      handleMoveToDraft(item, () => {
        window.location.hash = '#/creator/published';
      });
    });
  } else if (subView === 'preview') {
    // PDF zoom + fullscreen + gallery lightbox inside Creator Content Preview
    let pdfZoom = 100;
    const applyZoom = () => {
      const frame = document.getElementById('pub-pdf-frame');
      const label = document.getElementById('pub-pdf-zoom-label');
      if (frame && label) {
        frame.style.transform = `scale(${pdfZoom / 100})`;
        frame.style.width = `${10000 / pdfZoom}%`;
        frame.style.height = `${10000 / pdfZoom}%`;
        label.textContent = `${pdfZoom}%`;
      }
    };
    document.getElementById('pub-pdf-zoom-in')?.addEventListener('click', () => {
      pdfZoom = Math.min(150, pdfZoom + 15);
      applyZoom();
    });
    document.getElementById('pub-pdf-zoom-out')?.addEventListener('click', () => {
      pdfZoom = Math.max(70, pdfZoom - 15);
      applyZoom();
    });
    document.getElementById('pub-pdf-fullscreen-btn')?.addEventListener('click', () => {
      const frame = document.getElementById('pub-pdf-frame');
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

    const galleryBtns = Array.from(container.querySelectorAll('.pub-prev-gallery'));
    galleryBtns.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        const images = galleryBtns.map((b, i) => ({
          src: b.dataset.gallerySrc,
          title: b.dataset.galleryName || `Image ${i + 1}`,
        }));
        openImageLightbox({ images, startIndex: idx });
      });
    });
  }
}
