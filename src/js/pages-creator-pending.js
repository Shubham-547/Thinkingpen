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
  resolveVideoEmbed,
  showToast,
  store,
} from './api.js';

export const pendingListState = {
  q: '',
  status: 'all', // 'all' | 'under_review' | 'changes_requested'
  contentType: '',
  categoryId: '',
  subjectId: '',
  pricing: 'all', // 'all' | 'free' | 'paid'
  sort: 'latest', // 'latest' | 'oldest' | 'relevant'
  userPickedSort: false,
  page: 1,
  limit: 10,
  filtersOpen: false,
  scrollY: 0,
};

let activePendingMenuCleanup = null;

export function cleanupPendingFloatingMenu() {
  if (activePendingMenuCleanup) {
    activePendingMenuCleanup();
    activePendingMenuCleanup = null;
  }
}

export function buildPendingListUrl() {
  const qs = new URLSearchParams();
  if (pendingListState.q.trim()) qs.set('q', pendingListState.q.trim());
  if (pendingListState.status !== 'all') qs.set('status', pendingListState.status);
  if (pendingListState.contentType) qs.set('contentType', pendingListState.contentType);
  if (pendingListState.categoryId) qs.set('categoryId', pendingListState.categoryId);
  if (pendingListState.subjectId) qs.set('subjectId', pendingListState.subjectId);
  if (pendingListState.pricing !== 'all') qs.set('pricing', pendingListState.pricing);
  const sortVal =
    pendingListState.q.trim() && !pendingListState.userPickedSort
      ? 'relevant'
      : pendingListState.sort || 'latest';
  qs.set('sort', sortVal);
  qs.set('page', String(pendingListState.page || 1));
  qs.set('limit', String(pendingListState.limit || 10));
  return `/api/creator/pending?${qs.toString()}`;
}

