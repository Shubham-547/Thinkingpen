import {
  apiFetch,
  esc,
  formatDate,
  formatDateTime,
  formatInr,
  formatRelativeAge,
  getResponsiveImageSources,
  openModal,
  renderStatusLabel,
  showToast,
  store,
} from './api.js';

export const historyPageState = {
  activeSubTab: 'submissions', // 'submissions' | 'activity' | 'trash'
  q: '',
  submissionStatus: 'all',
  dateRange: 'all', // 'all' | 'today' | '7d' | '30d' | '90d' | 'year' | 'custom'
  startDate: '',
  endDate: '',
  subPage: 1,
  actPage: 1,
  limit: 15,
};

export function buildHistoryUrl() {
  const qs = new URLSearchParams();
  if (historyPageState.q.trim()) qs.set('q', historyPageState.q.trim());
  if (historyPageState.submissionStatus !== 'all') qs.set('submissionStatus', historyPageState.submissionStatus);
  if (historyPageState.dateRange !== 'all') qs.set('dateRange', historyPageState.dateRange);
  if (historyPageState.dateRange === 'custom') {
    if (historyPageState.startDate) qs.set('startDate', historyPageState.startDate);
    if (historyPageState.endDate) qs.set('endDate', historyPageState.endDate);
  }
  qs.set('subPage', String(historyPageState.subPage || 1));
  qs.set('actPage', String(historyPageState.actPage || 1));
  qs.set('limit', String(historyPageState.limit || 15));
  return `/api/creator/history?${qs.toString()}`;
}

