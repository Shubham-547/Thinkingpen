import {
  apiFetch,
  CONTENT_TYPES,
  esc,
  formatBytes,
  formatDate,
  formatDateTime,
  formatInr,
  formatRelativeAge,
  getResponsiveImageSources,
  LANGUAGES,
  loadGlobalCatalogMeta,
  notifyStore,
  openModal,
  PRESET_COVERS,
  renderStatusLabel,
  resolveVideoEmbed,
  showToast,
  store,
  uploadFileResilient,
} from './api.js';
import {
  buildPublishedListUrl,
  cleanupPublishedFloatingMenu,
  renderPublishedAnalyticsHtml,
  renderPublishedContentSectionHtml,
  renderPublishedDetailViewHtml,
  renderPublishedPreviewHtml,
  wirePublishedListEvents,
  wirePublishedSubViewEvents,
} from './pages-creator-published.js';
import {
  buildDraftsListUrl,
  cleanupDraftFloatingMenu,
  renderDraftContentSectionHtml,
  renderDraftPreviewHtml,
  wireDraftPreviewEvents,
  wireDraftsListEvents,
} from './pages-creator-drafts.js';
import {
  buildPendingListUrl,
  cleanupPendingFloatingMenu,
  renderPendingSectionHtml,
  renderSubmissionDetailsHtml,
  wirePendingListEvents,
  wireSubmissionDetailsEvents,
} from './pages-creator-pending.js';
import {
  buildHistoryUrl,
  renderCreatorHistoryHtml,
  wireCreatorHistoryHandlers,
} from './pages-creator-history.js';
import {
  analyticsUiState,
  buildAnalyticsApiUrl,
  renderAnalyticsSectionHtml,
  resolveAnalyticsSubRoute,
  wireAnalyticsEvents,
} from './pages-creator-analytics.js';

function renderOverviewSkeletonHtml() {
  return `
    <div class="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading Creator Studio Overview">
      <div class="h-24 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70"></div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div class="h-28 rounded-xl bg-slate-200/70 dark:bg-slate-800/70"></div>
        <div class="h-28 rounded-xl bg-slate-200/70 dark:bg-slate-800/70"></div>
        <div class="h-28 rounded-xl bg-slate-200/70 dark:bg-slate-800/70"></div>
        <div class="h-28 rounded-xl bg-slate-200/70 dark:bg-slate-800/70"></div>
      </div>
      <div class="h-48 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70"></div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="h-44 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70"></div>
        <div class="h-44 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70"></div>
      </div>
      <div class="h-56 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70"></div>
    </div>
  `;
}

function getCreatorInitials(name) {
  const parts = String(name || 'SP').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'SP';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function renderOverviewCompactThumb(url, title) {
  const initials = getCreatorInitials(title || 'SP');
  if (!url) {
    return `<div class="w-14 h-11 rounded-lg bg-gradient-to-br from-[#0F2547] to-[#2B4C80] text-white flex items-center justify-center text-xs font-semibold shrink-0">${esc(initials)}</div>`;
  }
  const sources = getResponsiveImageSources(url, 240);
  const src = sources?.fallbackSrc || url;
  return `
    <div class="w-14 h-11 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/70 shrink-0 relative">
      <img src="${esc(src)}" alt="${esc(title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
      <div style="display:none" class="absolute inset-0 bg-gradient-to-br from-[#0F2547] to-[#2B4C80] text-white items-center justify-center text-xs font-semibold">${esc(initials)}</div>
    </div>
  `;
}

function renderGrowthBadge(pct, comparisonLabel) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) {
    return '';
  }
  const num = Number(pct);
  const isUp = num > 0;
  const isDown = num < 0;
  const tone = isUp
    ? 'text-emerald-700 dark:text-emerald-400'
    : isDown
    ? 'text-red-600 dark:text-red-400'
    : 'text-slate-500 dark:text-slate-400';
  const arrow = isUp ? '↑' : isDown ? '↓' : '•';
  return `<span class="inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${tone}">${arrow} ${Math.abs(num).toFixed(1)}%${comparisonLabel ? ` <span class="font-normal text-slate-500 dark:text-slate-400">${esc(comparisonLabel)}</span>` : ''}</span>`;
}