function getTitleInitials(title) {
  const words = String(title || 'SP').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'SP';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function renderThumbHtml(url, title, sizeClass = 'w-24 h-20 sm:w-32 sm:h-24') {
  const initials = getTitleInitials(title);
  if (!url) {
    return `
      <div class="${sizeClass} rounded-xl bg-gradient-to-br from-[#0F2547] via-[#1B3B6F] to-[#3B267D] text-white flex flex-col items-center justify-center p-2 shrink-0 select-none">
        <span class="font-display text-sm sm:text-base font-semibold tracking-tight">${esc(initials)}</span>
      </div>
    `;
  }
  const sources = getResponsiveImageSources(url, 320);
  const src = sources?.fallbackSrc || url;
  return `
    <div class="${sizeClass} rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/70 shrink-0 relative">
      <img src="${esc(src)}" alt="${esc(title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
      <div style="display:none" class="absolute inset-0 bg-gradient-to-br from-[#0F2547] via-[#1B3B6F] to-[#3B267D] text-white items-center justify-center font-display text-sm font-semibold">${esc(initials)}</div>
    </div>
  `;
}

function getPendingStatusBadge(status) {
  if (status === 'changes_requested') {
    return {
      label: 'Changes Requested',
      badgeCls: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70',
      dotCls: 'bg-rose-500',
    };
  }
  if (status === 'approved') {
    return {
      label: 'Approved',
      badgeCls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
      dotCls: 'bg-emerald-500',
    };
  }
  if (status === 'rejected' || status === 'removed') {
    return {
      label: status === 'removed' ? 'Removed' : 'Rejected',
      badgeCls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/70',
      dotCls: 'bg-red-500',
    };
  }
  return {
    label: 'Under Review',
    badgeCls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
    dotCls: 'bg-amber-500',
  };
}

function hasActiveFilters() {
  return Boolean(
    pendingListState.q.trim() ||
      pendingListState.contentType ||
      pendingListState.categoryId ||
      pendingListState.subjectId ||
      pendingListState.pricing !== 'all' ||
      (pendingListState.userPickedSort && pendingListState.sort !== 'latest')
  );
}

function countAdvancedFilters() {
  let n = 0;
  if (pendingListState.contentType) n += 1;
  if (pendingListState.subjectId) n += 1;
  if (pendingListState.categoryId) n += 1;
  if (pendingListState.pricing !== 'all') n += 1;
  return n;
}

function renderPendingEmptyStateHtml(isFiltered) {
  if (isFiltered) {
    return `
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-8 sm:p-12 text-center space-y-3">
        <div class="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35"/></svg>
        </div>
        <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">No matching submissions found</h2>
        <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          Try a different keyword or reset the active filters to view your submissions.
        </p>
        <div class="pt-1">
          <button type="button" id="pnd-empty-reset-btn" class="min-h-[40px] px-4 py-2 text-xs font-semibold rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white transition-colors">
            Reset Filters
          </button>
        </div>
      </div>
    `;
  }

  let heading = 'No Pending Submissions';
  let body = 'You have no content currently waiting for review. Upload new material or publish a draft to submit it for moderation.';
  if (pendingListState.status === 'under_review') {
    heading = 'No Content Under Review';
    body = 'None of your submissions are currently waiting in the moderation queue.';
  } else if (pendingListState.status === 'changes_requested') {
    heading = 'No Changes Requested';
    body = 'You have no submissions requiring revisions right now.';
  }

  return `
    <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-8 sm:p-12 text-center space-y-3">
      <div class="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center bg-violet-50 dark:bg-violet-950/60 text-[#5a1fd8] dark:text-violet-300">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      </div>
      <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">${esc(heading)}</h2>
      <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">${esc(body)}</p>
      <div class="pt-1 flex flex-wrap items-center justify-center gap-2.5">
        <a href="#/creator/upload" class="min-h-[40px] inline-flex items-center px-4 py-2 text-xs font-semibold rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white transition-colors">
          + Upload Content
        </a>
        <a href="#/creator/history" class="min-h-[40px] inline-flex items-center px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
          View Submission History
        </a>
      </div>
    </div>
  `;
}

function renderPendingCardHtml(item) {
  const statusInfo = getPendingStatusBadge(item.status);
  const isChangesRequested = item.status === 'changes_requested';
  const metaParts = [item.contentType, item.subjectName || item.categoryName, item.classLevel].filter(Boolean);
  const priceLabel = item.isFree ? 'Free' : `Paid · ${formatInr(item.priceInr)}`;
  const submittedStr = formatDate(item.submittedAt || item.createdAt);
  const reviewedStr = item.lastReviewedAt ? formatDate(item.lastReviewedAt) : 'Awaiting review';

  return `
    <article data-content-id="${item.id}" class="bg-white dark:bg-[#111A2E] border ${
      isChangesRequested
        ? 'border-rose-200/90 dark:border-rose-900/60'
        : 'border-slate-200 dark:border-slate-800'
    } rounded-2xl p-4 sm:p-5 transition-colors hover:border-slate-300 dark:hover:border-slate-700">
      <div class="flex items-start gap-3.5 sm:gap-4">
        <a href="#/creator/pending/${item.id}" class="pnd-nav-detail shrink-0 block">
          ${renderThumbHtml(item.coverImageUrl, item.title)}
        </a>

        <div class="flex-1 min-w-0 space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusInfo.badgeCls}">
                  <span class="w-1.5 h-1.5 rounded-full ${statusInfo.dotCls}"></span>
                  ${esc(statusInfo.label)}
                </span>
                ${
                  Number(item.resubmissionCount || 0) > 0
                    ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">Resubmitted ${item.resubmissionCount}x</span>`
                    : ''
                }
                <span class="text-[11px] font-mono font-semibold ${item.isFree ? 'text-emerald-700 dark:text-emerald-400' : 'text-[#0F2547] dark:text-sky-300'}">${esc(priceLabel)}</span>
              </div>

              <a href="#/creator/pending/${item.id}" class="pnd-nav-detail block font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white hover:text-[#5a1fd8] dark:hover:text-sky-300 leading-snug line-clamp-2">
                ${esc(item.title)}
              </a>
            </div>

            <button
              type="button"
              data-id="${item.id}"
              aria-label="Actions for ${esc(item.title)}"
              aria-haspopup="menu"
              aria-expanded="false"
              class="pnd-menu-trigger min-w-[44px] min-h-[44px] -mr-2 -mt-1 flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white transition-colors shrink-0"
            >
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            ${metaParts.map((m) => `<span>${esc(m)}</span>`).join('<span aria-hidden="true">·</span>')}
          </div>

          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400 pt-0.5">
            <span>Submitted: <strong class="font-medium text-slate-700 dark:text-slate-200">${esc(submittedStr)}</strong></span>
            <span>Last Reviewed: <strong class="font-medium text-slate-700 dark:text-slate-200">${esc(reviewedStr)}</strong></span>
          </div>

          ${
            item.feedbackSnippet
              ? `<div class="mt-2 p-2.5 sm:p-3 rounded-xl border ${
                  isChangesRequested
                    ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200/80 dark:border-rose-900/60 text-rose-900 dark:text-rose-200'
                    : 'bg-slate-50 dark:bg-[#0B1120] border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                } text-xs leading-relaxed">
                  <span class="font-semibold">Admin Feedback:</span> ${esc(item.feedbackSnippet)}
                </div>`
              : ''
          }

          <div class="pt-2 flex flex-wrap items-center gap-2">
            <a href="#/creator/pending/${item.id}" class="pnd-nav-detail min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              <span>View Details</span>
              <span aria-hidden="true">→</span>
            </a>
            ${
              isChangesRequested
                ? `<a href="#/creator/edit/${item.id}?from=pending" class="pnd-nav-edit min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white transition-colors">
                    <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                    <span>Edit &amp; Resubmit</span>
                  </a>`
                : ''
            }
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderPendingPaginationHtml(pagination) {
  const { page = 1, totalPages = 1, total = 0, limit = 10 } = pagination || {};
  if (total === 0) return '';
  const start = (page - 1) * limit + 1;
  const end = Math.min(total, page * limit);
  const pages = [];
  for (let p = 1; p <= totalPages; p += 1) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== '...') pages.push('...');
  }

  return `
    <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
      <div class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
        Showing <strong class="text-slate-700 dark:text-slate-200">${start}–${end}</strong> of <strong class="text-slate-700 dark:text-slate-200">${total}</strong> submissions
      </div>
      ${
        totalPages > 1
          ? `<div class="flex items-center gap-1.5">
              <button type="button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} class="pnd-page-btn min-w-[38px] min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40">← Prev</button>
              ${pages
                .map((p) =>
                  p === '...'
                    ? `<span class="px-1.5 text-xs text-slate-400">…</span>`
                    : `<button type="button" data-page="${p}" class="pnd-page-btn min-w-[38px] min-h-[38px] px-3 rounded-xl text-xs font-semibold tabular-nums ${
                        p === page
                          ? 'bg-[#5a1fd8] text-white'
                          : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }">${p}</button>`
                )
                .join('')}
              <button type="button" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''} class="pnd-page-btn min-w-[38px] min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40">Next →</button>
            </div>`
          : ''
      }
    </div>
  `;
}