function formatRecoveryCountdown(purgeAfterIso) {
  if (!purgeAfterIso) return '15 days remaining';
  const diffMs = new Date(purgeAfterIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Expiring soon';
  const totalHours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hrs = totalHours % 24;
  return days > 0 ? `${days}d ${hrs}h left to recover` : `${Math.max(1, hrs)}h left to recover`;
}

function getTitleInitials(title) {
  const words = String(title || 'SP').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'SP';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function renderThumbHtml(url, title) {
  const initials = getTitleInitials(title);
  if (!url) {
    return `<div class="w-16 h-14 sm:w-20 sm:h-16 rounded-xl bg-gradient-to-br from-[#0F2547] via-[#1B3B6F] to-[#3B267D] text-white flex items-center justify-center font-display text-xs sm:text-sm font-semibold shrink-0 select-none">${esc(initials)}</div>`;
  }
  const sources = getResponsiveImageSources(url, 240);
  const src = sources?.fallbackSrc || url;
  return `
    <div class="w-16 h-14 sm:w-20 sm:h-16 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/70 shrink-0 relative">
      <img src="${esc(src)}" alt="${esc(title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
      <div style="display:none" class="absolute inset-0 bg-gradient-to-br from-[#0F2547] via-[#1B3B6F] to-[#3B267D] text-white items-center justify-center font-display text-xs font-semibold">${esc(initials)}</div>
    </div>
  `;
}

function getSubmissionStatusBadge(status, displayStatus) {
  const effective = displayStatus || status;
  const map = {
    approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
    changes_requested: { label: 'Changes Requested', cls: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' },
    resubmitted: { label: 'Resubmitted', cls: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300' },
    under_review: { label: 'Under Review', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' },
    pending: { label: 'Under Review', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' },
    rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300' },
    removed: { label: 'Removed', cls: 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300' },
  };
  return map[effective] || map[status] || { label: String(effective || 'Submitted').replace(/_/g, ' '), cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };
}

function renderPaginationControlsHtml(pagination, kind) {
  const { page = 1, totalPages = 1, total = 0, limit = 15 } = pagination || {};
  if (total === 0) return '';
  const start = (page - 1) * limit + 1;
  const end = Math.min(total, page * limit);
  const pages = [];
  for (let p = 1; p <= totalPages; p += 1) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== '...') pages.push('...');
  }

  return `
    <div class="flex flex-wrap items-center justify-between gap-3 pt-3">
      <div class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
        Showing <strong class="text-slate-700 dark:text-slate-200">${start}–${end}</strong> of <strong class="text-slate-700 dark:text-slate-200">${total}</strong>
      </div>
      ${
        totalPages > 1
          ? `<div class="flex items-center gap-1.5">
              <button type="button" data-kind="${kind}" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} class="hist-page-btn min-w-[36px] min-h-[36px] px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40">← Prev</button>
              ${pages
                .map((p) =>
                  p === '...'
                    ? `<span class="px-1 text-xs text-slate-400">…</span>`
                    : `<button type="button" data-kind="${kind}" data-page="${p}" class="hist-page-btn min-w-[36px] min-h-[36px] px-2.5 rounded-xl text-xs font-semibold tabular-nums ${
                        p === page
                          ? 'bg-[#5a1fd8] text-white'
                          : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }">${p}</button>`
                )
                .join('')}
              <button type="button" data-kind="${kind}" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''} class="hist-page-btn min-w-[36px] min-h-[36px] px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40">Next →</button>
            </div>`
          : ''
      }
    </div>
  `;
}

function renderSubmissionsTabHtml(payload) {
  const subBlock = payload?.submissionHistory || { items: [], pagination: { page: 1, limit: 15, total: 0, totalPages: 1 } };
  const items = Array.isArray(subBlock.items) ? subBlock.items : [];
  const hasFilters = Boolean(historyPageState.q.trim() || historyPageState.submissionStatus !== 'all' || historyPageState.dateRange !== 'all');

  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2.5 bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5">
        <div class="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
          <span>Submission Status</span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label for="hist-sub-status" class="sr-only">Filter by submission status</label>
          <select id="hist-sub-status" class="min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100">
            <option value="all" ${historyPageState.submissionStatus === 'all' ? 'selected' : ''}>All Statuses</option>
            <option value="submitted" ${historyPageState.submissionStatus === 'submitted' ? 'selected' : ''}>Submitted</option>
            <option value="under_review" ${historyPageState.submissionStatus === 'under_review' ? 'selected' : ''}>Under Review</option>
            <option value="changes_requested" ${historyPageState.submissionStatus === 'changes_requested' ? 'selected' : ''}>Changes Requested</option>
            <option value="resubmitted" ${historyPageState.submissionStatus === 'resubmitted' ? 'selected' : ''}>Resubmitted</option>
            <option value="approved" ${historyPageState.submissionStatus === 'approved' ? 'selected' : ''}>Approved</option>
            <option value="rejected" ${historyPageState.submissionStatus === 'rejected' ? 'selected' : ''}>Rejected</option>
          </select>
        </div>
      </div>

      ${
        items.length
          ? `<div class="space-y-3">
              ${items
                .map((s) => {
                  const badge = getSubmissionStatusBadge(s.status, s.displayStatus);
                  const priorReviews = Array.isArray(s.reviewEvents) ? s.reviewEvents.filter((rv) => rv.feedback) : [];
                  const feedbackLine = s.latestFeedback || priorReviews[0]?.feedback || null;
                  return `
                    <article class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div class="flex items-start gap-3.5 min-w-0 flex-1">
                        <a href="#/creator/pending/${s.id}" class="shrink-0 block">
                          ${renderThumbHtml(s.coverImageUrl, s.title)}
                        </a>
                        <div class="min-w-0 flex-1 space-y-1.5">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${badge.cls}">${esc(badge.label)}</span>
                            ${
                              Number(s.resubmissionCount || 0) > 0
                                ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">Resubmitted ${s.resubmissionCount}x</span>`
                                : ''
                            }
                            <span class="text-[11px] font-mono ${s.isFree ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}">${s.isFree ? 'Free' : formatInr(s.priceInr)}</span>
                          </div>
                          <a href="#/creator/pending/${s.id}" class="block font-display text-base font-semibold text-slate-900 dark:text-white hover:text-[#5a1fd8] dark:hover:text-sky-300 leading-snug truncate">
                            ${esc(s.title)}
                          </a>
                          <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                            <span>${esc(s.contentType)}${s.subjectName ? ` · ${esc(s.subjectName)}` : s.categoryName ? ` · ${esc(s.categoryName)}` : ''}</span>
                            <span>Submitted: <strong class="text-slate-700 dark:text-slate-200">${esc(formatDate(s.submittedAt || s.lastActivityAt))}</strong></span>
                            <span>Reviewed: <strong class="text-slate-700 dark:text-slate-200">${s.lastReviewedAt ? esc(formatDate(s.lastReviewedAt)) : 'Pending'}</strong></span>
                          </div>
                          ${
                            feedbackLine
                              ? `<p class="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 pt-0.5"><span class="font-semibold">Feedback:</span> ${esc(feedbackLine)}</p>`
                              : ''
                          }
                        </div>
                      </div>

                      <div class="flex sm:flex-col items-center sm:items-end justify-end gap-2 shrink-0">
                        <a href="#/creator/pending/${s.id}" class="min-h-[38px] inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap">
                          <span>View Details</span>
                          <span aria-hidden="true">→</span>
                        </a>
                        ${
                          s.status === 'changes_requested'
                            ? `<a href="#/creator/edit/${s.id}?from=pending" class="min-h-[38px] inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-xl bg-[#5a1fd8] hover:bg-[#4c1d95] text-white whitespace-nowrap">Edit &amp; Resubmit</a>`
                            : ''
                        }
                      </div>
                    </article>
                  `;
                })
                .join('')}
            </div>`
          : `<div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-8 sm:p-12 text-center space-y-2.5">
              <div class="font-display text-lg font-semibold text-slate-900 dark:text-white">${hasFilters ? 'No matching submissions' : 'No Submission History Yet'}</div>
              <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                ${hasFilters ? 'Adjust your search query or filters to view matching submission records.' : 'When you submit content for review or publication, your full submission and moderation record will appear here.'}
              </p>
              ${hasFilters ? `<button type="button" class="hist-clear-btn mt-2 px-4 py-2 text-xs font-semibold rounded-xl bg-[#5a1fd8] text-white">Reset Filters</button>` : ''}
            </div>`
      }

      ${renderPaginationControlsHtml(subBlock.pagination, 'sub')}
    </div>
  `;
}

function renderActivityTabHtml(payload) {
  const actBlock = payload?.activityHistory || { items: [], pagination: { page: 1, limit: 15, total: 0, totalPages: 1 } };
  const items = Array.isArray(actBlock.items) ? actBlock.items : [];
  const hasFilters = Boolean(historyPageState.q.trim() || historyPageState.dateRange !== 'all');

  const actionMeta = {
    created: { label: 'Created', cls: 'text-sky-700 dark:text-sky-400' },
    updated: { label: 'Updated', cls: 'text-slate-700 dark:text-slate-300' },
    published: { label: 'Published', cls: 'text-emerald-700 dark:text-emerald-400' },
    submitted_for_review: { label: 'Submitted for Review', cls: 'text-violet-700 dark:text-violet-400' },
    resubmitted: { label: 'Resubmitted for Review', cls: 'text-indigo-700 dark:text-indigo-400' },
    under_review: { label: 'Under Review', cls: 'text-amber-700 dark:text-amber-400' },
    approved: { label: 'Approved', cls: 'text-emerald-700 dark:text-emerald-400' },
    changes_requested: { label: 'Changes Requested', cls: 'text-rose-700 dark:text-rose-400' },
    rejected: { label: 'Rejected', cls: 'text-red-700 dark:text-red-400' },
    removed: { label: 'Removed', cls: 'text-red-700 dark:text-red-400' },
    duplicated: { label: 'Duplicated to Draft', cls: 'text-indigo-700 dark:text-indigo-400' },
    moved_to_draft: { label: 'Moved to Draft', cls: 'text-amber-700 dark:text-amber-400' },
    deleted: { label: 'Moved to Trash (15d)', cls: 'text-amber-700 dark:text-amber-400' },
    recovered: { label: 'Restored from Trash', cls: 'text-emerald-700 dark:text-emerald-400' },
    permanently_deleted: { label: 'Permanently Deleted', cls: 'text-red-700 dark:text-red-400' },
    auto_purged: { label: 'Auto-Purged (15d)', cls: 'text-red-700 dark:text-red-400' },
  };

  return `
    <div class="space-y-4">
      ${
        items.length
          ? `<div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-x-auto touch-scroll-x">
              <table class="w-full min-w-[680px] text-left text-xs">
                <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
                  <tr>
                    <th class="px-4 py-3 font-semibold">Event</th>
                    <th class="px-4 py-3 font-semibold">Publication</th>
                    <th class="px-4 py-3 font-semibold">Date, Time &amp; Age</th>
                    <th class="px-4 py-3 font-semibold text-right">Details</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                  ${items
                    .map((h) => {
                      const meta = actionMeta[h.action] || {
                        label: String(h.action || '').replace(/_/g, ' '),
                        cls: 'text-slate-600 dark:text-slate-300',
                      };
                      return `
                        <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                          <td class="px-4 py-3 font-semibold ${meta.cls} whitespace-nowrap capitalize">${esc(meta.label)}</td>
                          <td class="px-4 py-3">
                            <div class="font-medium text-slate-900 dark:text-white">${esc(h.contentTitle)}</div>
                            <div class="text-[11px] text-slate-500">${esc(h.contentType || 'Publication')}${h.authorName ? ` · Author: ${esc(h.authorName)}` : ''}</div>
                          </td>
                          <td class="px-4 py-3 whitespace-nowrap">
                            <div class="font-medium text-slate-800 dark:text-slate-200">${esc(formatRelativeAge(h.createdAt))}</div>
                            <div class="text-[11px] font-mono text-slate-500">${esc(formatDateTime(h.createdAt))}</div>
                          </td>
                          <td class="px-4 py-3 text-right whitespace-nowrap">
                            <button type="button" data-hist-id="${h.id}" class="cr-hist-detail font-semibold text-[#5a1fd8] dark:text-sky-400 hover:underline">Details</button>
                          </td>
                        </tr>
                      `;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>`
          : `<div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-8 sm:p-12 text-center space-y-2.5">
              <div class="font-display text-lg font-semibold text-slate-900 dark:text-white">${hasFilters ? 'No matching activities' : 'No Activity Recorded Yet'}</div>
              <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                ${hasFilters ? 'Try another search query or expand your date filter.' : 'Your content uploads, edits, moderation updates, and recoveries will appear chronologically here.'}
              </p>
              ${hasFilters ? `<button type="button" class="hist-clear-btn mt-2 px-4 py-2 text-xs font-semibold rounded-xl bg-[#5a1fd8] text-white">Reset Filters</button>` : ''}
            </div>`
      }

      ${renderPaginationControlsHtml(actBlock.pagination, 'act')}
    </div>
  `;
}

function renderTrashTabHtml(payload) {
  const deletedList = Array.isArray(payload?.deletedContents) ? payload.deletedContents : [];
  const retentionDays = Number(payload?.retentionDays || 15);
  const hasFilters = Boolean(historyPageState.q.trim() || historyPageState.dateRange !== 'all');

  return `
    <div class="space-y-4">
      <div class="p-3.5 sm:p-4 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/25 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
        <span>Deleted content stays in Trash for <strong>${retentionDays} days</strong> and restores back to its original status (never auto-published from draft).</span>
        <span class="font-mono font-semibold">${deletedList.length} recoverable item${deletedList.length === 1 ? '' : 's'}</span>
      </div>

      ${
        deletedList.length
          ? `<div class="space-y-3">
              ${deletedList
                .map((item) => {
                  const prevLabel =
                    item.previousStatus === 'approved'
                      ? 'Published'
                      : item.previousStatus === 'changes_requested'
                      ? 'Changes Requested'
                      : item.previousStatus === 'pending'
                      ? 'Under Review'
                      : item.previousStatus || 'Draft';
                  return `
                    <article class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div class="flex items-start gap-3.5 min-w-0 flex-1">
                        ${renderThumbHtml(item.coverImageUrl, item.title)}
                        <div class="min-w-0 flex-1 space-y-1.5">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                              ${esc(formatRecoveryCountdown(item.purgeAfter))}
                            </span>
                            <span class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              Previous status: <strong class="capitalize text-slate-700 dark:text-slate-200">${esc(prevLabel)}</strong>
                            </span>
                          </div>
                          <div class="font-display text-base font-semibold text-slate-900 dark:text-white truncate">${esc(item.title)}</div>
                          <div class="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                            <span>${esc(item.contentType)}</span>
                            ${item.subjectName || item.categoryName ? `<span>· ${esc(item.subjectName || item.categoryName)}</span>` : ''}
                            <span>· ${item.isFree ? 'Free' : formatInr(item.priceInr)}</span>
                            <span>· Deleted ${esc(formatRelativeAge(item.deletedAt))}</span>
                          </div>
                        </div>
                      </div>

                      <div class="flex flex-wrap items-center justify-end gap-2 shrink-0">
                        <button type="button" data-del-detail-id="${item.id}" class="cr-deleted-detail min-h-[38px] px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">Details</button>
                        <button type="button" data-recover-id="${item.id}" class="cr-recover-btn min-h-[38px] px-3.5 py-2 text-xs font-semibold rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white">Restore</button>
                        <button type="button" data-perm-del-id="${item.id}" class="cr-perm-delete-btn min-h-[38px] px-3 py-2 text-xs font-semibold rounded-xl border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30">Permanent Delete</button>
                      </div>
                    </article>
                  `;
                })
                .join('')}
            </div>`
          : `<div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-8 sm:p-12 text-center space-y-2.5">
              <div class="font-display text-lg font-semibold text-slate-900 dark:text-white">${hasFilters ? 'No matching items in Trash' : 'Trash is Empty'}</div>
              <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                ${hasFilters ? 'No deleted items match your search or date filter.' : 'Any deleted content is safely kept here for 15 days so you can restore it whenever needed.'}
              </p>
              ${hasFilters ? `<button type="button" class="hist-clear-btn mt-2 px-4 py-2 text-xs font-semibold rounded-xl bg-[#5a1fd8] text-white">Reset Filters</button>` : ''}
            </div>`
      }
    </div>
  `;
}

export function renderHistoryDynamicRegionHtml(payload) {
  const s = payload?.summary || {
    totalActivities: 0,
    totalSubmissions: 0,
    underReviewCount: 0,
    changesRequestedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    trashCount: 0,
  };

  const tabItems = [
    { key: 'submissions', label: 'Submission History', count: payload?.submissionHistory?.pagination?.total ?? s.totalSubmissions },
    { key: 'activity', label: 'Activity History', count: payload?.activityHistory?.pagination?.total ?? s.totalActivities },
    { key: 'trash', label: 'Recovery / Trash', count: payload?.deletedContents?.length ?? s.trashCount },
  ];

  let activeContentHtml = '';
  if (historyPageState.activeSubTab === 'activity') {
    activeContentHtml = renderActivityTabHtml(payload);
  } else if (historyPageState.activeSubTab === 'trash') {
    activeContentHtml = renderTrashTabHtml(payload);
  } else {
    activeContentHtml = renderSubmissionsTabHtml(payload);
  }

  return `
    <div class="space-y-4">
      <!-- Navigation Tabs -->
      <div class="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5" role="tablist" aria-label="History sections">
        ${tabItems
          .map((t) => {
            const active = historyPageState.activeSubTab === t.key;
            return `
              <button
                type="button"
                role="tab"
                aria-selected="${active ? 'true' : 'false'}"
                data-subtab="${t.key}"
                class="hist-subtab-btn min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums border ${
                  active
                    ? 'bg-[#5a1fd8] border-[#5a1fd8] text-white'
                    : 'bg-white dark:bg-[#111A2E] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                }"
              >
                <span>${esc(t.label)}</span>
                <span class="px-1.5 py-0.5 rounded-full text-[11px] ${
                  active ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }">${Number(t.count || 0)}</span>
              </button>
            `;
          })
          .join('')}
      </div>

      ${activeContentHtml}
    </div>
  `;
}

export function renderCreatorHistoryHtml(payload) {
  const s = payload?.summary || {
    totalActivities: 0,
    totalSubmissions: 0,
    underReviewCount: 0,
    changesRequestedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    trashCount: 0,
  };

  const summaryCards = [
    { label: 'Total Activities', value: Number(s.totalActivities || 0), cls: 'text-slate-900 dark:text-white' },
    { label: 'Total Submissions', value: Number(s.totalSubmissions || 0), cls: 'text-[#5a1fd8] dark:text-violet-300' },
    { label: 'Approved Content', value: Number(s.approvedCount || 0), cls: 'text-emerald-700 dark:text-emerald-400' },
    { label: 'Changes Requested', value: Number(s.changesRequestedCount || 0), cls: 'text-rose-700 dark:text-rose-400' },
    { label: 'Rejected Content', value: Number(s.rejectedCount || 0), cls: 'text-red-700 dark:text-red-400' },
    { label: 'Items in Trash', value: Number(s.trashCount || 0), cls: 'text-amber-700 dark:text-amber-400' },
  ];

  return `
    <div id="hist-page-root" class="space-y-5">
      <!-- Page Header -->
      <div class="flex flex-wrap items-start sm:items-center justify-between gap-3">
        <div>
          <h1 class="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white">History &amp; Recovery</h1>
          <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Track your content activity, review previous submissions, and recover deleted content.
          </p>
        </div>
        <a href="#/creator/pending" class="min-h-[40px] inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
          Pending &amp; Review →
        </a>
      </div>

      <!-- Summary Cards -->
      <section aria-label="History summary" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        ${summaryCards
          .map(
            (card) => `
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 sm:p-4">
            <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">${esc(card.label)}</div>
            <div class="font-mono text-xl sm:text-2xl font-bold mt-1 tabular-nums ${card.cls}">${card.value}</div>
          </div>
        `
          )
          .join('')}
      </section>

      <!-- Persistent Search + Date Range Bar -->
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 space-y-3">
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div class="relative flex-1 flex items-center">
            <svg class="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35"/></svg>
            <input
              type="search"
              id="hist-search-input"
              value="${esc(historyPageState.q)}"
              placeholder="Search content..."
              autocomplete="off"
              class="w-full min-h-[42px] pl-10 pr-9 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#5a1fd8] dark:focus:border-sky-400"
            />
            <button
              type="button"
              id="hist-search-clear"
              aria-label="Clear search"
              class="${historyPageState.q ? 'flex' : 'hidden'} absolute right-2 w-7 h-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <div class="flex items-center gap-2">
            <label for="hist-date-range" class="sr-only">Filter by date range</label>
            <select id="hist-date-range" class="min-h-[42px] px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100">
              <option value="all" ${historyPageState.dateRange === 'all' ? 'selected' : ''}>All Time</option>
              <option value="today" ${historyPageState.dateRange === 'today' ? 'selected' : ''}>Today</option>
              <option value="7d" ${historyPageState.dateRange === '7d' ? 'selected' : ''}>Last 7 Days</option>
              <option value="30d" ${historyPageState.dateRange === '30d' ? 'selected' : ''}>Last 30 Days</option>
              <option value="90d" ${historyPageState.dateRange === '90d' ? 'selected' : ''}>Last 90 Days</option>
              <option value="year" ${historyPageState.dateRange === 'year' ? 'selected' : ''}>This Year</option>
              <option value="custom" ${historyPageState.dateRange === 'custom' ? 'selected' : ''}>Custom Range</option>
            </select>
            <button type="button" id="hist-reset-all" class="min-h-[42px] px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
              Clear
            </button>
          </div>
        </div>

        <div id="hist-custom-dates" class="${historyPageState.dateRange === 'custom' ? 'flex' : 'hidden'} flex-wrap items-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            <label for="hist-start-date" class="block text-[11px] font-medium text-slate-500 mb-1">Start Date</label>
            <input type="date" id="hist-start-date" value="${esc(historyPageState.startDate)}" class="px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
          </div>
          <div>
            <label for="hist-end-date" class="block text-[11px] font-medium text-slate-500 mb-1">End Date</label>
            <input type="date" id="hist-end-date" value="${esc(historyPageState.endDate)}" class="px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
          </div>
          <button type="button" id="hist-apply-dates" class="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#5a1fd8] text-white">Apply</button>
        </div>
      </div>

      <!-- Dynamic Tabs & Content -->
      <div id="hist-dynamic-region">
        ${renderHistoryDynamicRegionHtml(payload)}
      </div>
    </div>
  `;
}

export function wireCreatorHistoryHandlers(container, initialPayload, onFullRefresh) {
  let currentPayload = initialPayload;
  let searchDebounce = null;
  let requestSeq = 0;

  const updateClearBtn = () => {
    const clearBtn = document.getElementById('hist-search-clear');
    const searchInput = document.getElementById('hist-search-input');
    if (clearBtn && searchInput) {
      const hasVal = searchInput.value.trim().length > 0;
      clearBtn.classList.toggle('hidden', !hasVal);
      clearBtn.classList.toggle('flex', hasVal);
    }
  };

  const refreshHistoryRegion = async () => {
    const regionEl = document.getElementById('hist-dynamic-region');
    if (!regionEl) return;
    const seq = ++requestSeq;
    regionEl.style.opacity = '0.65';
    try {
      const fresh = await apiFetch(buildHistoryUrl(), { noCache: true });
      if (seq !== requestSeq) return;
      currentPayload = fresh;
      regionEl.innerHTML = renderHistoryDynamicRegionHtml(fresh);
      regionEl.style.opacity = '1';
      bindDynamicEvents();
    } catch (err) {
      if (seq !== requestSeq) return;
      regionEl.style.opacity = '1';
      showToast(err?.message || 'Unable to load history.', 'error');
    }
  };

  const resetAllFilters = () => {
    historyPageState.q = '';
    historyPageState.submissionStatus = 'all';
    historyPageState.dateRange = 'all';
    historyPageState.startDate = '';
    historyPageState.endDate = '';
    historyPageState.subPage = 1;
    historyPageState.actPage = 1;
    const searchInput = document.getElementById('hist-search-input');
    if (searchInput) searchInput.value = '';
    const dateSel = document.getElementById('hist-date-range');
    if (dateSel) dateSel.value = 'all';
    document.getElementById('hist-custom-dates')?.classList.add('hidden');
    document.getElementById('hist-custom-dates')?.classList.remove('flex');
    updateClearBtn();
    refreshHistoryRegion();
  };

  const searchInput = document.getElementById('hist-search-input');
  searchInput?.addEventListener('input', () => {
    updateClearBtn();
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      historyPageState.q = searchInput.value;
      historyPageState.subPage = 1;
      historyPageState.actPage = 1;
      refreshHistoryRegion();
    }, 260);
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchDebounce) clearTimeout(searchDebounce);
      historyPageState.q = searchInput.value;
      historyPageState.subPage = 1;
      historyPageState.actPage = 1;
      refreshHistoryRegion();
    }
  });

  document.getElementById('hist-search-clear')?.addEventListener('click', () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    historyPageState.q = '';
    historyPageState.subPage = 1;
    historyPageState.actPage = 1;
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    updateClearBtn();
    refreshHistoryRegion();
  });

  document.getElementById('hist-date-range')?.addEventListener('change', (e) => {
    const val = e.target.value || 'all';
    historyPageState.dateRange = val;
    historyPageState.subPage = 1;
    historyPageState.actPage = 1;
    const customBox = document.getElementById('hist-custom-dates');
    if (val === 'custom') {
      customBox?.classList.remove('hidden');
      customBox?.classList.add('flex');
      return;
    }
    customBox?.classList.add('hidden');
    customBox?.classList.remove('flex');
    refreshHistoryRegion();
  });

  document.getElementById('hist-apply-dates')?.addEventListener('click', () => {
    const s = document.getElementById('hist-start-date')?.value || '';
    const e = document.getElementById('hist-end-date')?.value || '';
    if (!s || !e) {
      showToast('Select both start and end dates.', 'error');
      return;
    }
    if (s > e) {
      showToast('Start date cannot be later than end date.', 'error');
      return;
    }
    historyPageState.dateRange = 'custom';
    historyPageState.startDate = s;
    historyPageState.endDate = e;
    historyPageState.subPage = 1;
    historyPageState.actPage = 1;
    refreshHistoryRegion();
  });

  document.getElementById('hist-reset-all')?.addEventListener('click', resetAllFilters);

  const bindDynamicEvents = () => {
    const region = document.getElementById('hist-dynamic-region');
    if (!region) return;
    const deletedList = currentPayload?.deletedContents || [];
    const activityList = currentPayload?.activityHistory?.items || currentPayload?.history || [];

    region.querySelectorAll('.hist-subtab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextTab = btn.dataset.subtab || 'submissions';
        if (historyPageState.activeSubTab === nextTab) return;
        historyPageState.activeSubTab = nextTab;
        region.innerHTML = renderHistoryDynamicRegionHtml(currentPayload);
        bindDynamicEvents();
      });
    });

    document.getElementById('hist-sub-status')?.addEventListener('change', (e) => {
      historyPageState.submissionStatus = e.target.value || 'all';
      historyPageState.subPage = 1;
      refreshHistoryRegion();
    });

    region.querySelectorAll('.hist-clear-btn').forEach((btn) => {
      btn.addEventListener('click', resetAllFilters);
    });

    region.querySelectorAll('.hist-page-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextPage = Number(btn.dataset.page);
        if (!nextPage || nextPage < 1) return;
        if (btn.dataset.kind === 'act') historyPageState.actPage = nextPage;
        else historyPageState.subPage = nextPage;
        refreshHistoryRegion();
      });
    });

    region.querySelectorAll('.cr-recover-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.recoverId);
        const item = deletedList.find((d) => Number(d.id) === id);
        if (!item) return;
        const restoreStatus =
          item.previousStatus === 'approved'
            ? 'Published'
            : item.previousStatus === 'changes_requested'
            ? 'Changes Requested'
            : item.previousStatus === 'pending'
            ? 'Under Review'
            : item.previousStatus || 'Draft';

        openModal({
          title: 'Restore Content?',
          widthClass: 'max-w-sm',
          bodyHtml: `
            <div class="space-y-4 text-xs">
              <p class="text-slate-600 dark:text-slate-300 leading-relaxed">
                Restore <strong class="text-slate-900 dark:text-white">${esc(item.title)}</strong> from Trash? It will be restored safely to its previous status (<strong class="capitalize">${esc(restoreStatus)}</strong>).
              </p>
              <div class="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button type="button" id="cr-rec-cancel" class="px-3.5 py-2 font-semibold rounded-lg border border-slate-300 dark:border-slate-700">Cancel</button>
                <button type="button" id="cr-rec-confirm" class="px-4 py-2 font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white">Confirm Restore</button>
              </div>
            </div>
          `,
          onMount: (close) => {
            document.getElementById('cr-rec-cancel')?.addEventListener('click', close);
            const confirmBtn = document.getElementById('cr-rec-confirm');
            confirmBtn?.addEventListener('click', async () => {
              confirmBtn.disabled = true;
              confirmBtn.textContent = 'Restoring...';
              try {
                const res = await apiFetch(`/api/creator/contents/${id}/recover`, { method: 'POST' });
                showToast(res.message || 'Content restored successfully!', 'success');
                close();
                if (typeof onFullRefresh === 'function') await onFullRefresh();
                else await refreshHistoryRegion();
              } catch (err) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Confirm Restore';
                showToast(err.message, 'error');
              }
            });
          },
        });
      });
    });

    region.querySelectorAll('.cr-perm-delete-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.permDelId);
        const item = deletedList.find((d) => Number(d.id) === id);
        openModal({
          title: 'Delete Permanently?',
          widthClass: 'max-w-sm',
          bodyHtml: `
            <div class="space-y-4 text-xs">
              <p class="text-slate-600 dark:text-slate-300 leading-relaxed">
                Are you sure you want to permanently erase <strong class="text-slate-900 dark:text-white">${esc(item?.title || 'this content')}</strong>? This action cannot be undone and is blocked if student purchases exist.
              </p>
              <div class="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button type="button" id="cr-perm-cancel" class="px-3.5 py-2 font-semibold rounded-lg border border-slate-300 dark:border-slate-700">Cancel</button>
                <button type="button" id="cr-perm-confirm" class="px-4 py-2 font-semibold rounded-lg bg-red-700 hover:bg-red-800 text-white">Delete Permanently</button>
              </div>
            </div>
          `,
          onMount: (close) => {
            document.getElementById('cr-perm-cancel')?.addEventListener('click', close);
            const confirmBtn = document.getElementById('cr-perm-confirm');
            confirmBtn?.addEventListener('click', async () => {
              confirmBtn.disabled = true;
              confirmBtn.textContent = 'Deleting...';
              try {
                const res = await apiFetch(`/api/creator/contents/${id}/permanent`, { method: 'DELETE' });
                showToast(res.message || 'Permanently deleted.', 'success');
                close();
                if (typeof onFullRefresh === 'function') await onFullRefresh();
                else await refreshHistoryRegion();
              } catch (err) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Delete Permanently';
                showToast(err.message, 'error');
              }
            });
          },
        });
      });
    });

    region.querySelectorAll('.cr-deleted-detail').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.delDetailId);
        const item = deletedList.find((d) => Number(d.id) === id);
        if (!item) return;
        openModal({
          title: 'Deleted Content Details',
          bodyHtml: `
            <div class="space-y-4 text-xs">
              <div class="p-3.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/70">
                <div class="font-semibold text-amber-900 dark:text-amber-200">${esc(formatRelativeAge(item.deletedAt))}</div>
                <div class="text-amber-800/80 dark:text-amber-300/80 mt-0.5">Deleted at ${esc(formatDateTime(item.deletedAt))} · ${esc(formatRecoveryCountdown(item.purgeAfter))}</div>
              </div>
              <dl class="divide-y divide-slate-100 dark:divide-slate-800">
                <div class="py-2 flex justify-between gap-4"><dt class="text-slate-500">Title</dt><dd class="font-semibold text-slate-900 dark:text-white text-right">${esc(item.title)}</dd></div>
                <div class="py-2 flex justify-between gap-4"><dt class="text-slate-500">Author Name</dt><dd class="text-slate-800 dark:text-slate-200">${esc(item.authorName || store.user?.name || '—')}</dd></div>
                ${item.publisherName ? `<div class="py-2 flex justify-between gap-4"><dt class="text-slate-500">Publisher</dt><dd class="text-slate-800 dark:text-slate-200">${esc(item.publisherName)}</dd></div>` : ''}
                <div class="py-2 flex justify-between gap-4"><dt class="text-slate-500">Format &amp; Category</dt><dd class="text-slate-800 dark:text-slate-200">${esc(item.contentType)} · ${esc(item.categoryName || 'General')}</dd></div>
                <div class="py-2 flex justify-between gap-4"><dt class="text-slate-500">Pricing</dt><dd class="font-mono">${item.isFree ? 'Free' : formatInr(item.priceInr)}</dd></div>
                <div class="py-2 flex justify-between gap-4"><dt class="text-slate-500">Status Before Deletion</dt><dd class="capitalize font-semibold">${esc(item.previousStatus || 'draft')}</dd></div>
                <div class="py-2 flex justify-between gap-4"><dt class="text-slate-500">Views / Paid Sales</dt><dd class="font-mono">${item.viewsCount} views · ${item.purchasesCount} sales</dd></div>
                <div class="py-2 flex justify-between gap-4"><dt class="text-slate-500">Permanent Auto-Purge Date</dt><dd class="font-mono text-red-700 dark:text-red-400">${esc(formatDateTime(item.purgeAfter))}</dd></div>
              </dl>
              ${item.shortDescription ? `<div class="p-3 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 leading-relaxed">${esc(item.shortDescription)}</div>` : ''}
            </div>
          `,
        });
      });
    });

    region.querySelectorAll('.cr-hist-detail').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.histId);
        const h = activityList.find((x) => Number(x.id) === id);
        if (!h) return;
        const detailsEntries = Object.entries(h.details || {}).filter(
          ([, v]) => v !== null && v !== undefined && v !== ''
        );
        openModal({
          title: 'History Event Details',
          bodyHtml: `
            <div class="space-y-4 text-xs">
              <div class="p-3.5 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 space-y-1">
                <div class="font-semibold text-slate-900 dark:text-white">${esc(h.contentTitle)}</div>
                <div class="text-slate-500">Action: <strong class="capitalize text-slate-800 dark:text-slate-200">${esc(String(h.action).replace(/_/g, ' '))}</strong> · ${esc(formatRelativeAge(h.createdAt))}</div>
                <div class="font-mono text-[11px] text-slate-500">${esc(formatDateTime(h.createdAt))}</div>
              </div>
              ${
                detailsEntries.length
                  ? `<dl class="divide-y divide-slate-100 dark:divide-slate-800">
                      ${detailsEntries
                        .map(
                          ([k, v]) => `
                        <div class="py-2 flex justify-between gap-4">
                          <dt class="text-slate-500 capitalize">${esc(k.replace(/([A-Z])/g, ' $1'))}</dt>
                          <dd class="font-mono text-slate-900 dark:text-slate-100 text-right break-all">${esc(
                            k.toLowerCase().includes('at') || k.toLowerCase().includes('after')
                              ? formatDateTime(String(v))
                              : typeof v === 'object'
                              ? JSON.stringify(v)
                              : String(v)
                          )}</dd>
                        </div>
                      `
                        )
                        .join('')}
                    </dl>`
                  : `<p class="text-slate-500">No extra metadata recorded for this event.</p>`
              }
            </div>
          `,
        });
      });
    });
  };

  bindDynamicEvents();
}