function renderCreatorOverviewSectionHtml(ov, state = {}) {
  const hdr = ov.creatorHeader || {};
  const flt = ov.filter || {};
  const qs = ov.quickStats || {};
  const eo = ov.earningsOverview || {};
  const cp = ov.contentPerformance || {};
  const top = Array.isArray(ov.topContent) ? ov.topContent : [];
  const act = Array.isArray(ov.recentActivity) ? ov.recentActivity : [];

  const activeRange = state.range || flt.range || '30d';
  const activeSort = state.sortBy || flt.sortBy || 'views';
  const startDateVal = state.startDate || flt.startDate || '';
  const endDateVal = state.endDate || flt.endDate || '';
  const displayName = hdr.displayName || hdr.name || store.user?.name || 'Creator';
  const initials = getCreatorInitials(displayName);
  const commRate = Number(hdr.effectiveCommissionRate ?? 10);
  const compLabel = flt.comparisonLabel || '';

  const activityIconHtml = (category, status) => {
    if (category === 'sale') {
      const isRev = status === 'reversed';
      return `<span class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isRev ? 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'}">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 2.3a1 1 0 00.7 1.7H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z"/></svg>
      </span>`;
    }
    if (category === 'withdrawal') {
      return `<span class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
      </span>`;
    }
    if (category === 'follower') {
      return `<span class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>
      </span>`;
    }
    if (category === 'moderation') {
      const ok = status === 'approved';
      return `<span class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400' : 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400'}">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${ok ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' : 'M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z'}"/></svg>
      </span>`;
    }
    return `<span class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-sky-400">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
    </span>`;
  };

  const quickStatCards = [
    {
      label: 'Total Views',
      value: Number(qs.totalViews || 0).toLocaleString('en-IN'),
      growthHtml:
        qs.viewsGrowthPct !== null && qs.viewsGrowthPct !== undefined
          ? renderGrowthBadge(qs.viewsGrowthPct, compLabel)
          : `<span class="text-xs text-slate-500 dark:text-slate-400">All-time views</span>`,
      iconWrap: 'bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400',
      iconPath: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    {
      label: 'Total Downloads',
      value: Number(qs.totalDownloads || 0).toLocaleString('en-IN'),
      growthHtml:
        qs.downloadsGrowthPct !== null && qs.downloadsGrowthPct !== undefined
          ? renderGrowthBadge(qs.downloadsGrowthPct, compLabel)
          : `<span class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">${Number(qs.rangeDownloadsCount || 0).toLocaleString('en-IN')} in ${esc(flt.rangeLabel || 'period')}</span>`,
      iconWrap: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400',
      iconPath: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
    },
    {
      label: 'Total Sales',
      value: Number(qs.totalSales || 0).toLocaleString('en-IN'),
      growthHtml:
        qs.salesGrowthPct !== null && qs.salesGrowthPct !== undefined
          ? renderGrowthBadge(qs.salesGrowthPct, compLabel)
          : `<span class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">${Number(qs.rangeSalesCount || 0).toLocaleString('en-IN')} in ${esc(flt.rangeLabel || 'period')}</span>`,
      iconWrap: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
      iconPath: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 2.3a1 1 0 00.7 1.7H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z',
    },
    {
      label: 'Total Earnings',
      value: formatInr(qs.totalEarningsInr || 0),
      growthHtml:
        qs.earningsGrowthPct !== null && qs.earningsGrowthPct !== undefined
          ? renderGrowthBadge(qs.earningsGrowthPct, compLabel)
          : `<span class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">${formatInr(qs.rangeEarningsInr || 0)} in ${esc(flt.rangeLabel || 'period')}</span>`,
      iconWrap: 'bg-blue-50 text-[#0F2547] dark:bg-sky-950/60 dark:text-sky-300',
      iconPath: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    },
  ];

  return `
    <div id="creator-overview-root" class="space-y-5 sm:space-y-6">
      <!-- 1. Creator Header -->
      <section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div class="flex items-center gap-3.5 sm:gap-4 min-w-0">
            <div class="relative shrink-0">
              ${
                hdr.avatarUrl
                  ? `<img src="${esc(hdr.avatarUrl)}" alt="${esc(displayName)}" referrerpolicy="no-referrer" class="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover border border-slate-200 dark:border-slate-700" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
                     <div style="display:none" class="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-[#0F2547] to-[#27467B] text-white font-semibold text-lg items-center justify-center border border-slate-200 dark:border-slate-700">${esc(initials)}</div>`
                  : `<div class="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-[#0F2547] to-[#27467B] text-white font-semibold text-lg flex items-center justify-center border border-slate-200 dark:border-slate-700">${esc(initials)}</div>`
              }
            </div>
            <div class="min-w-0">
              <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Welcome back,</div>
              <div class="flex items-center gap-1.5 min-w-0 mt-0.5">
                <h1 class="font-display text-lg sm:text-2xl font-semibold text-slate-900 dark:text-white truncate">${esc(displayName)}</h1>
                ${
                  hdr.verified === true
                    ? `<svg class="w-5 h-5 text-sky-500 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-label="Verified Creator" title="Verified ScholarPress Creator"><path d="M12 2l2.39 1.65 2.86-.24 1.24 2.59 2.59 1.24-.24 2.86L22 12l-1.16 2.65.24 2.86-2.59 1.24-1.24 2.59-2.86-.24L12 22l-2.39-1.65-2.86.24-1.24-2.59-2.59-1.24.24-2.86L2 12l1.16-2.65-.24-2.86 2.59-1.24 1.24-2.59 2.86.24L12 2zm-1.15 13.5l5.3-5.3-1.4-1.42-3.9 3.88-1.65-1.66-1.42 1.42 3.07 3.08z"/></svg>`
                    : ''
                }
              </div>
              <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mt-1">
                <span>${esc(hdr.motto || 'Create • Share • Earn')}</span>
                <span aria-hidden="true">·</span>
                <span class="tabular-nums">${Number(hdr.followerCount || 0).toLocaleString('en-IN')} followers</span>
                <span aria-hidden="true">·</span>
                <span class="tabular-nums">Creator share <strong class="font-mono text-emerald-700 dark:text-emerald-400">${(100 - commRate).toFixed(1)}%</strong></span>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap sm:flex-col items-start sm:items-end justify-between gap-2 shrink-0">
            <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs font-medium text-slate-700 dark:text-slate-200">
              <span class="w-2 h-2 rounded-full ${hdr.accountStatus === 'active' ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
              <span>${hdr.role === 'admin' ? 'Admin &amp; Creator' : 'Creator Account'}</span>
            </div>
            <div class="flex items-center gap-3 text-xs font-medium">
              <a href="#/creator/profile" class="text-[#0F2547] dark:text-sky-400 hover:underline">Edit Profile</a>
              <span class="text-slate-300 dark:text-slate-700">|</span>
              <a href="#/creator-profile/${esc(hdr.id || store.user?.id)}" class="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">Public Page</a>
            </div>
          </div>
        </div>
      </section>

      <!-- 2. Quick Performance Statistics (4 Cards) -->
      <section aria-label="Quick Performance Statistics" class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        ${quickStatCards
          .map(
            (card) => `
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex items-start gap-3 sm:gap-3.5">
            <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${card.iconWrap}">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="${card.iconPath}" />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">${esc(card.label)}</div>
              <div class="font-mono text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white mt-0.5 tabular-nums truncate">${esc(card.value)}</div>
              <div class="mt-1 truncate">${card.growthHtml}</div>
            </div>
          </div>
        `
          )
          .join('')}
      </section>

      <!-- 3. Earnings Overview (No Charts / No Graphs — Pure Ledger Summary + Date Filter) -->
      <section id="co-earnings-section" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6">
        <div class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-sky-950/60 text-[#0F2547] dark:text-sky-400 flex items-center justify-center shrink-0">
              <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <div>
              <h2 class="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white">Earnings Overview</h2>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">Net creator revenue after ${commRate}% platform commission</p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <label for="co-date-range" class="sr-only">Earnings date filter</label>
            <select id="co-date-range" class="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100 outline-none focus:border-[#0F2547] dark:focus:border-sky-400">
              <option value="today" ${activeRange === 'today' ? 'selected' : ''}>Today</option>
              <option value="7d" ${activeRange === '7d' ? 'selected' : ''}>Last 7 Days</option>
              <option value="30d" ${activeRange === '30d' ? 'selected' : ''}>Last 30 Days</option>
              <option value="90d" ${activeRange === '90d' ? 'selected' : ''}>Last 90 Days</option>
              <option value="year" ${activeRange === 'year' ? 'selected' : ''}>This Year</option>
              <option value="custom" ${activeRange === 'custom' ? 'selected' : ''}>Custom Date Range</option>
            </select>
            <button type="button" id="co-refresh-btn" title="Refresh overview data" aria-label="Refresh overview data" class="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            </button>
          </div>
        </div>

        <div id="co-custom-date-bar" class="${activeRange === 'custom' ? 'flex' : 'hidden'} flex-wrap items-end gap-3 pt-4 pb-2">
          <div>
            <label for="co-start-date" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Start Date</label>
            <input type="date" id="co-start-date" value="${esc(startDateVal)}" class="px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100" />
          </div>
          <div>
            <label for="co-end-date" class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">End Date</label>
            <input type="date" id="co-end-date" value="${esc(endDateVal)}" class="px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100" />
          </div>
          <button type="button" id="co-apply-custom-btn" class="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors">Apply Range</button>
        </div>

        <div class="pt-4 pb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div class="text-xs text-slate-500 dark:text-slate-400">Net Earnings · ${esc(flt.rangeLabel || 'Last 30 Days')}</div>
            <div class="flex flex-wrap items-baseline gap-3 mt-1">
              <span class="font-mono text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tabular-nums">${formatInr(eo.rangeEarningsInr || 0)}</span>
              ${renderGrowthBadge(eo.growthPct, compLabel)}
            </div>
            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
              ${Number(eo.rangeSalesCount || 0).toLocaleString('en-IN')} paid sale${Number(eo.rangeSalesCount || 0) === 1 ? '' : 's'} · Gross ${formatInr(eo.rangeGrossInr || 0)} · Platform commission ${formatInr(eo.rangeCommissionInr || 0)}
            </div>
          </div>
          <div class="sm:text-right">
            <div class="text-xs text-slate-500 dark:text-slate-400">Lifetime Total Earnings</div>
            <div class="font-mono text-lg sm:text-xl font-semibold text-slate-900 dark:text-white tabular-nums mt-0.5">${formatInr(eo.lifetimeEarningsInr || 0)}</div>
          </div>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
          <div>
            <div class="text-xs text-slate-500 dark:text-slate-400">Available Balance</div>
            <div class="font-mono text-base sm:text-lg font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">${formatInr(eo.availableBalanceInr || 0)}</div>
          </div>
          <div>
            <div class="text-xs text-slate-500 dark:text-slate-400">Pending Balance</div>
            <div class="font-mono text-base sm:text-lg font-semibold text-amber-700 dark:text-amber-400 tabular-nums mt-0.5">${formatInr(eo.pendingBalanceInr || 0)}</div>
          </div>
          <div>
            <div class="text-xs text-slate-500 dark:text-slate-400">Earnings This Month</div>
            <div class="font-mono text-base sm:text-lg font-semibold text-slate-900 dark:text-white tabular-nums mt-0.5">${formatInr(eo.thisMonthEarningsInr || 0)}</div>
          </div>
          <div>
            <div class="text-xs text-slate-500 dark:text-slate-400">Already Paid Out</div>
            <div class="font-mono text-base sm:text-lg font-semibold text-slate-900 dark:text-white tabular-nums mt-0.5">${formatInr(eo.withdrawnAmountInr || 0)}</div>
          </div>
        </div>
      </section>

      <!-- 4 & 7. Content Performance Summary + Wallet Balance Summary -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
        <!-- 4. Content Performance -->
        <section class="lg:col-span-7 bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col justify-between">
          <div class="flex items-center justify-between gap-3 mb-4">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-lg bg-blue-50 dark:bg-sky-950/60 text-blue-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
              </div>
              <h2 class="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white">Content Performance</h2>
            </div>
            <a href="#/creator/published" class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline whitespace-nowrap">View All →</a>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4 pt-1">
            <a href="#/creator/published" class="p-3 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-100 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
              <div class="font-mono text-xl font-bold text-slate-900 dark:text-white tabular-nums">${Number(cp.totalCount || 0)}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Total</div>
            </a>
            <a href="#/creator/published" class="p-3 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-100 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
              <div class="font-mono text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">${Number(cp.publishedCount || 0)}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Published</div>
            </a>
            <a href="#/creator/drafts" class="p-3 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-100 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
              <div class="font-mono text-xl font-bold text-slate-700 dark:text-slate-200 tabular-nums">${Number(cp.draftCount || 0)}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Draft</div>
            </a>
            <a href="#/creator/pending" class="p-3 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-100 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
              <div class="font-mono text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">${Number(cp.pendingCount || 0)}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Pending</div>
            </a>
            <a href="#/creator/history" class="col-span-2 sm:col-span-1 p-3 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-100 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
              <div class="font-mono text-xl font-bold text-red-600 dark:text-red-400 tabular-nums">${Number(cp.rejectedCount || 0)}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Rejected</div>
            </a>
          </div>
        </section>

        <!-- 7. Wallet Balance Summary -->
        <section class="lg:col-span-5 bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col justify-between gap-4">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-blue-50 dark:bg-sky-950/60 text-[#0F2547] dark:text-sky-400 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
              </div>
              <div>
                <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Your Balance</div>
                <div class="font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">${formatInr(eo.availableBalanceInr || 0)}</div>
              </div>
            </div>
            <a href="#/creator/wallet" class="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-[#0F2547] dark:text-sky-400 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 transition-colors">
              View Wallet →
            </a>
          </div>

          <div class="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div>
              <div class="text-slate-500 dark:text-slate-400">Pending Payouts</div>
              <div class="font-mono font-semibold text-amber-700 dark:text-amber-400 tabular-nums mt-0.5">${formatInr(eo.pendingBalanceInr || 0)}</div>
            </div>
            <div>
              <div class="text-slate-500 dark:text-slate-400">Withdrawn Total</div>
              <div class="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums mt-0.5">${formatInr(eo.withdrawnAmountInr || 0)}</div>
            </div>
          </div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400">
            Min withdrawal ${formatInr(eo.minWithdrawalInr || 100)} · Requests reviewed in <a href="#/creator/wallet" class="text-[#0F2547] dark:text-sky-400 hover:underline font-medium">Wallet &amp; Payouts</a>
          </div>
        </section>
      </div>

      <!-- 5. Top Performing Content -->
      <section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 class="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white">Top Performing Content</h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Your highest-performing active publications</p>
          </div>
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-[#0B1120] text-xs">
              <button type="button" data-sort-by="views" class="co-sort-btn px-2.5 py-1 rounded-md font-medium transition-colors ${activeSort === 'views' ? 'bg-white dark:bg-[#111A2E] text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}">Most Viewed</button>
              <button type="button" data-sort-by="earnings" class="co-sort-btn px-2.5 py-1 rounded-md font-medium transition-colors ${activeSort === 'sales' || activeSort === 'earnings' ? 'bg-white dark:bg-[#111A2E] text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}">Top Earning</button>
            </div>
            <a href="#/creator/published" class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline whitespace-nowrap">View All →</a>
          </div>
        </div>

        ${
          Number(cp.totalCount || 0) === 0 || top.length === 0
            ? `<div class="py-10 px-4 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-[#0B1120]/50">
                <div class="text-sm font-semibold text-slate-900 dark:text-white">No publications created yet</div>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">Upload study notes, PDFs, e-books, or video lectures to track views, downloads, sales, and earnings here.</p>
                <a href="#/creator/upload" class="inline-flex items-center gap-1.5 mt-4 px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors">
                  Upload Your First Content
                </a>
              </div>`
            : `<div class="divide-y divide-slate-100 dark:divide-slate-800">
                ${top
                  .map(
                    (item) => `
                  <div class="py-3.5 first:pt-1 last:pb-1 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div class="flex items-center gap-3 min-w-0">
                      <a href="#/content/${esc(item.slug)}" class="shrink-0">${renderOverviewCompactThumb(item.coverImageUrl, item.title)}</a>
                      <div class="min-w-0">
                        <div class="flex items-center gap-2 min-w-0">
                          <a href="#/content/${esc(item.slug)}" class="font-medium text-sm text-slate-900 dark:text-white hover:text-[#1B3B6F] dark:hover:text-sky-300 truncate">${esc(item.title)}</a>
                          ${item.status !== 'approved' ? renderStatusLabel(item.status) : ''}
                        </div>
                        <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          <span>${esc(item.contentType)}</span>
                          <span aria-hidden="true">·</span>
                          <span class="font-mono font-semibold ${item.isFree ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}">${item.isFree ? 'Free' : formatInr(item.priceInr)}</span>
                          ${item.categoryName ? `<span aria-hidden="true">·</span><span>${esc(item.categoryName)}</span>` : ''}
                        </div>
                      </div>
                    </div>

                    <div class="grid grid-cols-4 gap-3 sm:gap-5 text-xs md:text-right shrink-0 pl-0 md:pl-4">
                      <div>
                        <div class="text-[11px] text-slate-400 dark:text-slate-500">Views</div>
                        <div class="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">${Number(item.viewsCount || 0).toLocaleString('en-IN')}</div>
                      </div>
                      <div>
                        <div class="text-[11px] text-slate-400 dark:text-slate-500">Downloads</div>
                        <div class="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">${Number(item.downloadsCount || 0).toLocaleString('en-IN')}</div>
                      </div>
                      <div>
                        <div class="text-[11px] text-slate-400 dark:text-slate-500">Sales</div>
                        <div class="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">${Number(item.purchasesCount || 0).toLocaleString('en-IN')}</div>
                      </div>
                      <div>
                        <div class="text-[11px] text-slate-400 dark:text-slate-500">Earnings</div>
                        <div class="font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">${formatInr(item.earningsInr || 0)}</div>
                      </div>
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>`
        }
      </section>

      <!-- 6. Recent Activity -->
      <section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6">
        <div class="flex items-center justify-between gap-3 mb-4">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            </div>
            <h2 class="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white">Recent Activity</h2>
          </div>
          <a href="#/creator/history" class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline whitespace-nowrap">View All →</a>
        </div>

        ${
          act.length
            ? `<div class="divide-y divide-slate-100 dark:divide-slate-800">
                ${act
                  .map(
                    (ev) => `
                  <a href="${esc(ev.link || '#/creator/history')}" class="py-3 first:pt-1 last:pb-1 flex items-start sm:items-center justify-between gap-3 group hover:bg-slate-50/70 dark:hover:bg-slate-900/30 -mx-2 px-2 rounded-lg transition-colors">
                    <div class="flex items-start sm:items-center gap-3 min-w-0">
                      ${activityIconHtml(ev.category, ev.status)}
                      <div class="min-w-0">
                        <div class="text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100 group-hover:text-[#1B3B6F] dark:group-hover:text-sky-300 truncate">${esc(ev.title)}</div>
                        <div class="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">${esc(ev.reference || '')}</div>
                      </div>
                    </div>
                    <div class="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0 tabular-nums" title="${esc(formatDateTime(ev.createdAt))}">
                      ${esc(formatRelativeAge(ev.createdAt))}
                    </div>
                  </a>
                `
                  )
                  .join('')}
              </div>`
            : `<p class="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">No recent creator activity recorded yet.</p>`
        }
      </section>

      <!-- 8. Quick Actions -->
      <section aria-label="Quick Actions" class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <a href="#/creator/upload" class="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 text-xs sm:text-sm font-semibold transition-colors">
          <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
          <span>Upload New Content</span>
        </a>
        <a href="#/creator/published" class="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold transition-colors">
          <span>Manage Content</span>
        </a>
        <a href="#/creator/analytics" class="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold transition-colors">
          <span>View Analytics</span>
        </a>
        <a href="#/creator/earnings" class="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold transition-colors">
          <span>View Earnings</span>
        </a>
      </section>
    </div>
  `;
}

export async function renderCreatorDashboardPage(container, activeTab = 'overview', routeParam = null) {
  cleanupPublishedFloatingMenu();
  cleanupDraftFloatingMenu();
  cleanupPendingFloatingMenu();
  if (!store.user) {
    window.location.hash = '#/login';
    return;
  }
  if (store.user.role !== 'creator' && store.user.role !== 'admin') {
    window.location.hash = '#/become-creator';
    return;
  }

  const editId =
    activeTab === 'upload'
      ? routeParam && typeof routeParam === 'object'
        ? routeParam.subId || null
        : routeParam
      : null;
  const publishedSubId =
    activeTab === 'published' && routeParam && typeof routeParam === 'object'
      ? routeParam.subId || null
      : null;
  const publishedSubView =
    activeTab === 'published' && routeParam && typeof routeParam === 'object'
      ? routeParam.subView || null
      : null;
  const draftSubId =
    activeTab === 'drafts' && routeParam && typeof routeParam === 'object'
      ? routeParam.subId || null
      : null;
  const draftSubView =
    activeTab === 'drafts' && routeParam && typeof routeParam === 'object'
      ? routeParam.subView || null
      : null;
  const pendingSubId =
    activeTab === 'pending' && routeParam && typeof routeParam === 'object'
      ? routeParam.subId || null
      : null;
  const pendingSubView =
    activeTab === 'pending' && routeParam && typeof routeParam === 'object'
      ? routeParam.subView || null
      : null;
  const analyticsSubId =
    activeTab === 'analytics' && routeParam && typeof routeParam === 'object'
      ? routeParam.subId || null
      : null;
  const analyticsSubView =
    activeTab === 'analytics' && routeParam && typeof routeParam === 'object'
      ? routeParam.subView || null
      : null;
  const isAnalyticsOrEarnings = activeTab === 'analytics' || activeTab === 'earnings';
  const analyticsRoute = isAnalyticsOrEarnings
    ? resolveAnalyticsSubRoute(activeTab, analyticsSubId, analyticsSubView)
    : null;

  container.innerHTML =
    activeTab === 'overview' || isAnalyticsOrEarnings
      ? `<div class="${isAnalyticsOrEarnings ? 'min-h-[calc(100vh-3.5rem)] bg-[#F5F6FC] dark:bg-[#0B1120] ' : ''}"><div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6">${renderOverviewSkeletonHtml()}</div></div>`
      : `<div class="max-w-7xl mx-auto px-4 py-12 text-sm text-slate-500">Loading Creator Studio...</div>`;

  const overviewState = {
    range: '30d',
    startDate: '',
    endDate: '',
    sortBy: 'views',
  };

  const buildOverviewUrl = () => {
    const qs = new URLSearchParams();
    qs.set('range', overviewState.range);
    qs.set('sortBy', overviewState.sortBy);
    if (overviewState.range === 'custom' && overviewState.startDate && overviewState.endDate) {
      qs.set('startDate', overviewState.startDate);
      qs.set('endDate', overviewState.endDate);
    }
    return `/api/creator/overview?${qs.toString()}`;
  };

  try {
    let data = null;
    let overviewData = null;
    let analyticsPayload = null;
    let editPayload = null;
    let historyPayload = null;
    let publishedPayload = null;
    let publishedDetailPayload = null;
    let draftsPayload = null;
    let draftDetailPayload = null;
    let pendingPayload = null;
    let pendingDetailPayload = null;

    if (activeTab === 'overview') {
      overviewData = await apiFetch(buildOverviewUrl(), { noCache: true });
      overviewState.range = overviewData.filter?.range || '30d';
      overviewState.startDate = overviewData.filter?.startDate || '';
      overviewState.endDate = overviewData.filter?.endDate || '';
      overviewState.sortBy = overviewData.filter?.sortBy || 'views';
    } else {
      const needMeta =
        (activeTab === 'upload' || activeTab === 'published' || activeTab === 'drafts' || activeTab === 'pending') &&
        (!store.categories?.length || !store.subjects?.length);
      [
        data,
        analyticsPayload,
        editPayload,
        historyPayload,
        publishedPayload,
        publishedDetailPayload,
        draftsPayload,
        draftDetailPayload,
        pendingPayload,
        pendingDetailPayload,
      ] = await Promise.all([
        apiFetch('/api/creator/dashboard'),
        isAnalyticsOrEarnings && analyticsRoute
          ? apiFetch(buildAnalyticsApiUrl(analyticsRoute.mode, analyticsRoute.subId), { noCache: true })
          : Promise.resolve(null),
        activeTab === 'upload' && editId ? apiFetch(`/api/creator/contents/${editId}`, { noCache: true }) : Promise.resolve(null),
        activeTab === 'history' ? apiFetch(buildHistoryUrl(), { noCache: true }) : Promise.resolve(null),
        activeTab === 'published' && !publishedSubId
          ? apiFetch(buildPublishedListUrl(), { noCache: true })
          : Promise.resolve(null),
        activeTab === 'published' && publishedSubId
          ? apiFetch(`/api/creator/contents/${encodeURIComponent(publishedSubId)}/details`, { noCache: true })
          : Promise.resolve(null),
        activeTab === 'drafts' && !draftSubId
          ? apiFetch(buildDraftsListUrl(), { noCache: true })
          : Promise.resolve(null),
        activeTab === 'drafts' && draftSubId
          ? apiFetch(`/api/creator/contents/${encodeURIComponent(draftSubId)}/details`, { noCache: true })
          : Promise.resolve(null),
        activeTab === 'pending' && !pendingSubId
          ? apiFetch(buildPendingListUrl(), { noCache: true })
          : Promise.resolve(null),
        activeTab === 'pending' && pendingSubId
          ? apiFetch(`/api/creator/pending/${encodeURIComponent(pendingSubId)}`, { noCache: true })
          : Promise.resolve(null),
        needMeta ? loadGlobalCatalogMeta() : Promise.resolve(null),
      ]);
      if (analyticsPayload?.filter) {
        analyticsUiState.range = analyticsPayload.filter.range || analyticsUiState.range;
        analyticsUiState.startDate = analyticsPayload.filter.startDate || analyticsUiState.startDate;
        analyticsUiState.endDate = analyticsPayload.filter.endDate || analyticsUiState.endDate;
      }
    }

    const deletedCount = Number(
      activeTab === 'overview'
        ? overviewData?.contentPerformance?.deletedCount || 0
        : data?.analytics?.deletedCount || 0
    );
    const tabs = [
      { id: 'overview', label: 'Overview' },
      { id: 'upload', label: editId ? 'Edit Content' : 'Upload Content' },
      { id: 'published', label: 'Published Content' },
      { id: 'drafts', label: 'Draft Content' },
      { id: 'pending', label: 'Pending & Review' },
      { id: 'history', label: deletedCount > 0 ? `History & Recovery (${deletedCount})` : 'History & Recovery' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'earnings', label: 'Earnings' },
      { id: 'wallet', label: 'Wallet & Payouts' },
      { id: 'withdrawals', label: 'Withdrawal Requests' },
      { id: 'transactions', label: 'Transactions' },
      { id: 'profile', label: 'Creator Profile' },
    ];

    const wallet =
      activeTab === 'overview'
        ? {
            totalEarningsInr: String(overviewData?.earningsOverview?.lifetimeEarningsInr ?? '0.00'),
            pendingEarningsInr: String(overviewData?.earningsOverview?.pendingBalanceInr ?? '0.00'),
            availableBalanceInr: String(overviewData?.earningsOverview?.availableBalanceInr ?? '0.00'),
            withdrawnAmountInr: String(overviewData?.earningsOverview?.withdrawnAmountInr ?? '0.00'),
          }
        : data?.wallet || {
            totalEarningsInr: '0.00',
            pendingEarningsInr: '0.00',
            availableBalanceInr: '0.00',
            withdrawnAmountInr: '0.00',
          };
    const commRate = Number(
      activeTab === 'overview'
        ? overviewData?.creatorHeader?.effectiveCommissionRate ?? 10
        : data?.effectiveCommissionRate ?? 10
    );
    const sidebarName =
      activeTab === 'overview'
        ? overviewData?.creatorHeader?.displayName || store.user.name
        : data?.profile?.displayName || store.user.name;

    let bodyHtml = '';

    if (activeTab === 'overview') {
      bodyHtml = renderCreatorOverviewSectionHtml(overviewData, overviewState);
    } else if (activeTab === 'upload') {
      bodyHtml = renderContentEditorHtml(editPayload, commRate);
    } else if (activeTab === 'published') {
      if (publishedSubId) {
        if (publishedSubView === 'preview') {
          bodyHtml = await renderPublishedPreviewHtml(publishedDetailPayload);
        } else if (publishedSubView === 'analytics') {
          bodyHtml = renderPublishedAnalyticsHtml(publishedDetailPayload);
        } else {
          bodyHtml = renderPublishedDetailViewHtml(publishedDetailPayload);
        }
      } else {
        bodyHtml = renderPublishedContentSectionHtml(publishedPayload);
      }
    } else if (activeTab === 'drafts') {
      if (draftSubId && draftSubView === 'preview') {
        bodyHtml = await renderDraftPreviewHtml(draftDetailPayload);
      } else {
        bodyHtml = renderDraftContentSectionHtml(draftsPayload);
      }
    } else if (activeTab === 'pending') {
      if (pendingSubId) {
        bodyHtml = await renderSubmissionDetailsHtml(pendingDetailPayload);
      } else {
        bodyHtml = renderPendingSectionHtml(pendingPayload);
      }
    } else if (activeTab === 'history') {
      bodyHtml = renderCreatorHistoryHtml(historyPayload || { deletedContents: [], history: [], retentionDays: 15 });
    } else if (activeTab === 'analytics' || activeTab === 'earnings') {
      bodyHtml = renderAnalyticsSectionHtml(activeTab, analyticsSubId, analyticsSubView, analyticsPayload);
    } else if (activeTab === 'wallet') {
      const pd = data.profile?.payoutDetails || {};
      const pm = data.profile?.payoutMethod || 'upi';
      bodyHtml = `
        <div class="space-y-8">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Creator Wallet &amp; Payout Settings</h1>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500">Total Earnings</div>
              <div class="font-mono text-2xl font-semibold mt-1 tabular-nums">${formatInr(wallet.totalEarningsInr)}</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500">Available Balance</div>
              <div class="font-mono text-2xl font-semibold text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">${formatInr(wallet.availableBalanceInr)}</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500">Pending Payouts</div>
              <div class="font-mono text-2xl font-semibold text-amber-700 dark:text-amber-400 mt-1 tabular-nums">${formatInr(wallet.pendingEarningsInr)}</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500">Withdrawn Amount</div>
              <div class="font-mono text-2xl font-semibold mt-1 tabular-nums">${formatInr(wallet.withdrawnAmountInr)}</div>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Payout Details Form -->
            <form id="creator-payout-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
              <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Payout Destination Details</h2>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Payout Method</label>
                <select name="payoutMethod" id="cp-method" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                  <option value="upi" ${pm === 'upi' ? 'selected' : ''}>UPI (Instant Indian Transfer)</option>
                  <option value="bank_transfer" ${pm === 'bank_transfer' ? 'selected' : ''}>Bank Account (NEFT / IMPS)</option>
                </select>
              </div>
              <div id="cp-upi-fields" class="${pm === 'upi' ? '' : 'hidden'}">
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Verified UPI ID</label>
                <input name="upiId" value="${esc(pd.upiId || '')}" placeholder="author@okicici" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <div id="cp-bank-fields" class="space-y-3 ${pm === 'bank_transfer' ? '' : 'hidden'}">
                <div>
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Account Holder Name</label>
                  <input name="accountHolder" value="${esc(pd.accountHolder || '')}" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Account Number</label>
                    <input name="accountNumber" value="${esc(pd.accountNumber || '')}" class="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">IFSC Code</label>
                    <input name="ifscCode" value="${esc(pd.ifscCode || '')}" class="w-full px-3.5 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Bank Name</label>
                  <input name="bankName" value="${esc(pd.bankName || '')}" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
                </div>
              </div>
              <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Save Payout Details</button>
            </form>

            <!-- Request Withdrawal Form -->
            <form id="creator-withdraw-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
              <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Request Withdrawal</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                Minimum withdrawal threshold: <strong class="font-mono text-slate-900 dark:text-white">${formatInr(data.minWithdrawalInr)}</strong>. Requests are manually reviewed and marked Paid only after payout confirmation.
              </p>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Withdrawal Amount (INR)</label>
                <input name="amountInr" type="number" step="0.01" min="${data.minWithdrawalInr}" max="${Number(wallet.availableBalanceInr)}" value="${Number(wallet.availableBalanceInr) >= data.minWithdrawalInr ? Number(wallet.availableBalanceInr) : ''}" required placeholder="e.g. 500" class="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <button type="submit" ${Number(wallet.availableBalanceInr) < data.minWithdrawalInr ? 'disabled' : ''} class="px-5 py-2.5 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-50">
                Submit Withdrawal Request
              </button>
            </form>
          </div>
        </div>
      `;
    } else if (activeTab === 'withdrawals') {
      bodyHtml = `
        <div class="space-y-6">
          <div class="flex items-center justify-between">
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Withdrawal Requests</h1>
            <a href="#/creator/wallet" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">New Withdrawal</a>
          </div>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[600px] text-left text-sm">
              <thead class="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th class="px-4 py-3 font-semibold">Date</th>
                  <th class="px-4 py-3 font-semibold">Method</th>
                  <th class="px-4 py-3 font-semibold text-right">Amount</th>
                  <th class="px-4 py-3 font-semibold">Status</th>
                  <th class="px-4 py-3 font-semibold">Reference / Note</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                ${
                  data.withdrawals.length
                    ? data.withdrawals
                        .map(
                          (w) => `
                      <tr>
                        <td class="px-4 py-3 text-xs text-slate-500">${formatDate(w.createdAt)}</td>
                        <td class="px-4 py-3 text-xs uppercase">${esc(w.payoutMethod)}</td>
                        <td class="px-4 py-3 text-right font-mono font-semibold tabular-nums">${formatInr(w.amountInr)}</td>
                        <td class="px-4 py-3">${renderStatusLabel(w.status)}</td>
                        <td class="px-4 py-3 text-xs text-slate-500">${esc(w.payoutReference || w.adminNote || 'Pending admin review')}</td>
                      </tr>
                    `
                        )
                        .join('')
                    : `<tr><td colspan="5" class="px-4 py-8 text-center text-slate-500">No withdrawal requests submitted yet.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === 'transactions') {
      bodyHtml = `
        <div>
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-6">Creator Transaction Ledger</h1>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[620px] text-left text-sm">
              <thead class="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th class="px-4 py-3 font-semibold">Date</th>
                  <th class="px-4 py-3 font-semibold">Type</th>
                  <th class="px-4 py-3 font-semibold">Description</th>
                  <th class="px-4 py-3 font-semibold">Status</th>
                  <th class="px-4 py-3 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                ${
                  data.transactions.length
                    ? data.transactions
                        .map(
                          (t) => `
                      <tr>
                        <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${formatDate(t.createdAt)}</td>
                        <td class="px-4 py-3 text-xs capitalize">${esc(t.type.replace(/_/g, ' '))}</td>
                        <td class="px-4 py-3 text-xs">${esc(t.description)}</td>
                        <td class="px-4 py-3">${renderStatusLabel(t.status)}</td>
                        <td class="px-4 py-3 text-right font-mono tabular-nums ${t.direction === 'credit' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}">${t.direction === 'credit' ? '+' : '-'}${formatInr(t.amountInr)}</td>
                      </tr>
                    `
                        )
                        .join('')
                    : `<tr><td colspan="5" class="px-4 py-8 text-center text-slate-500">No ledger transactions yet.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === 'profile') {
      const cp = data.profile || {};
      bodyHtml = `
        <div class="max-w-2xl">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-6">Creator Public Profile</h1>
          <form id="creator-profile-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Display Name</label>
              <input name="displayName" value="${esc(cp.displayName || store.user.name)}" required class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Tagline</label>
              <input name="tagline" value="${esc(cp.tagline || '')}" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Expertise &amp; Subjects</label>
              <input name="expertise" value="${esc(cp.expertise || '')}" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Author Biography</label>
              <textarea name="bio" rows="4" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">${esc(store.user.bio || '')}</textarea>
            </div>
            <div class="flex items-center justify-between pt-2">
              <a href="#/creator-profile/${store.user.id}" class="text-xs font-semibold text-[#1B3B6F] dark:text-sky-400 hover:underline">View Public Profile →</a>
              <button type="submit" class="px-5 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Save Changes</button>
            </div>
          </form>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="${isAnalyticsOrEarnings ? 'min-h-[calc(100vh-3.5rem)] bg-[#F5F6FC] dark:bg-[#0B1120]' : ''}">
      <div class="max-w-7xl mx-auto ${isAnalyticsOrEarnings ? 'px-3 sm:px-6 lg:px-8 py-3.5 sm:py-6 pb-20 md:pb-8' : 'px-4 sm:px-6 lg:px-8 py-6 sm:py-8'}">
        <div class="flex flex-col lg:flex-row gap-5 lg:gap-8">
          <aside class="${isAnalyticsOrEarnings ? 'hidden lg:block ' : ''}lg:w-60 shrink-0">
            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4">
              <div class="flex items-center justify-between gap-3 px-2 sm:px-3 pb-2.5 mb-2.5 border-b border-slate-100 dark:border-slate-800">
                <div class="min-w-0">
                  <div class="font-semibold text-sm text-slate-900 dark:text-white truncate">${esc(sidebarName)}</div>
                  <div class="text-xs text-emerald-700 dark:text-emerald-400 font-mono tabular-nums">${formatInr(wallet.availableBalanceInr)} available</div>
                </div>
                <div class="flex lg:hidden items-center gap-2.5 shrink-0">
                  <a href="#/dashboard" class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white whitespace-nowrap">Reader</a>
                  ${store.user.role === 'admin' ? `<a href="#/admin" class="text-xs font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">Admin →</a>` : ''}
                </div>
              </div>
              <nav class="flex lg:flex-col gap-1.5 overflow-x-auto no-scrollbar touch-scroll-x pb-0.5 lg:pb-0">
                ${tabs
                  .map(
                    (t) => `
                  <a href="#/creator/${t.id}" class="flex items-center px-3 py-2 min-h-[40px] rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    activeTab === t.id
                      ? 'bg-[#0F2547] text-white dark:bg-sky-500 dark:text-slate-950'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }">${esc(t.label)}</a>
                `
                  )
                  .join('')}
              </nav>
              <div class="hidden lg:block pt-3 mt-3 border-t border-slate-100 dark:border-slate-800 space-y-1">
                <a href="#/dashboard" class="block px-3 py-1.5 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">← Reader Dashboard</a>
                ${store.user.role === 'admin' ? `<a href="#/admin" class="block px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">Admin Console →</a>` : ''}
              </div>
            </div>
          </aside>
          <div id="creator-tab-body" class="flex-1 min-w-0">${bodyHtml}</div>
        </div>
      </div>
      </div>
    `;

    // Wire Overview interactive date filters, sort toggle, and live refresh without reloading sidebar shell
    if (activeTab === 'overview') {
      const reloadOverview = async () => {
        const bodyEl = document.getElementById('creator-tab-body');
        if (!bodyEl) return;
        bodyEl.style.opacity = '0.6';
        try {
          const fresh = await apiFetch(buildOverviewUrl(), { noCache: true });
          overviewState.range = fresh.filter?.range || overviewState.range;
          overviewState.startDate = fresh.filter?.startDate || overviewState.startDate;
          overviewState.endDate = fresh.filter?.endDate || overviewState.endDate;
          overviewState.sortBy = fresh.filter?.sortBy || overviewState.sortBy;
          bodyEl.innerHTML = renderCreatorOverviewSectionHtml(fresh, overviewState);
          bodyEl.style.opacity = '1';
          bindOverviewEvents();
        } catch (err) {
          bodyEl.style.opacity = '1';
          showToast(err.message || 'Unable to refresh creator overview.', 'error');
        }
      };

      const bindOverviewEvents = () => {
        const rangeSelect = document.getElementById('co-date-range');
        const customBar = document.getElementById('co-custom-date-bar');
        const startInput = document.getElementById('co-start-date');
        const endInput = document.getElementById('co-end-date');

        rangeSelect?.addEventListener('change', () => {
          const val = rangeSelect.value;
          overviewState.range = val;
          if (val === 'custom') {
            customBar?.classList.remove('hidden');
            customBar?.classList.add('flex');
            return;
          }
          customBar?.classList.add('hidden');
          customBar?.classList.remove('flex');
          reloadOverview();
        });

        document.getElementById('co-apply-custom-btn')?.addEventListener('click', () => {
          const s = startInput?.value || '';
          const e = endInput?.value || '';
          if (!s || !e) {
            showToast('Please select both start and end dates.', 'error');
            return;
          }
          if (s > e) {
            showToast('Start date cannot be later than end date.', 'error');
            return;
          }
          overviewState.range = 'custom';
          overviewState.startDate = s;
          overviewState.endDate = e;
          reloadOverview();
        });

        document.getElementById('co-refresh-btn')?.addEventListener('click', () => {
          reloadOverview();
        });

        document.querySelectorAll('.co-sort-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const nextSort = btn.dataset.sortBy === 'earnings' ? 'earnings' : 'views';
            if (overviewState.sortBy === nextSort) return;
            overviewState.sortBy = nextSort;
            reloadOverview();
          });
        });
      };

      bindOverviewEvents();
    }

    // Wire table actions (Soft-Delete to 15-Day History & Recovery Bin)
    container.querySelectorAll('.creator-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const res = await apiFetch(`/api/creator/contents/${btn.dataset.id}`, { method: 'DELETE' });
          showToast(res.message || 'Moved to History & Recovery Bin (recoverable for 15 days).', 'success');
          renderCreatorDashboardPage(container, activeTab);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // Wire Creator History & 15-Day Recovery Bin actions
    if (activeTab === 'history') {
      wireCreatorHistoryHandlers(
        container,
        historyPayload || { deletedContents: [], history: [] },
        () => renderCreatorDashboardPage(container, 'history')
      );
    }

    // Wire Pending & Review section & Submission Details
    if (activeTab === 'pending') {
      if (pendingSubId) {
        wireSubmissionDetailsEvents(container, pendingSubView);
      } else {
        wirePendingListEvents(container, pendingPayload);
      }
    }

    // Wire Published Content section & subviews (Details, Preview, Analytics)
    if (activeTab === 'published') {
      if (publishedSubId) {
        wirePublishedSubViewEvents(container, publishedSubView, publishedDetailPayload);
      } else {
        wirePublishedListEvents(container, publishedPayload);
      }
    }

    // Wire Draft Content section & Draft Preview
    if (activeTab === 'drafts') {
      if (draftSubId && draftSubView === 'preview') {
        wireDraftPreviewEvents(container, draftDetailPayload);
      } else {
        wireDraftsListEvents(container, draftsPayload);
      }
    }

    // Wire Upload / Editor studio if active
    if (activeTab === 'upload') {
      wireContentEditor(container, editPayload, commRate);
    }

    // Wire Creator Analytics & Earnings System
    if (isAnalyticsOrEarnings) {
      const tabBody = document.getElementById('creator-tab-body') || container;
      wireAnalyticsEvents(tabBody, {
        activeTab,
        subId: analyticsSubId,
        subView: analyticsSubView,
        initialPayload: analyticsPayload,
      });
    }

    // Wire Payout Details & Withdrawal forms
    document.getElementById('cp-method')?.addEventListener('change', (e) => {
      const isUpi = e.target.value === 'upi';
      document.getElementById('cp-upi-fields')?.classList.toggle('hidden', !isUpi);
      document.getElementById('cp-bank-fields')?.classList.toggle('hidden', isUpi);
    });

    document.getElementById('creator-payout-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await apiFetch('/api/creator/payout-details', {
          method: 'PUT',
          body: Object.fromEntries(fd.entries()),
        });
        showToast(res.message, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('creator-withdraw-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await apiFetch('/api/creator/withdrawals', {
          method: 'POST',
          body: { amountInr: Number(fd.get('amountInr')) },
        });
        showToast(res.message, 'success');
        window.location.hash = '#/creator/withdrawals';
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('creator-profile-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await apiFetch('/api/auth/profile', {
          method: 'PUT',
          body: {
            name: store.user.name,
            bio: fd.get('bio'),
            creatorProfile: {
              displayName: fd.get('displayName'),
              tagline: fd.get('tagline'),
              expertise: fd.get('expertise'),
            },
          },
        });
        store.user = res.user;
        notifyStore();
        showToast('Creator profile updated.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  } catch (err) {
    container.innerHTML = `
      <div class="max-w-2xl mx-auto px-4 py-12">
        <div class="bg-white dark:bg-[#111A2E] border border-red-200 dark:border-red-900/60 rounded-2xl p-6 text-center space-y-3">
          <div class="text-sm font-semibold text-red-700 dark:text-red-400">Unable to load Creator Studio</div>
          <p class="text-xs text-slate-600 dark:text-slate-400">${esc(err?.message || 'A temporary connection error occurred while loading your creator data.')}</p>
          <div class="pt-1">
            <button type="button" id="creator-retry-load" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors">
              Try Again
            </button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('creator-retry-load')?.addEventListener('click', () => {
      renderCreatorDashboardPage(container, activeTab, routeParam);
    });
  }
}

function renderContentEditorHtml(editPayload, commRate) {
  const item = editPayload?.content || null;
  const files = editPayload?.files || [];
  const existingExternalVideoUrl =
    files.find((f) => f.fileType === 'video' && f.externalVideoUrl)?.externalVideoUrl || '';
  const isPaid = item ? !item.isFree : false;
  const currentPrice = item ? Number(item.priceInr) : 49;

  if (item && item.status === 'pending' && store.user?.role !== 'admin') {
    return `
      <div class="space-y-5 max-w-2xl">
        <a href="#/creator/pending" class="inline-flex items-center gap-1 text-xs font-semibold text-[#5a1fd8] dark:text-sky-400 hover:underline">← Back to Pending &amp; Review</a>
        <div class="bg-white dark:bg-[#111A2E] border border-amber-200 dark:border-amber-900/60 rounded-2xl p-6 sm:p-8 space-y-4">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            Under Review · Editing Locked
          </div>
          <h1 class="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white">${esc(item.title)}</h1>
          <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            This submission is currently under moderation review and cannot be edited until moderators finish reviewing it or request changes.
          </p>
          <div class="flex flex-wrap items-center gap-3 pt-2">
            <a href="#/creator/pending/${item.id}" class="min-h-[42px] inline-flex items-center px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white">View Submission Details</a>
            <a href="#/creator/pending" class="min-h-[42px] inline-flex items-center px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">← Back to Pending &amp; Review</a>
          </div>
        </div>
      </div>
    `;
  }

  const fromPublished = window.location.hash.includes('from=published');
  const fromPending =
    window.location.hash.includes('from=pending') || item?.status === 'changes_requested';
  const fromDrafts =
    !fromPending && (window.location.hash.includes('from=drafts') || item?.status === 'draft');

  const backLinkHtml = fromPending
    ? `<a href="#/creator/pending" class="inline-flex items-center gap-1 text-xs font-semibold text-[#5a1fd8] dark:text-sky-400 hover:underline mb-1">← Back to Pending &amp; Review</a>`
    : fromDrafts
    ? `<a href="#/creator/drafts" class="inline-flex items-center gap-1 text-xs font-semibold text-[#5a1fd8] dark:text-sky-400 hover:underline mb-1">← Back to Draft Content</a>`
    : fromPublished
    ? `<a href="#/creator/published" class="inline-flex items-center gap-1 text-xs font-semibold text-[#5a1fd8] dark:text-sky-400 hover:underline mb-1">← Back to Published Content</a>`
    : '';

  const editorHeading = item
    ? item.status === 'changes_requested'
      ? 'Revise &amp; Resubmit Content'
      : item.status === 'draft'
      ? 'Edit Draft Content'
      : 'Edit Published Content'
    : 'Publish New Educational Content';

  const modFeedbackBanner =
    item && (item.status === 'changes_requested' || item.status === 'rejected') && item.rejectionReason
      ? `<div class="p-4 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/30 space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-300">Moderator Feedback to Address</span>
            <a href="#/creator/pending/${item.id}/feedback" class="text-xs font-semibold text-rose-700 dark:text-rose-300 hover:underline">Full Feedback Details →</a>
          </div>
          <p class="text-sm text-rose-950 dark:text-rose-100 leading-relaxed whitespace-pre-line">${esc(item.rejectionReason)}</p>
        </div>`
      : '';

  return `
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="space-y-1">
          ${backLinkHtml}
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">${editorHeading}</h1>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Select format, write rich text or attach PDFs/videos, configure Free or INR pricing, and preview before submission.</p>
        </div>
        <button type="button" id="ed-preview-btn" class="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">
          Preview Content
        </button>
      </div>

      ${modFeedbackBanner}

      <form id="creator-content-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6 space-y-6">
        <!-- Content Type & Basic Metadata -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Publication Title</label>
            <input name="title" id="ed-title" required value="${esc(item?.title || '')}" placeholder="e.g. Complete Organic Chemistry Reaction Mechanisms Notes" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
          </div>
          <div>
            <label for="ed-author-name" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Author / Creator Display Name *</label>
            <input name="authorName" id="ed-author-name" maxlength="160" value="${esc(item?.authorName || '')}" placeholder="Name shown publicly on this publication (overrides profile name)" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Readers will see this exact author name on this work instead of your account profile name.</p>
          </div>
          <div>
            <label for="ed-publisher-name" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Publisher / Institution Name (optional)</label>
            <input name="publisherName" id="ed-publisher-name" maxlength="160" value="${esc(item?.publisherName || '')}" placeholder="e.g. Vidya Academy Press, IIT Notes Cell, Self-Published" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Optional coaching institute, college department, or publisher imprint.</p>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Content Type</label>
            <select name="contentType" id="ed-type" class="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
              ${CONTENT_TYPES.map((t) => `<option value="${esc(t)}" ${item?.contentType === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Language</label>
            <select name="language" id="ed-language" class="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
              ${LANGUAGES.map((l) => `<option value="${esc(l)}" ${(item?.language || 'English') === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}
            </select>
          </div>
          <div class="relative" id="ed-category-picker">
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Category</label>
            <input type="hidden" name="categoryId" id="ed-category" value="${item?.categoryId || ''}" />
            <button
              type="button"
              id="ed-category-trigger"
              aria-haspopup="listbox"
              aria-expanded="false"
              class="w-full px-3.5 py-2.5 text-sm text-left rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] flex items-center justify-between gap-2 hover:border-indigo-400 dark:hover:border-sky-500 transition-colors"
            >
              <span id="ed-category-label" class="truncate text-slate-800 dark:text-slate-100">
                ${esc(store.categories.find((c) => c.id === item?.categoryId)?.name || 'Select category...')}
              </span>
              <svg class="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <div
              id="ed-category-menu"
              class="hidden absolute left-0 right-0 mt-1.5 z-40 bg-white dark:bg-[#0F1A30] border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden"
            >
              <div class="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]">
                <input
                  type="search"
                  id="ed-category-search"
                  placeholder="Search category..."
                  class="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] outline-none focus:border-[#5a1fd8] dark:focus:border-sky-400"
                />
              </div>
              <div id="ed-category-list" role="listbox" class="max-h-56 overflow-y-auto overscroll-contain divide-y divide-slate-100/70 dark:divide-slate-800/70"></div>
            </div>
            <div id="ed-category-other-wrap" class="hidden mt-2">
              <input
                type="text"
                id="ed-category-other-text"
                maxlength="80"
                placeholder="Write custom category name (optional)..."
                class="w-full px-3 py-2 text-xs rounded-lg border border-indigo-200 dark:border-slate-700 bg-white dark:bg-[#0B1120]"
              />
            </div>
          </div>

          <div class="relative" id="ed-subject-picker">
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Subject</label>
            <input type="hidden" name="subjectId" id="ed-subject" value="${item?.subjectId || ''}" />
            <button
              type="button"
              id="ed-subject-trigger"
              aria-haspopup="listbox"
              aria-expanded="false"
              class="w-full px-3.5 py-2.5 text-sm text-left rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] flex items-center justify-between gap-2 hover:border-indigo-400 dark:hover:border-sky-500 transition-colors"
            >
              <span id="ed-subject-label" class="truncate text-slate-800 dark:text-slate-100">
                ${esc(store.subjects.find((s) => s.id === item?.subjectId)?.name || 'Select subject...')}
              </span>
              <svg class="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <div
              id="ed-subject-menu"
              class="hidden absolute left-0 right-0 mt-1.5 z-40 bg-white dark:bg-[#0F1A30] border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden"
            >
              <div class="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]">
                <input
                  type="search"
                  id="ed-subject-search"
                  placeholder="Search subject..."
                  class="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] outline-none focus:border-[#5a1fd8] dark:focus:border-sky-400"
                />
              </div>
              <div id="ed-subject-list" role="listbox" class="max-h-56 overflow-y-auto overscroll-contain divide-y divide-slate-100/70 dark:divide-slate-800/70"></div>
            </div>
            <div id="ed-subject-other-wrap" class="hidden mt-2">
              <input
                type="text"
                id="ed-subject-other-text"
                maxlength="80"
                placeholder="Write custom subject name (optional)..."
                class="w-full px-3 py-2 text-xs rounded-lg border border-indigo-200 dark:border-slate-700 bg-white dark:bg-[#0B1120]"
              />
            </div>
          </div>
          <div class="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              <label for="ed-class-level" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Class / Academic Level (optional)</label>
              <input name="classLevel" id="ed-class-level" maxlength="60" value="${esc(item?.classLevel || '')}" placeholder="e.g. Class 10, Class 12, JEE, BSc" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label for="ed-study-label" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Educational Label (optional)</label>
              <select name="studyLabel" id="ed-study-label" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                <option value="">General / Unspecified</option>
                ${['Lecture', 'Exercise Solution', 'Chapter Summary', 'Revision', 'Practice', 'Previous Year Questions']
                  .map(
                    (lbl) =>
                      `<option value="${esc(lbl)}" ${item?.studyLabel === lbl ? 'selected' : ''}>${esc(lbl)}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div>
              <label for="ed-duration-mins" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Duration (Minutes, optional)</label>
              <input type="number" name="durationMinutes" id="ed-duration-mins" min="1" max="1440" value="${item?.durationSeconds ? Math.max(1, Math.round(Number(item.durationSeconds) / 60)) : ''}" placeholder="e.g. 25" class="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label for="ed-chapter" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Chapter Name (optional)</label>
              <input name="chapter" id="ed-chapter" maxlength="120" value="${esc(item?.chapter || '')}" placeholder="e.g. Chapter 2: Quadratic Equations" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label for="ed-chapter-order" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Chapter Sequence No. (optional)</label>
              <input type="number" name="chapterOrder" id="ed-chapter-order" min="1" max="200" value="${item?.chapterOrder ?? ''}" placeholder="e.g. 2" class="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label for="ed-topic" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Key Topic (optional)</label>
              <input name="topic" id="ed-topic" maxlength="120" value="${esc(item?.topic || '')}" placeholder="e.g. Factorization, Newton's Laws" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Short Description</label>
            <textarea name="shortDescription" id="ed-desc" rows="2" required placeholder="Summarize what readers or students will learn from this resource..." class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">${esc(item?.shortDescription || '')}</textarea>
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Tags &amp; Keywords (comma-separated)</label>
            <input name="tags" id="ed-tags" value="${esc((item?.tags || []).join(', '))}" placeholder="e.g. gate-cs, algorithms, revision-notes, pdf" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
          </div>
        </div>

        <!-- Cover Artwork Selection & Direct Upload -->
        <div class="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Cover Image / Thumbnail</label>
            <span id="ed-cover-status" class="text-[11px] text-slate-500 dark:text-slate-400">
              ${item?.coverImageUrl?.startsWith('data:image/') ? 'Custom uploaded cover' : 'Choose a preset, upload a photo, or paste a URL'}
            </span>
          </div>

          <!-- Left-side Upload Cover Photo + Live Preview -->
          <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]">
            <div class="flex items-center gap-3 w-full sm:w-auto">
              <button type="button" id="ed-cover-upload-btn" class="inline-flex items-center justify-center gap-1.5 min-h-[42px] px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 whitespace-nowrap shrink-0 transition-colors">
                <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>
                <span>Upload Cover Photo</span>
              </button>
              <input type="file" id="ed-cover-file-input" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" />
              <img id="ed-cover-preview" src="${esc(item?.coverImageUrl || PRESET_COVERS[0].url)}" alt="Selected cover preview" data-zoom-title="Selected Cover Preview" class="sp-zoom-img cursor-zoom-in w-16 h-12 rounded-md object-cover border border-slate-200 dark:border-slate-700 shrink-0" />
            </div>
            <div class="flex-1 w-full min-w-0">
              <input type="hidden" id="ed-cover-value" value="${esc(item?.coverImageUrl || PRESET_COVERS[0].url)}" />
              <input name="coverImageUrl" id="ed-cover-url" value="${item?.coverImageUrl?.startsWith('data:image/') ? '' : esc(item?.coverImageUrl || PRESET_COVERS[0].url)}" placeholder="${item?.coverImageUrl?.startsWith('data:image/') ? 'Custom cover photo uploaded (or paste external image URL to replace)' : 'Or paste an external image URL (https://...)'}" class="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111A2E]" />
            </div>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            ${PRESET_COVERS.map(
              (p) => `
              <button type="button" data-cover="${esc(p.url)}" class="ed-cover-preset text-left rounded-lg overflow-hidden border-2 transition-colors ${
                item?.coverImageUrl === p.url ? 'border-[#0F2547] dark:border-sky-400' : 'border-slate-200 dark:border-slate-800'
              }">
                <img src="${esc(p.url)}" alt="${esc(p.label)}" class="w-full aspect-[4/3] object-cover" />
                <div class="p-2 text-[11px] font-medium truncate">${esc(p.label)}</div>
              </button>
            `
            ).join('')}
          </div>
        </div>

        <!-- Rich-Text Editorial Studio -->
        <div class="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Full Content (Rich-Text Editor)</label>
          <div class="border border-slate-300 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-[#0B1120]">
            <!-- Formatting Toolbar (Left-first Photo & File buttons always visible) -->
            <div class="flex items-center gap-1 p-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111A2E] overflow-x-auto no-scrollbar touch-scroll-x">
              <button type="button" id="rte-upload-image" title="Insert Photo into Content" class="inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1 text-xs font-semibold rounded bg-[#0F2547] text-white hover:bg-[#1B3B6F] dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 whitespace-nowrap shrink-0 transition-colors">
                <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                <span>+ Photo</span>
              </button>
              <button type="button" id="rte-attach-file-top" title="Attach PDF, Video, or Document" class="inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1 text-xs font-semibold rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 transition-colors">
                <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path></svg>
                <span>+ File</span>
              </button>
              <span class="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-1 shrink-0"></span>
              <button type="button" data-cmd="formatBlock" data-val="H2" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs font-semibold rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">H2</button>
              <button type="button" data-cmd="formatBlock" data-val="H3" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs font-semibold rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">H3</button>
              <button type="button" data-cmd="formatBlock" data-val="P" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">Paragraph</button>
              <button type="button" data-cmd="bold" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs font-bold rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">B</button>
              <button type="button" data-cmd="italic" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs italic rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">I</button>
              <button type="button" data-cmd="insertUnorderedList" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">• List</button>
              <button type="button" data-cmd="insertOrderedList" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">1. List</button>
              <button type="button" data-cmd="formatBlock" data-val="BLOCKQUOTE" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">Quote</button>
              <button type="button" id="rte-insert-code" class="min-h-[34px] px-2.5 py-1 text-xs font-mono rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">Code</button>
              <input type="file" id="rte-image-file-input" accept="image/*,video/*" multiple class="hidden" />
            </div>

            <!-- Editable Prose Canvas -->
            <div id="ed-rte" contenteditable="true" data-placeholder="Write your notes, article, poem, story, or lecture transcript here. Use + Photo or + File to add images, videos, PDFs, or documents..." class="sp-rte-editor reading-prose p-4 sm:p-5 max-w-none">${item?.bodyHtml || ''}</div>

            <!-- Bottom-Left Composer Attachment Bar (always visible on phone & desktop) -->
            <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-[#111A2E]">
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" id="rte-bottom-photo-btn" class="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-800 dark:text-slate-100 hover:border-[#0F2547] dark:hover:border-sky-400 transition-colors">
                  <svg class="w-4 h-4 text-[#0F2547] dark:text-sky-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>
                  <span>Insert Photos</span>
                </button>
                <button type="button" id="rte-bottom-file-btn" class="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-800 dark:text-slate-100 hover:border-[#0F2547] dark:hover:border-sky-400 transition-colors">
                  <svg class="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path></svg>
                  <span>Attach Files / Media</span>
                </button>
                <input type="file" id="ed-file-input" multiple accept="image/*,video/*,.pdf,.mp4,.webm,.mov,.jpg,.jpeg,.png,.webp,.gif,.txt,.md,.docx" class="hidden" />
              </div>
              <span id="rte-pending-file-chip" class="text-[11px] text-slate-500 dark:text-slate-400">Add photos, videos, PDFs, or study files</span>
            </div>
          </div>

          <!-- Compact Attached / Queued Media List (appears only when files are selected or already saved) -->
          <div id="ed-queued-files-wrap" class="hidden space-y-2 pt-2">
            <div class="flex items-center justify-between text-xs">
              <span class="font-semibold text-slate-700 dark:text-slate-300">Selected Media &amp; Files</span>
              <div class="flex items-center gap-3">
                ${item ? `<button type="button" id="ed-upload-file-btn" class="hidden px-3 py-1 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white whitespace-nowrap">Upload Now</button>` : ''}
                <button type="button" id="ed-clear-queue-btn" class="text-red-600 dark:text-red-400 hover:underline font-medium">Clear</button>
              </div>
            </div>
            <div id="ed-queued-files-grid" class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2"></div>
          </div>
          ${
            files.length
              ? `<div id="ed-files-list" class="space-y-1.5 pt-2">
                  ${files
                    .map(
                      (f) => `
                    <div class="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
                      <span class="truncate">${esc(f.originalName)} (${esc(f.fileType.toUpperCase())} · ${formatBytes(f.sizeBytes)})</span>
                      <button type="button" data-file-id="${f.id}" class="ed-del-file text-red-600 hover:underline font-semibold shrink-0">Remove</button>
                    </div>
                  `
                    )
                    .join('')}
                </div>`
              : `<div id="ed-files-list" class="hidden"></div>`
          }
        </div>

        <!-- YouTube Share Link / Authorized Video URL (optional) -->
        <div class="space-y-2.5">
          <div>
            <label for="ed-video-url" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">YouTube Share Link or Video Lecture URL (optional, for Video Lectures / Tutorials)</label>
            <input name="externalVideoUrl" id="ed-video-url" value="${esc(existingExternalVideoUrl)}" placeholder="Paste any YouTube share link (https://youtu.be/..., youtube.com/watch?v=..., Shorts, Live) or Vimeo link" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Direct YouTube Share links (<code>youtu.be/...</code>, <code>youtube.com/watch?v=...</code>, Shorts, Live) are automatically converted into a playable lecture player.</p>
          </div>
          <div id="ed-video-preview-wrap" class="hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] p-3 space-y-2">
            <div class="flex items-center justify-between gap-2 text-xs">
              <span id="ed-video-preview-status" class="font-semibold text-emerald-700 dark:text-emerald-400"></span>
              <a id="ed-video-preview-ext" href="#" target="_blank" rel="noopener noreferrer" class="text-[#0F2547] dark:text-sky-400 hover:underline font-medium">Open link ↗</a>
            </div>
            <div class="aspect-video w-full max-w-xl rounded-lg overflow-hidden bg-black">
              <iframe id="ed-video-preview-frame" src="" title="Video lecture preview" class="w-full h-full border-0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
            </div>
          </div>
        </div>

        <!-- Free vs Paid Monetization Configuration -->
        <div class="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Publishing Pricing Tier</label>
              <p class="text-xs text-slate-500">Choose open-access Free publishing or Paid monetization in INR.</p>
            </div>
            <div class="flex items-center gap-1 p-1 bg-slate-100 dark:bg-[#0B1120] rounded-lg">
              <button type="button" id="ed-mode-free" class="px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${!isPaid ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}">Free Access</button>
              <button type="button" id="ed-mode-paid" class="px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${isPaid ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}">Paid Premium (INR)</button>
            </div>
          </div>

          <div id="ed-paid-panel" class="${isPaid ? '' : 'hidden'} p-5 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 space-y-4">
            <div class="flex flex-wrap items-center gap-2">
              ${[10, 20, 49, 99, 199]
                .map(
                  (amt) =>
                    `<button type="button" data-price="${amt}" class="ed-price-preset px-3 py-1.5 text-xs font-mono font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:border-[#0F2547] dark:hover:border-sky-400">₹${amt}</button>`
                )
                .join('')}
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Custom Price (INR, ₹10–₹50,000)</label>
                <input type="number" id="ed-price" name="priceInr" min="10" max="50000" step="1" value="${currentPrice || 49}" class="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111A2E]" />
              </div>
              <div id="ed-commission-calc" class="text-xs text-slate-600 dark:text-slate-300 p-3 rounded-lg bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 font-mono tabular-nums"></div>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Public Preview Excerpt (shown before purchase, optional)</label>
              <textarea name="previewHtml" id="ed-preview-html" rows="2" placeholder="Leave blank to auto-generate a clean excerpt from your opening paragraphs." class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111A2E]">${esc(item?.previewHtml || '')}</textarea>
            </div>
          </div>
        </div>

        <!-- Copyright Ownership Confirmation -->
        <div class="pt-4 border-t border-slate-100 dark:border-slate-800">
          <label class="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
            <input type="checkbox" id="ed-ownership" ${item?.ownershipConfirmed ? 'checked' : ''} class="mt-0.5 rounded" />
            <span>I solemnly confirm that I am the original author or hold explicit legal rights to publish and monetize this content, and that it complies with ScholarPress <a href="#/copyright" class="underline">Copyright Policy</a>.</span>
          </label>
        </div>

        <div class="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-3 pt-2">
          ${
            item && item.status === 'changes_requested'
              ? `<button type="button" id="ed-save-draft" class="w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">Save as Draft</button>
                 <button type="button" id="ed-submit-publish" class="w-full sm:w-auto min-h-[44px] px-6 py-2.5 text-xs font-semibold rounded-lg bg-[#5a1fd8] hover:bg-[#4c1d95] text-white">Save Changes &amp; Resubmit</button>`
              : item && item.status === 'draft'
              ? `<button type="button" id="ed-submit-publish" class="w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">Publish Content</button>
                 <button type="button" id="ed-save-draft" class="w-full sm:w-auto min-h-[44px] px-6 py-2.5 text-xs font-semibold rounded-lg bg-[#5a1fd8] hover:bg-[#4c1d95] text-white">Save Changes</button>`
              : item && item.status === 'approved'
              ? `<button type="button" id="ed-save-draft" class="w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">Save as Draft</button>
                 <button type="button" id="ed-submit-publish" class="w-full sm:w-auto min-h-[44px] px-6 py-2.5 text-xs font-semibold rounded-lg bg-[#5a1fd8] hover:bg-[#4c1d95] text-white">Save Changes</button>`
              : `<button type="button" id="ed-save-draft" class="w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">Save as Draft</button>
                 <button type="button" id="ed-submit-publish" class="w-full sm:w-auto min-h-[44px] px-6 py-2.5 text-xs font-semibold rounded-lg bg-[#5a1fd8] hover:bg-[#4c1d95] text-white">${item ? 'Save Changes' : 'Submit for Approval'}</button>`
          }
        </div>
      </form>
    </div>
  `;
}

function wireContentEditor(container, editPayload, commRate) {
  if (editPayload?.content?.status === 'pending' && store.user?.role !== 'admin') {
    return;
  }
  let isFree = editPayload?.content ? Boolean(editPayload.content.isFree) : true;
  const editingId = editPayload?.content?.id || null;

  const updateCommCalc = () => {
    const price = Number(document.getElementById('ed-price')?.value || 0);
    const comm = Number(((price * commRate) / 100).toFixed(2));
    const net = Number((price - comm).toFixed(2));
    const el = document.getElementById('ed-commission-calc');
    if (el) {
      el.innerHTML = `Platform (${commRate}%): <strong>${formatInr(comm)}</strong> · Your Net Earnings: <strong class="text-emerald-700 dark:text-emerald-400">${formatInr(net)}</strong>`;
    }
  };
  updateCommCalc();

  document.getElementById('ed-price')?.addEventListener('input', updateCommCalc);
  container.querySelectorAll('.ed-price-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('ed-price').value = btn.dataset.price;
      updateCommCalc();
    });
  });

  const setFreeMode = (free) => {
    isFree = free;
    document.getElementById('ed-paid-panel')?.classList.toggle('hidden', free);
    const freeBtn = document.getElementById('ed-mode-free');
    const paidBtn = document.getElementById('ed-mode-paid');
    if (freeBtn && paidBtn) {
      freeBtn.className = `px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${free ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`;
      paidBtn.className = `px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${!free ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`;
    }
  };
  document.getElementById('ed-mode-free')?.addEventListener('click', () => setFreeMode(true));
  document.getElementById('ed-mode-paid')?.addEventListener('click', () => setFreeMode(false));

  // Scrollable Category & Subject Pickers (with "Other" always last + live search & custom Other label)
  const catHiddenEl = document.getElementById('ed-category');
  const subjHiddenEl = document.getElementById('ed-subject');
  const catTrigger = document.getElementById('ed-category-trigger');
  const catLabel = document.getElementById('ed-category-label');
  const catMenu = document.getElementById('ed-category-menu');
  const catSearch = document.getElementById('ed-category-search');
  const catList = document.getElementById('ed-category-list');
  const catOtherWrap = document.getElementById('ed-category-other-wrap');

  const subjTrigger = document.getElementById('ed-subject-trigger');
  const subjLabel = document.getElementById('ed-subject-label');
  const subjMenu = document.getElementById('ed-subject-menu');
  const subjSearch = document.getElementById('ed-subject-search');
  const subjList = document.getElementById('ed-subject-list');
  const subjOtherWrap = document.getElementById('ed-subject-other-wrap');

  const sortWithOtherLast = (arr) =>
    [...(arr || [])].sort((a, b) => {
      const aOther = String(a?.name || '').trim().toLowerCase() === 'other' ? 1 : 0;
      const bOther = String(b?.name || '').trim().toLowerCase() === 'other' ? 1 : 0;
      if (aOther !== bOther) return aOther - bOther;
      const aOrd = Number(a?.displayOrder ?? a?.id ?? 0);
      const bOrd = Number(b?.displayOrder ?? b?.id ?? 0);
      return aOrd - bOrd;
    });

  const sortedCategories = sortWithOtherLast(store.categories || []);
  const getSubjectsForCategory = (cid) => {
    const numCid = Number(cid || 0);
    const list = numCid
      ? (store.subjects || []).filter((s) => Number(s.categoryId) === numCid)
      : store.subjects || [];
    return sortWithOtherLast(list);
  };

  const closeMenus = () => {
    catMenu?.classList.add('hidden');
    subjMenu?.classList.add('hidden');
    catTrigger?.setAttribute('aria-expanded', 'false');
    subjTrigger?.setAttribute('aria-expanded', 'false');
  };

  const renderCategoryOptions = (filterText = '') => {
    if (!catList) return;
    const q = filterText.trim().toLowerCase();
    const currentId = Number(catHiddenEl?.value || 0);
    const filtered = sortedCategories.filter((c) => !q || c.name.toLowerCase().includes(q));
    if (!filtered.length) {
      catList.innerHTML = `<div class="px-3.5 py-3 text-xs text-slate-500">No matching category.</div>`;
      return;
    }
    catList.innerHTML = filtered
      .map((c) => {
        const selected = Number(c.id) === currentId;
        const isOther = c.name.trim().toLowerCase() === 'other';
        return `
          <button
            type="button"
            role="option"
            aria-selected="${selected}"
            data-cat-id="${c.id}"
            data-cat-name="${esc(c.name)}"
            class="ed-cat-opt w-full px-3.5 py-2.5 text-left text-sm flex items-center justify-between gap-2 transition-colors ${
              selected
                ? 'bg-indigo-50 dark:bg-sky-950/60 text-[#5a1fd8] dark:text-sky-300 font-semibold'
                : 'text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/70'
            } ${isOther ? 'border-t-2 border-slate-200 dark:border-slate-700 font-medium' : ''}"
          >
            <span class="truncate">${esc(c.name)}</span>
            ${selected ? '<span class="text-xs font-bold shrink-0">✓</span>' : ''}
          </button>
        `;
      })
      .join('');

    catList.querySelectorAll('.ed-cat-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cid = btn.dataset.catId || '';
        const cname = btn.dataset.catName || 'Select category...';
        if (catHiddenEl) catHiddenEl.value = cid;
        if (catLabel) catLabel.textContent = cname;
        const isOtherCat = cname.trim().toLowerCase() === 'other';
        catOtherWrap?.classList.toggle('hidden', !isOtherCat);

        // Reset subject if current subject does not belong to newly chosen category
        const matchingSubjs = getSubjectsForCategory(cid);
        const curSubjId = Number(subjHiddenEl?.value || 0);
        const stillValid = matchingSubjs.some((s) => Number(s.id) === curSubjId);
        if (!stillValid) {
          if (isOtherCat && matchingSubjs.length === 1) {
            if (subjHiddenEl) subjHiddenEl.value = String(matchingSubjs[0].id);
            if (subjLabel) subjLabel.textContent = matchingSubjs[0].name;
            subjOtherWrap?.classList.remove('hidden');
          } else {
            if (subjHiddenEl) subjHiddenEl.value = '';
            if (subjLabel) subjLabel.textContent = 'Select subject...';
            subjOtherWrap?.classList.add('hidden');
          }
        }
        renderSubjectOptions(subjSearch?.value || '');
        closeMenus();
      });
    });
  };

  const renderSubjectOptions = (filterText = '') => {
    if (!subjList) return;
    const cid = catHiddenEl?.value || '';
    const q = filterText.trim().toLowerCase();
    const currentSubjId = Number(subjHiddenEl?.value || 0);
    const pool = getSubjectsForCategory(cid);
    const filtered = pool.filter((s) => !q || s.name.toLowerCase().includes(q));
    if (!filtered.length) {
      subjList.innerHTML = `<div class="px-3.5 py-3 text-xs text-slate-500">${cid ? 'No matching subject in this category.' : 'Select a category first or search subjects.'}</div>`;
      return;
    }
    subjList.innerHTML = filtered
      .map((s) => {
        const selected = Number(s.id) === currentSubjId;
        const isOther = s.name.trim().toLowerCase() === 'other';
        return `
          <button
            type="button"
            role="option"
            aria-selected="${selected}"
            data-subj-id="${s.id}"
            data-subj-name="${esc(s.name)}"
            data-subj-cat="${s.categoryId}"
            class="ed-subj-opt w-full px-3.5 py-2.5 text-left text-sm flex items-center justify-between gap-2 transition-colors ${
              selected
                ? 'bg-indigo-50 dark:bg-sky-950/60 text-[#5a1fd8] dark:text-sky-300 font-semibold'
                : 'text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/70'
            } ${isOther ? 'border-t-2 border-slate-200 dark:border-slate-700 font-medium' : ''}"
          >
            <span class="truncate">${esc(s.name)}</span>
            ${selected ? '<span class="text-xs font-bold shrink-0">✓</span>' : ''}
          </button>
        `;
      })
      .join('');

    subjList.querySelectorAll('.ed-subj-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sid = btn.dataset.subjId || '';
        const sname = btn.dataset.subjName || 'Select subject...';
        const scat = btn.dataset.subjCat || '';
        if (subjHiddenEl) subjHiddenEl.value = sid;
        if (subjLabel) subjLabel.textContent = sname;
        subjOtherWrap?.classList.toggle('hidden', sname.trim().toLowerCase() !== 'other');
        // Auto-sync parent category if user picked a subject directly
        if (!catHiddenEl?.value && scat) {
          const parentCat = sortedCategories.find((c) => Number(c.id) === Number(scat));
          if (parentCat) {
            if (catHiddenEl) catHiddenEl.value = String(parentCat.id);
            if (catLabel) catLabel.textContent = parentCat.name;
            catOtherWrap?.classList.toggle('hidden', parentCat.name.trim().toLowerCase() !== 'other');
          }
        }
        closeMenus();
      });
    });
  };

  catTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = catMenu?.classList.contains('hidden');
    closeMenus();
    if (opening) {
      if (catSearch) catSearch.value = '';
      renderCategoryOptions('');
      catMenu?.classList.remove('hidden');
      catTrigger?.setAttribute('aria-expanded', 'true');
      setTimeout(() => catSearch?.focus(), 20);
    }
  });

  subjTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = subjMenu?.classList.contains('hidden');
    closeMenus();
    if (opening) {
      if (subjSearch) subjSearch.value = '';
      renderSubjectOptions('');
      subjMenu?.classList.remove('hidden');
      subjTrigger?.setAttribute('aria-expanded', 'true');
      setTimeout(() => subjSearch?.focus(), 20);
    }
  });

  catSearch?.addEventListener('input', () => renderCategoryOptions(catSearch.value));
  subjSearch?.addEventListener('input', () => renderSubjectOptions(subjSearch.value));
  catMenu?.addEventListener('click', (e) => e.stopPropagation());
  subjMenu?.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', closeMenus);

  // Sync initial Other input visibility in edit mode
  const initialCat = sortedCategories.find((c) => Number(c.id) === Number(catHiddenEl?.value || 0));
  if (initialCat && initialCat.name.trim().toLowerCase() === 'other') {
    catOtherWrap?.classList.remove('hidden');
  }
  const initialSubj = (store.subjects || []).find((s) => Number(s.id) === Number(subjHiddenEl?.value || 0));
  if (initialSubj && initialSubj.name.trim().toLowerCase() === 'other') {
    subjOtherWrap?.classList.remove('hidden');
  }
  renderCategoryOptions('');
  renderSubjectOptions('');

  // Cover preset picker + direct Cover Photo upload
  const coverValEl = document.getElementById('ed-cover-value');
  const coverUrlEl = document.getElementById('ed-cover-url');
  const coverPreviewEl = document.getElementById('ed-cover-preview');
  const coverStatusEl = document.getElementById('ed-cover-status');
  const coverUploadBtn = document.getElementById('ed-cover-upload-btn');
  const coverFileInput = document.getElementById('ed-cover-file-input');

  const setActiveCoverPreset = (url) => {
    container.querySelectorAll('.ed-cover-preset').forEach((b) => {
      const active = b.dataset.cover === url;
      b.classList.toggle('border-[#0F2547]', active);
      b.classList.toggle('dark:border-sky-400', active);
      b.classList.toggle('border-slate-200', !active);
    });
  };

  container.querySelectorAll('.ed-cover-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.cover;
      if (coverValEl) coverValEl.value = url;
      if (coverUrlEl) coverUrlEl.value = url;
      if (coverPreviewEl) coverPreviewEl.src = url;
      if (coverStatusEl) coverStatusEl.textContent = 'Preset cover selected';
      setActiveCoverPreset(url);
    });
  });

  coverUrlEl?.addEventListener('input', () => {
    const typed = coverUrlEl.value.trim();
    if (coverValEl) coverValEl.value = typed;
    if (typed && coverPreviewEl) coverPreviewEl.src = typed;
    if (coverStatusEl) coverStatusEl.textContent = typed ? 'External image URL' : 'No cover URL set';
    setActiveCoverPreset(typed);
  });

  // Rich Text Editor toolbar commands
  container.querySelectorAll('.rte-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('ed-rte')?.focus();
      document.execCommand(btn.dataset.cmd, false, btn.dataset.val || null);
    });
  });

  document.getElementById('rte-insert-code')?.addEventListener('click', () => {
    const rte = document.getElementById('ed-rte');
    rte?.focus();
    document.execCommand('insertHTML', false, '<pre><code>// Formula or code block\n</code></pre><p></p>');
  });

  // Rich Text Editor Inline Photo Upload (button + clipboard paste + drag & drop)
  const rteEl = document.getElementById('ed-rte');
  const rteImageBtn = document.getElementById('rte-upload-image');
  const rteImageInput = document.getElementById('rte-image-file-input');
  let savedRteRange = null;

  const saveRteSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !rteEl) return;
    const range = sel.getRangeAt(0);
    if (rteEl.contains(range.commonAncestorContainer)) {
      savedRteRange = range.cloneRange();
    }
  };

  rteEl?.addEventListener('keyup', saveRteSelection);
  rteEl?.addEventListener('mouseup', saveRteSelection);
  rteEl?.addEventListener('blur', saveRteSelection);

  const optimizeEditorImage = (file) =>
    new Promise((resolve) => {
      // Preserve GIF animations and already-small images untouched
      if (file.type === 'image/gif' || file.size <= 350 * 1024) {
        resolve(file);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1280;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(file);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const targetMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          canvas.toBlob(
            (blob) => {
              if (!blob || blob.size >= file.size) {
                resolve(file);
                return;
              }
              const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
              const ext = targetMime === 'image/png' ? '.png' : '.jpg';
              resolve(new File([blob], `${baseName}${ext}`, { type: targetMime }));
            },
            targetMime,
            0.82
          );
        };
        img.onerror = () => resolve(file);
        img.src = reader.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });

  const insertUploadedImageIntoRte = async (rawFile) => {
    if (!rawFile || !rteEl) return;
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(rawFile.type)) {
      showToast('Please choose a JPG, PNG, WebP, or GIF photo.', 'error');
      return;
    }
    if (rawFile.size > 15 * 1024 * 1024) {
      showToast('Photo is too large. Please select an image under 15 MB.', 'error');
      return;
    }

    const originalBtnHtml = rteImageBtn?.innerHTML;
    if (rteImageBtn) {
      rteImageBtn.disabled = true;
      rteImageBtn.innerHTML = '<span>Uploading...</span>';
    }

    try {
      const preparedFile = await optimizeEditorImage(rawFile);
      if (preparedFile.size > 5 * 1024 * 1024) {
        showToast('Compressed image still exceeds 5 MB. Please use a smaller photo.', 'error');
        return;
      }

      const fd = new FormData();
      fd.append('image', preparedFile);
      const res = await apiFetch('/api/creator/editor-image', { method: 'POST', body: fd });

      const figure = document.createElement('figure');
      figure.className = 'my-4';
      const img = document.createElement('img');
      img.src = res.url;
      img.alt = res.alt || 'Inserted photo';
      img.className = 'w-full max-w-2xl rounded-lg border border-slate-200 dark:border-slate-800';
      figure.appendChild(img);

      const spacer = document.createElement('p');
      spacer.innerHTML = '<br>';

      rteEl.focus();
      const sel = window.getSelection();
      if (savedRteRange && rteEl.contains(savedRteRange.commonAncestorContainer)) {
        sel.removeAllRanges();
        sel.addRange(savedRteRange);
        savedRteRange.deleteContents();
        savedRteRange.insertNode(spacer);
        savedRteRange.insertNode(figure);
        const afterRange = document.createRange();
        afterRange.setStart(spacer, 0);
        afterRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(afterRange);
        savedRteRange = afterRange.cloneRange();
      } else {
        rteEl.appendChild(figure);
        rteEl.appendChild(spacer);
      }

      showToast('Photo inserted into content.', 'success');
    } catch (err) {
      showToast(err.message || 'Could not upload photo.', 'error');
    } finally {
      if (rteImageBtn && originalBtnHtml) {
        rteImageBtn.disabled = false;
        rteImageBtn.innerHTML = originalBtnHtml;
      }
      if (rteImageInput) rteImageInput.value = '';
    }
  };

  rteImageBtn?.addEventListener('click', () => {
    saveRteSelection();
    rteImageInput?.click();
  });

  document.getElementById('rte-bottom-photo-btn')?.addEventListener('click', () => {
    saveRteSelection();
    rteImageInput?.click();
  });

  // Wire Cover Photo direct upload using the same fast image optimizer + server validation
  coverUploadBtn?.addEventListener('click', () => coverFileInput?.click());
  coverFileInput?.addEventListener('change', async (e) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(rawFile.type)) {
      showToast('Please select a JPG, PNG, WebP, or GIF image for the cover.', 'error');
      coverFileInput.value = '';
      return;
    }
    const origHtml = coverUploadBtn?.innerHTML;
    if (coverUploadBtn) {
      coverUploadBtn.disabled = true;
      coverUploadBtn.innerHTML = '<span>Uploading...</span>';
    }
    try {
      const prepared = await optimizeEditorImage(rawFile);
      if (prepared.size > 5 * 1024 * 1024) {
        showToast('Cover photo exceeds 5 MB limit.', 'error');
        return;
      }
      const fd = new FormData();
      fd.append('image', prepared);
      const res = await apiFetch('/api/creator/editor-image', { method: 'POST', body: fd });
      if (coverValEl) coverValEl.value = res.url;
      if (coverUrlEl) {
        coverUrlEl.value = '';
        coverUrlEl.placeholder = `Uploaded: ${rawFile.name} (or paste a URL to replace)`;
      }
      if (coverPreviewEl) coverPreviewEl.src = res.url;
      if (coverStatusEl) coverStatusEl.textContent = `Uploaded cover: ${rawFile.name}`;
      setActiveCoverPreset('');
      showToast('Cover photo uploaded!', 'success');
    } catch (err) {
      showToast(err.message || 'Cover photo upload failed.', 'error');
    } finally {
      if (coverUploadBtn && origHtml) {
        coverUploadBtn.disabled = false;
        coverUploadBtn.innerHTML = origHtml;
      }
      coverFileInput.value = '';
    }
  });

  // Multi-file Gallery & Attachment Queue (up to 20 files per selection; unlimited repeated picks, chunked upload)
  const BATCH_PICK_LIMIT = 20;
  let queuedUploadFiles = [];
  const fileInputEl = document.getElementById('ed-file-input');
  const queueWrapEl = document.getElementById('ed-queued-files-wrap');
  const queueGridEl = document.getElementById('ed-queued-files-grid');
  const uploadQueueBtn = document.getElementById('ed-upload-file-btn');
  const pendingChipEl = document.getElementById('rte-pending-file-chip');

  const renderQueuedFiles = () => {
    const count = queuedUploadFiles.length;
    if (uploadQueueBtn) {
      uploadQueueBtn.classList.toggle('hidden', count === 0);
      uploadQueueBtn.textContent = `Upload ${count} File${count > 1 ? 's' : ''} Now`;
    }
    if (pendingChipEl) {
      pendingChipEl.innerHTML =
        count > 0
          ? `<span class="font-semibold text-emerald-700 dark:text-emerald-400">${count} file${count > 1 ? 's' : ''} attached</span>`
          : 'Add photos, videos, PDFs, or study files';
    }
    if (!queueWrapEl || !queueGridEl) return;
    queueWrapEl.classList.toggle('hidden', count === 0);
    queueGridEl.innerHTML = '';

    queuedUploadFiles.forEach((f, idx) => {
      const card = document.createElement('div');
      card.className =
        'relative rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1120] p-2 flex flex-col gap-1.5 overflow-hidden';
      const isImg = f.type && f.type.startsWith('image/');
      const isVid = f.type && f.type.startsWith('video/');

      if (isImg) {
        const previewUrl = URL.createObjectURL(f);
        card.innerHTML = `
          <div class="aspect-[4/3] rounded overflow-hidden bg-slate-100 dark:bg-slate-900">
            <img src="${previewUrl}" alt="${esc(f.name)}" data-zoom-title="${esc(f.name)}" class="sp-zoom-img cursor-zoom-in w-full h-full object-cover" />
          </div>
          <div class="text-[11px] font-medium truncate text-slate-800 dark:text-slate-200" title="${esc(f.name)}">${esc(f.name)}</div>
          <div class="text-[10px] font-mono text-slate-500">IMAGE · ${formatBytes(f.size)}</div>
        `;
      } else {
        const badgeLabel = isVid ? 'VIDEO' : f.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'FILE';
        const badgeTone = isVid
          ? 'text-purple-700 dark:text-purple-400'
          : 'text-[#0F2547] dark:text-sky-400';
        card.innerHTML = `
          <div class="aspect-[4/3] rounded bg-slate-100 dark:bg-slate-900 flex flex-col items-center justify-center p-2 text-center">
            <span class="text-xs font-mono font-bold ${badgeTone}">${badgeLabel}</span>
            <span class="text-[10px] text-slate-500 mt-1 font-mono">${formatBytes(f.size)}</span>
          </div>
          <div class="text-[11px] font-medium truncate text-slate-800 dark:text-slate-200" title="${esc(f.name)}">${esc(f.name)}</div>
          <div class="text-[10px] font-mono text-slate-500">${badgeLabel}</div>
        `;
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className =
        'absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-slate-900/80 text-white text-xs font-bold flex items-center justify-center hover:bg-red-600 transition-colors';
      removeBtn.setAttribute('aria-label', `Remove ${f.name}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        queuedUploadFiles.splice(idx, 1);
        renderQueuedFiles();
      });
      card.appendChild(removeBtn);
      queueGridEl.appendChild(card);
    });
  };

  const triggerAttachFile = () => {
    fileInputEl?.click();
  };
  document.getElementById('rte-attach-file-top')?.addEventListener('click', triggerAttachFile);
  document.getElementById('rte-bottom-file-btn')?.addEventListener('click', triggerAttachFile);

  document.getElementById('ed-clear-queue-btn')?.addEventListener('click', () => {
    queuedUploadFiles = [];
    if (fileInputEl) fileInputEl.value = '';
    renderQueuedFiles();
  });

  fileInputEl?.addEventListener('change', (e) => {
    const incoming = Array.from(e.target.files || []);
    if (!incoming.length) return;
    const accepted = incoming.slice(0, BATCH_PICK_LIMIT);
    let addedCount = 0;
    let dupCount = 0;
    for (const f of accepted) {
      const isDup = queuedUploadFiles.some(
        (q) => q.name === f.name && q.size === f.size && q.lastModified === f.lastModified
      );
      if (isDup) {
        dupCount += 1;
        continue;
      }
      queuedUploadFiles.push(f);
      addedCount += 1;
    }
    if (dupCount > 0 && addedCount === 0) {
      showToast('Already attached — duplicate file skipped.', 'info');
    } else if (incoming.length > BATCH_PICK_LIMIT) {
      showToast(`Added ${addedCount} files. Click Attach again to add more.`, 'info');
    } else if (addedCount > 0) {
      showToast(
        `${addedCount} file${addedCount > 1 ? 's' : ''} added${dupCount ? ` (${dupCount} duplicate skipped)` : ''}.`,
        'success'
      );
    }
    fileInputEl.value = '';
    renderQueuedFiles();
  });

  rteImageInput?.addEventListener('change', async (e) => {
    const incoming = Array.from(e.target.files || []);
    if (!incoming.length) return;
    const selected = incoming.slice(0, BATCH_PICK_LIMIT);
    const images = selected.filter((f) => f.type && f.type.startsWith('image/'));
    const videos = selected.filter((f) => f.type && f.type.startsWith('video/'));

    if (videos.length > 0) {
      queuedUploadFiles.push(...videos);
      renderQueuedFiles();
    }
    if (images.length > 1) {
      showToast(`Inserting ${images.length} photos into content...`, 'info');
    }
    for (const file of images) {
      await insertUploadedImageIntoRte(file);
    }
    if (images.length > 1 || videos.length > 0) {
      const parts = [];
      if (images.length) parts.push(`${images.length} photo${images.length > 1 ? 's' : ''}`);
      if (videos.length) parts.push(`${videos.length} video${videos.length > 1 ? 's' : ''}`);
      showToast(`Added ${parts.join(' & ')}. Click Photo again to add more.`, 'success');
    }
    if (rteImageInput) rteImageInput.value = '';
  });

  rteEl?.addEventListener('paste', (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imgItem = items.find((it) => it.type && it.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      saveRteSelection();
      const file = imgItem.getAsFile();
      if (file) insertUploadedImageIntoRte(file);
    }
  });

  rteEl?.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      rteEl.classList.add('ring-2', 'ring-sky-400');
    }
  });

  rteEl?.addEventListener('dragleave', () => {
    rteEl.classList.remove('ring-2', 'ring-sky-400');
  });

  rteEl?.addEventListener('drop', async (e) => {
    rteEl.classList.remove('ring-2', 'ring-sky-400');
    const droppedImages = Array.from(e.dataTransfer?.files || [])
      .filter((f) => f.type && f.type.startsWith('image/'))
      .slice(0, BATCH_PICK_LIMIT);
    if (droppedImages.length) {
      e.preventDefault();
      saveRteSelection();
      for (const imgFile of droppedImages) {
        await insertUploadedImageIntoRte(imgFile);
      }
    }
  });

  // Live YouTube / Video Embed Detection & Preview
  const videoUrlInput = document.getElementById('ed-video-url');
  const videoPreviewWrap = document.getElementById('ed-video-preview-wrap');
  const videoPreviewStatus = document.getElementById('ed-video-preview-status');
  const videoPreviewFrame = document.getElementById('ed-video-preview-frame');
  const videoPreviewExt = document.getElementById('ed-video-preview-ext');
  const updateVideoPreview = () => {
    const raw = videoUrlInput?.value.trim() || '';
    if (!raw) {
      if (videoPreviewWrap) videoPreviewWrap.classList.add('hidden');
      if (videoPreviewFrame) videoPreviewFrame.src = '';
      return;
    }
    const resolved = resolveVideoEmbed(raw);
    if (!resolved) {
      if (videoPreviewWrap) videoPreviewWrap.classList.remove('hidden');
      if (videoPreviewStatus) {
        videoPreviewStatus.textContent = 'Invalid link — paste a full YouTube share link (https://youtu.be/... or youtube.com/watch?v=...)';
        videoPreviewStatus.className = 'font-semibold text-amber-700 dark:text-amber-400';
      }
      if (videoPreviewFrame) {
        videoPreviewFrame.src = '';
        videoPreviewFrame.parentElement?.classList.add('hidden');
      }
      if (videoPreviewExt) videoPreviewExt.classList.add('hidden');
      return;
    }
    if (videoPreviewWrap) videoPreviewWrap.classList.remove('hidden');
    if (videoPreviewStatus) {
      videoPreviewStatus.textContent = `${resolved.provider} lecture detected — ready to play on publication page`;
      videoPreviewStatus.className = 'font-semibold text-emerald-700 dark:text-emerald-400';
    }
    if (videoPreviewFrame) {
      videoPreviewFrame.parentElement?.classList.remove('hidden');
      if (videoPreviewFrame.src !== resolved.embedUrl) {
        videoPreviewFrame.src = resolved.embedUrl;
      }
    }
    if (videoPreviewExt) {
      videoPreviewExt.href = resolved.watchUrl;
      videoPreviewExt.classList.remove('hidden');
    }
  };
  videoUrlInput?.addEventListener('input', updateVideoPreview);
  videoUrlInput?.addEventListener('paste', () => setTimeout(updateVideoPreview, 0));
  updateVideoPreview();

  // Live Preview Modal
  document.getElementById('ed-preview-btn')?.addEventListener('click', () => {
    const title = document.getElementById('ed-title')?.value || 'Untitled Publication';
    const authorName = document.getElementById('ed-author-name')?.value.trim() || store.user?.name || 'Author';
    const publisherName = document.getElementById('ed-publisher-name')?.value.trim() || '';
    const desc = document.getElementById('ed-desc')?.value || '';
    const html = document.getElementById('ed-rte')?.innerHTML || '';
    const ctype = document.getElementById('ed-type')?.value || '';
    const lang = document.getElementById('ed-language')?.value || 'English';
    const price = isFree ? 'Free' : formatInr(document.getElementById('ed-price')?.value || 0);
    const resolvedVideo = resolveVideoEmbed(document.getElementById('ed-video-url')?.value.trim() || '');
    openModal({
      title: 'Publication Preview',
      widthClass: 'max-w-3xl',
      bodyHtml: `
        <div class="space-y-4">
          <div class="text-xs text-slate-500">${esc(ctype)} · ${esc(lang)} · <strong class="font-mono text-slate-900 dark:text-white">${esc(price)}</strong></div>
          <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">${esc(title)}</h2>
          <div class="text-xs text-slate-600 dark:text-slate-300">
            By <strong class="text-slate-900 dark:text-white">${esc(authorName)}</strong>${publisherName ? ` · Published by <strong>${esc(publisherName)}</strong>` : ''}
          </div>
          <p class="text-sm text-slate-600 dark:text-slate-300">${esc(desc)}</p>
          ${
            resolvedVideo
              ? `<div class="aspect-video w-full rounded-lg overflow-hidden bg-black">
                   <iframe src="${esc(resolvedVideo.embedUrl)}" title="${esc(title)}" class="w-full h-full border-0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
                 </div>`
              : ''
          }
          <hr class="border-slate-200 dark:border-slate-800" />
          <div class="reading-prose">${html || '<p class="text-slate-400">No body text entered yet.</p>'}</div>
        </div>
      `,
    });
  });

  // Resilient uploader with real-time % progress bar, SHA-256 deduplication, direct-to-S3/R2 presigned URLs,
  // and 2 MB resumable chunking + auto-retry for large files.
  const uploadAttachedFilesBatch = async (contentId) => {
    if (!queuedUploadFiles.length) return null;

    let progressBox = document.getElementById('ed-upload-progress-box');
    if (!progressBox && queueWrapEl) {
      progressBox = document.createElement('div');
      progressBox.id = 'ed-upload-progress-box';
      progressBox.className =
        'mt-3 p-3 rounded-lg border border-indigo-200 dark:border-slate-700 bg-indigo-50/60 dark:bg-slate-900/70 space-y-1.5 text-xs';
      queueWrapEl.appendChild(progressBox);
    }

    const total = queuedUploadFiles.length;
    let uploadedCount = 0;
    let duplicateCount = 0;

    for (let i = 0; i < total; i += 1) {
      const file = queuedUploadFiles[i];
      const updateBar = (pct) => {
        if (!progressBox) return;
        const overall = Math.round(((i + pct / 100) / total) * 100);
        progressBox.innerHTML = `
          <div class="flex items-center justify-between gap-2 font-medium text-slate-800 dark:text-slate-200">
            <span class="truncate">Uploading ${i + 1}/${total}: ${esc(file.name)}</span>
            <span class="font-mono tabular-nums shrink-0">${overall}%</span>
          </div>
          <div class="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div class="h-full bg-[#5a1fd8] dark:bg-sky-400 transition-all duration-150" style="width:${overall}%"></div>
          </div>
        `;
      };
      updateBar(2);
      const res = await uploadFileResilient({
        contentId,
        file,
        isPreview: false,
        onProgress: updateBar,
      });
      if (res?.duplicate) duplicateCount += 1;
      uploadedCount += 1;
    }

    if (progressBox) progressBox.remove();
    queuedUploadFiles = [];
    renderQueuedFiles();
    return {
      count: uploadedCount,
      message: `${uploadedCount} file${uploadedCount === 1 ? '' : 's'} uploaded${
        duplicateCount ? ` (${duplicateCount} existing reused)` : ''
      }.`,
    };
  };

  document.getElementById('ed-upload-file-btn')?.addEventListener('click', async () => {
    if (!editingId || !queuedUploadFiles.length) return;
    const btn = document.getElementById('ed-upload-file-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = `Uploading ${queuedUploadFiles.length} file(s)...`;
    }
    try {
      const res = await uploadAttachedFilesBatch(editingId);
      showToast(res?.message || 'Files uploaded securely.', 'success');
      renderCreatorDashboardPage(container, 'upload', editingId);
    } catch (err) {
      showToast(err.message, 'error');
      if (btn) {
        btn.disabled = false;
        renderQueuedFiles();
      }
    }
  });

  container.querySelectorAll('.ed-del-file').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/api/creator/files/${btn.dataset.fileId}`, { method: 'DELETE' });
        showToast('File removed.', 'success');
        renderCreatorDashboardPage(container, 'upload', editingId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  const saveContent = async (action) => {
    const payload = {
      title: document.getElementById('ed-title')?.value.trim(),
      authorName: document.getElementById('ed-author-name')?.value.trim() || '',
      publisherName: document.getElementById('ed-publisher-name')?.value.trim() || '',
      shortDescription: document.getElementById('ed-desc')?.value.trim(),
      bodyHtml: document.getElementById('ed-rte')?.innerHTML || '',
      previewHtml: document.getElementById('ed-preview-html')?.value || '',
      coverImageUrl:
        (document.getElementById('ed-cover-url')?.value.trim() ||
          document.getElementById('ed-cover-value')?.value.trim() ||
          ''),
      categoryId: document.getElementById('ed-category')?.value || null,
      subjectId: document.getElementById('ed-subject')?.value || null,
      language: document.getElementById('ed-language')?.value || 'English',
      contentType: document.getElementById('ed-type')?.value || 'Notes',
      classLevel: document.getElementById('ed-class-level')?.value.trim() || null,
      studyLabel: document.getElementById('ed-study-label')?.value.trim() || null,
      chapter: document.getElementById('ed-chapter')?.value.trim() || null,
      chapterOrder: (() => {
        const raw = document.getElementById('ed-chapter-order')?.value.trim();
        const n = Number(raw);
        return raw && Number.isInteger(n) && n > 0 ? n : null;
      })(),
      topic: document.getElementById('ed-topic')?.value.trim() || null,
      durationSeconds: (() => {
        const raw = document.getElementById('ed-duration-mins')?.value.trim();
        const m = Number(raw);
        return raw && Number.isFinite(m) && m > 0 ? Math.round(m * 60) : null;
      })(),
      isFree,
      priceInr: isFree ? 0 : Number(document.getElementById('ed-price')?.value || 0),
      tags: [
        document.getElementById('ed-tags')?.value || '',
        document.getElementById('ed-category-other-text')?.value.trim() || '',
        document.getElementById('ed-subject-other-text')?.value.trim() || '',
      ]
        .filter(Boolean)
        .join(', '),
      externalVideoUrl: document.getElementById('ed-video-url')?.value.trim() || '',
      ownershipConfirmed: Boolean(document.getElementById('ed-ownership')?.checked),
      action,
    };

    const draftBtn = document.getElementById('ed-save-draft');
    const pubBtn = document.getElementById('ed-submit-publish');
    const origDraftLabel = draftBtn?.textContent || 'Save as Draft';
    const origPubLabel = pubBtn?.textContent || 'Save Changes';
    if (draftBtn?.dataset.saving === '1' || pubBtn?.dataset.saving === '1') return;

    if (draftBtn) {
      draftBtn.disabled = true;
      draftBtn.dataset.saving = '1';
    }
    if (pubBtn) {
      pubBtn.disabled = true;
      pubBtn.dataset.saving = '1';
    }
    const activeBtn = action === 'draft' ? draftBtn : pubBtn;
    if (activeBtn) {
      activeBtn.textContent = queuedUploadFiles.length
        ? `Saving & Uploading ${queuedUploadFiles.length} file(s)...`
        : 'Saving...';
    }

    try {
      let saved;
      if (editingId) {
        saved = await apiFetch(`/api/creator/contents/${editingId}`, { method: 'PUT', body: payload });
      } else {
        saved = await apiFetch('/api/creator/contents', { method: 'POST', body: payload });
      }
      const cid = saved.content.id;
      if (queuedUploadFiles.length > 0) {
        await uploadAttachedFilesBatch(cid);
      }
      showToast(saved.message, 'success');
      const fromPublished = window.location.hash.includes('from=published');
      const fromDrafts = window.location.hash.includes('from=drafts');
      const fromPending = window.location.hash.includes('from=pending');
      if (action === 'draft' || saved?.content?.status === 'draft') {
        window.location.hash = '#/creator/drafts';
      } else if ((fromPublished || editPayload?.content?.status === 'approved') && saved?.content?.status === 'approved') {
        window.location.hash = `#/creator/published/${cid}`;
      } else if (action === 'resubmit' || (fromPending && saved?.content?.status === 'pending')) {
        window.location.hash = `#/creator/pending/${cid}`;
      } else if (saved?.content?.status === 'pending') {
        window.location.hash = '#/creator/pending';
      } else {
        window.location.hash = fromPending
          ? '#/creator/pending'
          : fromPublished
          ? '#/creator/published'
          : fromDrafts
          ? '#/creator/drafts'
          : '#/creator/overview';
      }
    } catch (err) {
      showToast(err.message, 'error');
      if (draftBtn) {
        draftBtn.disabled = false;
        draftBtn.dataset.saving = '';
        draftBtn.textContent = origDraftLabel;
      }
      if (pubBtn) {
        pubBtn.disabled = false;
        pubBtn.dataset.saving = '';
        pubBtn.textContent = origPubLabel;
      }
    }
  };

  const editingStatus = editPayload?.content?.status || null;
  document.getElementById('ed-save-draft')?.addEventListener('click', () => saveContent('draft'));
  document.getElementById('ed-submit-publish')?.addEventListener('click', () =>
    saveContent(
      editingStatus === 'changes_requested'
        ? 'resubmit'
        : editingStatus === 'approved'
        ? 'update'
        : 'submit'
    )
  );
}