function renderPendingDynamicRegionHtml(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const counts = payload?.counts || { all: 0, underReview: 0, changesRequested: 0 };
  const pagination = payload?.pagination || { page: 1, limit: 10, total: items.length, totalPages: 1 };
  const meta = payload?.filtersMeta || { contentTypes: [], subjects: [], categories: [] };

  const typeOptions = Array.from(new Set([...(meta.contentTypes || []), ...CONTENT_TYPES]));
  const subOptions = meta.subjects?.length ? meta.subjects : store.subjects || [];
  const catOptions = meta.categories?.length ? meta.categories : store.categories || [];
  const sortVal =
    pendingListState.q.trim() && !pendingListState.userPickedSort
      ? 'relevant'
      : pendingListState.sort || 'latest';
  const advCount = countAdvancedFilters();
  const isFiltered = hasActiveFilters();

  const statusTabs = [
    { key: 'all', label: 'All', count: Number(counts.all || 0) },
    { key: 'under_review', label: 'Under Review', count: Number(counts.underReview || 0) },
    { key: 'changes_requested', label: 'Changes Requested', count: Number(counts.changesRequested || 0) },
  ];

  return `
    <div class="space-y-4">
      <!-- Status Tabs + Filter Controls -->
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 sm:p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2.5">
          <div class="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5" role="tablist" aria-label="Submission status filter">
            ${statusTabs
              .map((t) => {
                const active = pendingListState.status === t.key;
                return `
                  <button
                    type="button"
                    role="tab"
                    aria-selected="${active ? 'true' : 'false'}"
                    data-status="${t.key}"
                    class="pnd-status-tab min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums border ${
                      active
                        ? 'bg-[#5a1fd8] border-[#5a1fd8] text-white'
                        : 'bg-slate-50 dark:bg-[#0B1120] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                    }"
                  >
                    <span>${esc(t.label)}</span>
                    <span class="px-1.5 py-0.5 rounded-full text-[11px] ${
                      active ? 'bg-white/20 text-white' : 'bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }">${t.count}</span>
                  </button>
                `;
              })
              .join('')}
          </div>

          <div class="flex items-center gap-2 ml-auto">
            <button
              type="button"
              id="pnd-filters-toggle"
              aria-expanded="${pendingListState.filtersOpen ? 'true' : 'false'}"
              class="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                pendingListState.filtersOpen || advCount > 0
                  ? 'border-[#5a1fd8] text-[#5a1fd8] bg-violet-50/70 dark:border-sky-400 dark:text-sky-300 dark:bg-sky-950/40'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>
              <span>Filters${advCount > 0 ? ` (${advCount})` : ''}</span>
            </button>

            <label for="pnd-sort-select" class="sr-only">Sort pending submissions</label>
            <select
              id="pnd-sort-select"
              class="min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#5a1fd8] dark:focus:border-sky-400"
            >
              <option value="latest" ${sortVal === 'latest' ? 'selected' : ''}>Latest Submitted</option>
              <option value="oldest" ${sortVal === 'oldest' ? 'selected' : ''}>Oldest Submitted</option>
              <option value="relevant" ${sortVal === 'relevant' ? 'selected' : ''}>Most Relevant</option>
            </select>
          </div>
        </div>

        <!-- Expandable Filter Grid -->
        <div id="pnd-filters-panel" class="${pendingListState.filtersOpen ? 'grid' : 'hidden'} grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800">
          <div>
            <label for="pnd-type-select" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Content Type</label>
            <select id="pnd-type-select" class="w-full min-h-[40px] px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100">
              <option value="">All Content Types</option>
              ${typeOptions
                .map((t) => `<option value="${esc(t)}" ${pendingListState.contentType === t ? 'selected' : ''}>${esc(t)}</option>`)
                .join('')}
            </select>
          </div>
          <div>
            <label for="pnd-subject-select" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Subject</label>
            <select id="pnd-subject-select" class="w-full min-h-[40px] px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100">
              <option value="">All Subjects</option>
              ${subOptions
                .map((s) => `<option value="${s.id}" ${String(pendingListState.subjectId) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`)
                .join('')}
            </select>
          </div>
          <div>
            <label for="pnd-category-select" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Category</label>
            <select id="pnd-category-select" class="w-full min-h-[40px] px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100">
              <option value="">All Categories</option>
              ${catOptions
                .map((cat) => `<option value="${cat.id}" ${String(pendingListState.categoryId) === String(cat.id) ? 'selected' : ''}>${esc(cat.name)}</option>`)
                .join('')}
            </select>
          </div>
          <div>
            <label for="pnd-pricing-select" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Pricing</label>
            <select id="pnd-pricing-select" class="w-full min-h-[40px] px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100">
              <option value="all" ${pendingListState.pricing === 'all' ? 'selected' : ''}>Free &amp; Paid</option>
              <option value="free" ${pendingListState.pricing === 'free' ? 'selected' : ''}>Free Only</option>
              <option value="paid" ${pendingListState.pricing === 'paid' ? 'selected' : ''}>Paid Only</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Cards List or Empty State -->
      ${
        items.length
          ? `<div class="space-y-3">${items.map((item) => renderPendingCardHtml(item)).join('')}</div>`
          : renderPendingEmptyStateHtml(isFiltered)
      }

      ${renderPendingPaginationHtml(pagination)}
    </div>
  `;
}

export function renderPendingSectionHtml(payload) {
  const counts = payload?.counts || { all: 0, underReview: 0, changesRequested: 0 };
  return `
    <div id="pnd-list-root" class="space-y-4 sm:space-y-5">
      <!-- Page Header -->
      <div class="flex flex-wrap items-start sm:items-center justify-between gap-3">
        <div class="flex items-start gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0 mt-0.5">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white leading-tight">Pending Approval &amp; Moderation</h1>
              <span id="pnd-total-badge" class="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 tabular-nums">${Number(counts.all || 0)}</span>
            </div>
            <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">Track submissions currently under review and address moderator feedback.</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <a href="#/creator/history" class="min-h-[42px] inline-flex items-center px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            History
          </a>
          <a href="#/creator/upload" class="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white transition-colors whitespace-nowrap">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
            <span>Upload Content</span>
          </a>
        </div>
      </div>

      <!-- Persistent Search Input (Outside dynamic swap region so focus never drops) -->
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-3.5 flex items-center gap-2.5">
        <div class="relative flex-1 flex items-center">
          <svg class="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35"/></svg>
          <input
            type="search"
            id="pnd-search-input"
            value="${esc(pendingListState.q)}"
            placeholder="Search content..."
            autocomplete="off"
            class="w-full min-h-[44px] pl-10 pr-10 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#5a1fd8] dark:focus:border-sky-400"
          />
          <button
            type="button"
            id="pnd-search-clear"
            aria-label="Clear search"
            class="${pendingListState.q ? 'flex' : 'hidden'} absolute right-2 w-8 h-8 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <button type="button" id="pnd-clear-all-btn" class="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0 transition-colors">
          <span>Clear</span>
        </button>
      </div>

      <div id="pnd-dynamic-region">
        ${renderPendingDynamicRegionHtml(payload)}
      </div>
    </div>
  `;
}

function openPendingActionMenu({ triggerEl, item }) {
  cleanupPendingFloatingMenu();
  if (!triggerEl || !item) return;

  const isMobile = window.innerWidth < 640;
  const isChangesRequested = item.status === 'changes_requested';
  const statusInfo = getPendingStatusBadge(item.status);
  const root = document.createElement('div');
  root.id = 'pnd-action-menu-root';
  root.className = 'fixed inset-0 z-50';

  const options = [
    {
      action: 'details',
      label: 'View Details',
      iconPath: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    },
    {
      action: 'preview',
      label: 'Preview Content',
      iconPath: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    },
  ];

  if (isChangesRequested) {
    options.push(
      {
        action: 'edit',
        label: 'Edit & Resubmit',
        highlight: true,
        iconPath: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
      },
      {
        action: 'feedback',
        label: 'View Feedback',
        iconPath: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z',
      }
    );
  }

  options.push({
    action: 'history',
    label: 'View History',
    iconPath: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  });

  const menuOptionsHtml = options
    .map(
      (opt) => `
      <button type="button" data-action="${opt.action}" role="menuitem" class="pnd-menu-item w-full min-h-[46px] px-4 py-2.5 flex items-center gap-3 text-left text-sm font-medium ${
        opt.highlight
          ? 'text-[#5a1fd8] dark:text-sky-300 font-semibold hover:bg-violet-50 dark:hover:bg-sky-950/40'
          : 'text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80'
      } transition-colors">
        <svg class="w-4.5 h-4.5 shrink-0 ${opt.highlight ? 'text-[#5a1fd8] dark:text-sky-400' : 'text-slate-500 dark:text-slate-400'}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${opt.iconPath}"/></svg>
        <span>${esc(opt.label)}</span>
      </button>
    `
    )
    .join('');

  if (isMobile) {
    root.innerHTML = `
      <div id="pnd-menu-backdrop" class="fixed inset-0 bg-slate-950/60 backdrop-blur-[2px]"></div>
      <div id="pnd-menu-panel" role="menu" aria-label="Submission actions" class="fixed inset-x-0 bottom-0 bg-white dark:bg-[#111A2E] border-t border-slate-200 dark:border-slate-800 rounded-t-2xl shadow-2xl pb-5 pt-2.5 overflow-hidden">
        <div class="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mb-3"></div>
        <div class="px-4 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="font-display text-sm font-semibold text-slate-900 dark:text-white truncate">${esc(item.title)}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400 truncate">${esc(item.contentType)} · ${esc(statusInfo.label)}</div>
          </div>
          <button type="button" id="pnd-menu-close-btn" aria-label="Close menu" class="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="py-1.5">${menuOptionsHtml}</div>
      </div>
    `;
  } else {
    root.innerHTML = `
      <div id="pnd-menu-backdrop" class="fixed inset-0 bg-transparent"></div>
      <div id="pnd-menu-panel" role="menu" aria-label="Submission actions" class="fixed w-56 bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1.5 overflow-hidden">
        ${menuOptionsHtml}
      </div>
    `;
  }

  document.body.appendChild(root);
  triggerEl.setAttribute('aria-expanded', 'true');

  if (!isMobile) {
    const panel = document.getElementById('pnd-menu-panel');
    if (panel) {
      const rect = triggerEl.getBoundingClientRect();
      const panelW = panel.offsetWidth || 224;
      const panelH = panel.offsetHeight || 220;
      const left = Math.max(12, Math.min(window.innerWidth - panelW - 12, rect.right - panelW));
      const fitsBelow = rect.bottom + 6 + panelH <= window.innerHeight - 12;
      const top = fitsBelow ? rect.bottom + 6 : Math.max(12, rect.top - panelH - 6);
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
    activePendingMenuCleanup = null;
  };

  activePendingMenuCleanup = closeMenu;
  document.addEventListener('keydown', onKeyDown);
  document.getElementById('pnd-menu-backdrop')?.addEventListener('click', closeMenu);
  document.getElementById('pnd-menu-close-btn')?.addEventListener('click', closeMenu);

  root.querySelectorAll('.pnd-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      closeMenu();
      pendingListState.scrollY = window.scrollY;
      if (action === 'details') {
        window.location.hash = `#/creator/pending/${item.id}`;
      } else if (action === 'preview') {
        window.location.hash = `#/creator/pending/${item.id}/preview`;
      } else if (action === 'edit') {
        window.location.hash = `#/creator/edit/${item.id}?from=pending`;
      } else if (action === 'feedback') {
        window.location.hash = `#/creator/pending/${item.id}/feedback`;
      } else if (action === 'history') {
        window.location.hash = '#/creator/history';
      }
    });
  });
}

export function wirePendingListEvents(container, initialPayload) {
  let currentPayload = initialPayload;
  let searchDebounce = null;
  let requestSeq = 0;

  const updateClearBtn = () => {
    const clearBtn = document.getElementById('pnd-search-clear');
    const searchInput = document.getElementById('pnd-search-input');
    if (clearBtn && searchInput) {
      const hasVal = searchInput.value.trim().length > 0;
      clearBtn.classList.toggle('hidden', !hasVal);
      clearBtn.classList.toggle('flex', hasVal);
    }
  };

  const refreshDynamicRegion = async () => {
    const regionEl = document.getElementById('pnd-dynamic-region');
    if (!regionEl) return;
    const seq = ++requestSeq;
    regionEl.style.opacity = '0.65';
    try {
      const fresh = await apiFetch(buildPendingListUrl(), { noCache: true });
      if (seq !== requestSeq) return;
      currentPayload = fresh;
      const totalBadge = document.getElementById('pnd-total-badge');
      if (totalBadge) totalBadge.textContent = String(fresh?.counts?.all ?? 0);
      regionEl.innerHTML = renderPendingDynamicRegionHtml(fresh);
      regionEl.style.opacity = '1';
      bindDynamicControls();
    } catch (err) {
      if (seq !== requestSeq) return;
      regionEl.style.opacity = '1';
      regionEl.innerHTML = `
        <div class="bg-white dark:bg-[#111A2E] border border-red-200 dark:border-red-900/60 rounded-2xl p-8 text-center space-y-3">
          <div class="text-sm font-semibold text-red-700 dark:text-red-400">Unable to load pending submissions</div>
          <p class="text-xs text-slate-500 dark:text-slate-400">${esc(err?.message || 'Temporary error loading queue.')}</p>
          <button type="button" id="pnd-retry-btn" class="min-h-[38px] px-4 py-2 text-xs font-semibold rounded-xl bg-[#5a1fd8] text-white">Try Again</button>
        </div>
      `;
      document.getElementById('pnd-retry-btn')?.addEventListener('click', refreshDynamicRegion);
    }
  };

  const resetAllFilters = () => {
    pendingListState.q = '';
    pendingListState.status = 'all';
    pendingListState.contentType = '';
    pendingListState.categoryId = '';
    pendingListState.subjectId = '';
    pendingListState.pricing = 'all';
    pendingListState.sort = 'latest';
    pendingListState.userPickedSort = false;
    pendingListState.page = 1;
    const searchInput = document.getElementById('pnd-search-input');
    if (searchInput) searchInput.value = '';
    updateClearBtn();
    refreshDynamicRegion();
  };

  const searchInput = document.getElementById('pnd-search-input');
  searchInput?.addEventListener('input', () => {
    updateClearBtn();
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      pendingListState.q = searchInput.value;
      pendingListState.page = 1;
      refreshDynamicRegion();
    }, 260);
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchDebounce) clearTimeout(searchDebounce);
      pendingListState.q = searchInput.value;
      pendingListState.page = 1;
      refreshDynamicRegion();
    }
  });

  document.getElementById('pnd-search-clear')?.addEventListener('click', () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    pendingListState.q = '';
    pendingListState.page = 1;
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    updateClearBtn();
    refreshDynamicRegion();
  });

  document.getElementById('pnd-clear-all-btn')?.addEventListener('click', resetAllFilters);

  const bindDynamicControls = () => {
    const region = document.getElementById('pnd-dynamic-region');
    if (!region) return;

    region.querySelectorAll('.pnd-status-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextStatus = btn.dataset.status || 'all';
        if (pendingListState.status === nextStatus) return;
        pendingListState.status = nextStatus;
        pendingListState.page = 1;
        refreshDynamicRegion();
      });
    });

    document.getElementById('pnd-filters-toggle')?.addEventListener('click', () => {
      pendingListState.filtersOpen = !pendingListState.filtersOpen;
      const panel = document.getElementById('pnd-filters-panel');
      const toggleBtn = document.getElementById('pnd-filters-toggle');
      panel?.classList.toggle('hidden', !pendingListState.filtersOpen);
      panel?.classList.toggle('grid', pendingListState.filtersOpen);
      toggleBtn?.setAttribute('aria-expanded', pendingListState.filtersOpen ? 'true' : 'false');
    });

    document.getElementById('pnd-type-select')?.addEventListener('change', (e) => {
      pendingListState.contentType = e.target.value || '';
      pendingListState.page = 1;
      refreshDynamicRegion();
    });

    document.getElementById('pnd-subject-select')?.addEventListener('change', (e) => {
      pendingListState.subjectId = e.target.value || '';
      pendingListState.page = 1;
      refreshDynamicRegion();
    });

    document.getElementById('pnd-category-select')?.addEventListener('change', (e) => {
      pendingListState.categoryId = e.target.value || '';
      pendingListState.page = 1;
      refreshDynamicRegion();
    });

    document.getElementById('pnd-pricing-select')?.addEventListener('change', (e) => {
      pendingListState.pricing = e.target.value || 'all';
      pendingListState.page = 1;
      refreshDynamicRegion();
    });

    document.getElementById('pnd-sort-select')?.addEventListener('change', (e) => {
      pendingListState.sort = e.target.value || 'latest';
      pendingListState.userPickedSort = true;
      pendingListState.page = 1;
      refreshDynamicRegion();
    });

    document.getElementById('pnd-empty-reset-btn')?.addEventListener('click', resetAllFilters);

    region.querySelectorAll('.pnd-page-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextPage = Number(btn.dataset.page);
        if (!nextPage || nextPage < 1 || nextPage === pendingListState.page) return;
        pendingListState.page = nextPage;
        refreshDynamicRegion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    region.querySelectorAll('.pnd-nav-detail, .pnd-nav-edit').forEach((link) => {
      link.addEventListener('click', () => {
        pendingListState.scrollY = window.scrollY;
      });
    });

    region.querySelectorAll('.pnd-menu-trigger').forEach((triggerEl) => {
      triggerEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = Number(triggerEl.dataset.id);
        const item = (currentPayload?.items || []).find((x) => Number(x.id) === id);
        if (!item) return;
        openPendingActionMenu({ triggerEl, item });
      });
    });
  };

  bindDynamicControls();
  if (pendingListState.scrollY > 0) {
    const restoreY = pendingListState.scrollY;
    pendingListState.scrollY = 0;
    requestAnimationFrame(() => window.scrollTo({ top: restoreY, behavior: 'auto' }));
  }
}

export async function renderSubmissionDetailsHtml(payload) {
  const c = payload?.content;
  if (!c) {
    return `
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center space-y-3">
        <div class="text-base font-semibold text-slate-900 dark:text-white">Submission not found</div>
        <p class="text-xs text-slate-500 dark:text-slate-400">This submission could not be located or has been removed.</p>
        <a href="#/creator/pending" class="inline-flex items-center px-4 py-2 text-xs font-semibold rounded-xl bg-[#5a1fd8] text-white">← Back to Pending &amp; Review</a>
      </div>
    `;
  }

  const files = Array.isArray(payload.files) ? payload.files : [];
  const timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
  const feedbackHistory = Array.isArray(payload.feedbackHistory) ? payload.feedbackHistory : [];
  const caps = payload.capabilities || {
    canEditResubmit: c.status === 'changes_requested',
    isUnderReview: c.status === 'pending',
    canAppeal: false,
  };

  const authToken = await getAuthToken();
  const withAuthParam = (url) => {
    if (!url) return '';
    if (url.includes('ft=')) return url;
    if (!authToken) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(authToken)}`;
  };

  const statusInfo = getPendingStatusBadge(c.status);
  const pdfFiles = files.filter((f) => f.fileType === 'pdf');
  const videoFiles = files.filter((f) => f.fileType === 'video');
  const imageFiles = files.filter((f) => f.fileType === 'image');
  const docFiles = files.filter((f) => f.fileType === 'document');
  const plainBody = String(c.bodyHtml || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasProse = plainBody.length > 0;
  const isLongProse = plainBody.length > 360;
  const hasAnyContent = hasProse || files.length > 0;

  const currentFeedback = (c.rejectionReason || '').trim();
  const hasFeedback = Boolean(currentFeedback || feedbackHistory.some((f) => f.feedback));

  return `
    <div id="pnd-detail-root" class="space-y-5 max-w-4xl mx-auto">
      <!-- Top Header -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <a
            href="#/creator/pending"
            aria-label="Back to Pending & Review"
            class="min-w-[42px] min-h-[42px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          </a>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="font-display text-lg sm:text-2xl font-semibold text-slate-900 dark:text-white leading-tight">Submission Details</h1>
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusInfo.badgeCls}">
                <span class="w-1.5 h-1.5 rounded-full ${statusInfo.dotCls}"></span>
                ${esc(statusInfo.label)}
              </span>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Submission #${c.id} · Submitted ${esc(formatDateTime(c.submittedAt || c.createdAt))}</p>
          </div>
        </div>

        ${
          caps.canEditResubmit
            ? `<a href="#/creator/edit/${c.id}?from=pending" class="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white transition-colors shrink-0">
                <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                <span>Edit &amp; Resubmit</span>
              </a>`
            : ''
        }
      </div>

      <!-- Status Callout Banner -->
      ${
        caps.isUnderReview
          ? `<div class="p-4 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 flex items-start gap-3">
              <svg class="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <div class="text-xs sm:text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
                <strong>Currently Under Review.</strong> Our editorial team is reviewing your submission. Direct editing is locked until the review is completed.
              </div>
            </div>`
          : caps.canEditResubmit
          ? `<div class="p-4 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div class="flex items-start gap-3">
                <svg class="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"/></svg>
                <div class="text-xs sm:text-sm text-rose-900 dark:text-rose-200 leading-relaxed">
                  <strong>Moderator Requested Revisions.</strong> Review the feedback below, update your content, and click <strong>Edit &amp; Resubmit</strong> to send it back for review.
                </div>
              </div>
              <a href="#/creator/edit/${c.id}?from=pending" class="min-h-[38px] inline-flex items-center justify-center px-3.5 py-2 text-xs font-semibold rounded-xl bg-rose-700 hover:bg-rose-800 text-white whitespace-nowrap shrink-0">Edit &amp; Resubmit</a>
            </div>`
          : ''
      }

      <!-- Content Information Card -->
      <section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white">Content Information</h2>
          <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-mono font-semibold ${
            c.isFree
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
              : 'bg-blue-50 text-[#0F2547] dark:bg-sky-950/60 dark:text-sky-300'
          }">${c.isFree ? 'Free' : `Paid · ${formatInr(c.priceInr)}`}</span>
        </div>

        <div class="flex flex-col sm:flex-row gap-4">
          ${
            c.coverImageUrl
              ? `<div class="w-full sm:w-52 aspect-[16/10] sm:aspect-auto sm:h-36 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shrink-0">
                  <img src="${esc(getResponsiveImageSources(c.coverImageUrl, 480)?.fallbackSrc || c.coverImageUrl)}" alt="${esc(c.title)}" class="w-full h-full object-cover" />
                </div>`
              : ''
          }
          <div class="flex-1 min-w-0 space-y-2">
            <h3 class="font-display text-lg sm:text-xl font-semibold text-slate-900 dark:text-white leading-snug">${esc(c.title)}</h3>
            <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">${esc(c.shortDescription)}</p>
            <div class="flex flex-wrap items-center gap-2 pt-1 text-xs">
              <span class="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium">${esc(c.contentType)}</span>
              ${c.subjectName ? `<span class="px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-medium">${esc(c.subjectName)}</span>` : ''}
              ${c.categoryName ? `<span class="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">${esc(c.categoryName)}</span>` : ''}
              ${c.classLevel ? `<span class="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">${esc(c.classLevel)}</span>` : ''}
              ${c.language ? `<span class="text-slate-500 dark:text-slate-400">${esc(c.language)}</span>` : ''}
            </div>
          </div>
        </div>

        ${
          Array.isArray(c.tags) && c.tags.length
            ? `<div class="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-1">Tags:</span>
                ${c.tags.map((tag) => `<span class="px-2 py-0.5 rounded-md text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">#${esc(tag)}</span>`).join('')}
              </div>`
            : ''
        }
      </section>

      <!-- Submission Information + Moderation Timeline -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section class="lg:col-span-5 bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
          <h2 class="font-display text-base font-semibold text-slate-900 dark:text-white">Submission Information</h2>
          <dl class="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            <div class="py-2 flex justify-between gap-3"><dt class="text-slate-500 dark:text-slate-400">Submission ID</dt><dd class="font-mono font-semibold text-slate-900 dark:text-white">#${c.id}</dd></div>
            <div class="py-2 flex justify-between gap-3"><dt class="text-slate-500 dark:text-slate-400">Current Status</dt><dd class="font-semibold text-slate-900 dark:text-white">${esc(statusInfo.label)}</dd></div>
            <div class="py-2 flex justify-between gap-3"><dt class="text-slate-500 dark:text-slate-400">First Submitted</dt><dd class="font-mono text-slate-700 dark:text-slate-200 text-right">${esc(formatDateTime(c.submittedAt || c.createdAt))}</dd></div>
            ${
              c.lastSubmittedAt && c.lastSubmittedAt !== c.submittedAt
                ? `<div class="py-2 flex justify-between gap-3"><dt class="text-slate-500 dark:text-slate-400">Latest Resubmission</dt><dd class="font-mono text-slate-700 dark:text-slate-200 text-right">${esc(formatDateTime(c.lastSubmittedAt))}</dd></div>`
                : ''
            }
            <div class="py-2 flex justify-between gap-3"><dt class="text-slate-500 dark:text-slate-400">Last Reviewed</dt><dd class="font-mono text-slate-700 dark:text-slate-200 text-right">${c.lastReviewedAt ? esc(formatDateTime(c.lastReviewedAt)) : 'Awaiting review'}</dd></div>
            <div class="py-2 flex justify-between gap-3"><dt class="text-slate-500 dark:text-slate-400">Resubmissions</dt><dd class="font-mono font-semibold text-slate-900 dark:text-white">${Number(c.resubmissionCount || 0)}</dd></div>
            <div class="py-2 flex justify-between gap-3"><dt class="text-slate-500 dark:text-slate-400">Author</dt><dd class="text-slate-800 dark:text-slate-200 text-right">${esc(c.authorName || store.user?.name || 'Creator')}</dd></div>
          </dl>
        </section>

        <!-- Vertical Moderation Timeline -->
        <section class="lg:col-span-7 bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <h2 class="font-display text-base font-semibold text-slate-900 dark:text-white">Moderation Timeline</h2>
          ${
            timeline.length
              ? `<ol class="relative border-l-2 border-slate-200 dark:border-slate-700 ml-2.5 space-y-4">
                  ${timeline
                    .map((ev) => {
                      const dotColor =
                        ev.action === 'approved'
                          ? 'bg-emerald-500'
                          : ev.action === 'changes_requested'
                          ? 'bg-rose-500'
                          : ev.action === 'rejected' || ev.action === 'removed'
                          ? 'bg-red-500'
                          : ev.action === 'resubmitted' || ev.action === 'submitted_for_review'
                          ? 'bg-[#5a1fd8]'
                          : 'bg-slate-400';
                      return `
                        <li class="ml-5 relative">
                          <span class="absolute -left-[27px] top-1 w-3 h-3 rounded-full ring-4 ring-white dark:ring-[#111A2E] ${dotColor}"></span>
                          <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white">${esc(ev.label)}</span>
                            <span class="text-[11px] font-mono text-slate-500 dark:text-slate-400">${esc(formatDateTime(ev.timestamp))}</span>
                          </div>
                          ${ev.note ? `<p class="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">${esc(ev.note)}</p>` : ''}
                          ${ev.correctionInstructions && ev.correctionInstructions !== ev.note ? `<p class="text-xs text-rose-700 dark:text-rose-300 mt-1 leading-relaxed">${esc(ev.correctionInstructions)}</p>` : ''}
                        </li>
                      `;
                    })
                    .join('')}
                </ol>`
              : `<p class="text-xs text-slate-500 dark:text-slate-400">No moderation events recorded yet.</p>`
          }
        </section>
      </div>

      <!-- Admin Feedback Section -->
      <section id="pnd-feedback-section" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
        <div class="flex items-center justify-between gap-2">
          <h2 class="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white">Admin Feedback &amp; Correction Notes</h2>
          ${caps.canEditResubmit ? `<span class="text-xs font-semibold text-rose-600 dark:text-rose-400">Action Required</span>` : ''}
        </div>

        ${
          !hasFeedback
            ? `<div class="p-4 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200/80 dark:border-slate-800 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                No moderation feedback available yet.
              </div>`
            : `<div class="space-y-3">
                ${
                  currentFeedback
                    ? `<div class="p-4 rounded-xl border ${
                        caps.canEditResubmit
                          ? 'border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120]'
                      } space-y-1.5">
                        <div class="text-xs font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-300">Latest Reviewer Note</div>
                        <p class="text-sm text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-line">${esc(currentFeedback)}</p>
                      </div>`
                    : ''
                }
                ${
                  feedbackHistory.filter((fb) => fb.feedback).length
                    ? `<div class="space-y-2">
                        <div class="text-xs font-semibold text-slate-500 dark:text-slate-400">Review Feedback History</div>
                        ${feedbackHistory
                          .filter((fb) => fb.feedback)
                          .map(
                            (fb) => `
                            <div class="p-3 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200/80 dark:border-slate-800 space-y-1 text-xs">
                              <div class="flex flex-wrap items-center justify-between gap-2">
                                <span class="font-semibold text-slate-800 dark:text-slate-200">${esc(fb.label || fb.action)}</span>
                                <span class="font-mono text-[11px] text-slate-500 dark:text-slate-400">${esc(formatDateTime(fb.reviewedAt))}</span>
                              </div>
                              <p class="text-slate-700 dark:text-slate-300 leading-relaxed">${esc(fb.feedback)}</p>
                            </div>
                          `
                          )
                          .join('')}
                      </div>`
                    : ''
                }
              </div>`
        }
      </section>

      <!-- Format-Aware Content Preview Section -->
      <section id="pnd-preview-section" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white">Content Preview</h2>
          <span class="text-xs text-slate-500 dark:text-slate-400">${c.durationSeconds ? esc(formatDurationShort(c.durationSeconds)) : `${c.readingTimeMins || 5} min read`}</span>
        </div>

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
                    <button type="button" id="pnd-pdf-zoom-out" class="min-w-[32px] min-h-[32px] px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E]">−</button>
                    <span id="pnd-pdf-zoom-label" class="font-mono tabular-nums w-11 text-center">100%</span>
                    <button type="button" id="pnd-pdf-zoom-in" class="min-w-[32px] min-h-[32px] px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E]">+</button>
                    <button type="button" id="pnd-pdf-fullscreen-btn" class="min-h-[32px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] font-semibold text-[#5a1fd8] dark:text-sky-400">Full Screen</button>
                  </div>
                </div>
                ${pdfFiles
                  .map(
                    (pf, idx) => `
                    <div class="space-y-1.5">
                      <div class="relative overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 h-[360px] sm:h-[460px]">
                        <iframe ${idx === 0 ? 'id="pnd-pdf-frame"' : ''} src="${esc(withAuthParam(pf.accessUrl))}#toolbar=1" title="${esc(pf.originalName)}" class="w-full h-full border-0 origin-top-left"></iframe>
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
                      <button type="button" data-gallery-src="${esc(fullSrc)}" data-gallery-name="${esc(imgF.originalName)}" class="pnd-prev-gallery group text-left rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120]">
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
                <div id="pnd-preview-prose" class="reading-prose text-sm ${isLongProse ? 'max-h-44 overflow-hidden' : ''}">${c.bodyHtml}</div>
                ${
                  isLongProse
                    ? `<div class="flex justify-end">
                        <button type="button" id="pnd-read-more-btn" data-expanded="false" class="text-xs font-semibold text-[#5a1fd8] dark:text-sky-400 hover:underline">Read More ▾</button>
                      </div>`
                    : ''
                }
              </div>`
            : !hasAnyContent
            ? `<div class="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-[#0B1120] p-4 text-xs text-slate-500 dark:text-slate-400">
                No inline article text or media attachments were included with this submission.
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

      <!-- Status-Gated Bottom Actions -->
      <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
        <a href="#/creator/pending" class="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
          <span>← Back to Pending &amp; Review</span>
        </a>
        <div class="flex flex-wrap items-center gap-2.5">
          <a href="#/creator/history" class="min-h-[44px] inline-flex items-center px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            View History
          </a>
          ${
            caps.canEditResubmit
              ? `<a href="#/creator/edit/${c.id}?from=pending" class="min-h-[44px] inline-flex items-center gap-2 px-5 py-2 text-xs sm:text-sm font-semibold rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white transition-colors">
                  <span>Edit &amp; Resubmit</span>
                </a>`
              : ''
          }
        </div>
      </div>
    </div>
  `;
}

export function wireSubmissionDetailsEvents(container, subView) {
  if (subView === 'feedback') {
    const fbSection = document.getElementById('pnd-feedback-section');
    if (fbSection) {
      requestAnimationFrame(() => fbSection.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  } else if (subView === 'preview') {
    const pvSection = document.getElementById('pnd-preview-section');
    if (pvSection) {
      requestAnimationFrame(() => pvSection.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  let zoomPct = 100;
  const pdfFrame = document.getElementById('pnd-pdf-frame');
  const zoomLabel = document.getElementById('pnd-pdf-zoom-label');
  const applyPdfZoom = (next) => {
    zoomPct = Math.max(70, Math.min(180, next));
    if (zoomLabel) zoomLabel.textContent = `${zoomPct}%`;
    if (pdfFrame) {
      pdfFrame.style.width = `${zoomPct}%`;
      pdfFrame.style.height = `${Math.max(100, zoomPct)}%`;
    }
  };
  document.getElementById('pnd-pdf-zoom-in')?.addEventListener('click', () => applyPdfZoom(zoomPct + 20));
  document.getElementById('pnd-pdf-zoom-out')?.addEventListener('click', () => applyPdfZoom(zoomPct - 20));
  document.getElementById('pnd-pdf-fullscreen-btn')?.addEventListener('click', () => {
    const wrapper = pdfFrame?.parentElement;
    if (wrapper?.requestFullscreen) {
      wrapper.requestFullscreen().catch(() => {});
    }
  });

  document.getElementById('pnd-read-more-btn')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const prose = document.getElementById('pnd-preview-prose');
    if (!prose || !btn) return;
    const expanded = btn.dataset.expanded === 'true';
    btn.dataset.expanded = expanded ? 'false' : 'true';
    prose.classList.toggle('max-h-44', expanded);
    prose.classList.toggle('overflow-hidden', expanded);
    btn.textContent = expanded ? 'Read More ▾' : 'Show Less ▴';
  });

  container.querySelectorAll('.pnd-prev-gallery').forEach((btn) => {
    btn.addEventListener('click', () => {
      openImageLightbox({
        src: btn.dataset.gallerySrc,
        title: btn.dataset.galleryName || 'Preview Image',
      });
    });
  });
}
