import {
  apiFetch,
  esc,
  formatDate,
  formatInr,
  loadGlobalCatalogMeta,
  openModal,
  renderStatusLabel,
  showToast,
  store,
} from './api.js';

function formatDuration(totalSeconds) {
  const sec = Math.max(0, Math.round(Number(totalSeconds || 0)));
  if (sec < 60) return `${sec}s`;
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const rem = sec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m${rem > 0 ? ` ${rem}s` : ''}`;
  return `${mins}m ${rem}s`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimeOnly(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export async function renderAdminDashboardPage(container, activeTab = 'overview', subParam = null) {
  if (!store.user) {
    window.location.hash = '#/login';
    return;
  }
  if (store.user.role !== 'admin') {
    container.innerHTML = `
      <div class="max-w-xl mx-auto px-4 py-16 text-center">
        <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-8">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-2">Administrator Access Required</h1>
          <p class="text-sm text-slate-600 dark:text-slate-400 mb-6">Your account does not currently have administrator permissions.</p>
          <a href="#/dashboard" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] text-white">Return to Dashboard</a>
        </div>
      </div>
    `;
    return;
  }

  const tabs = [
    { id: 'overview', label: 'Overview & Reports' },
    { id: 'users', label: 'User Management' },
    { id: 'tracker', label: 'User Tracker' },
    { id: 'creators', label: 'Creator Management' },
    { id: 'approvals', label: 'Content Approvals' },
    { id: 'contents', label: 'Content Management' },
    { id: 'categories', label: 'Categories & Subjects' },
    { id: 'transactions', label: 'Transactions & Refunds' },
    { id: 'commission', label: 'Commission Settings' },
    { id: 'withdrawals', label: 'Withdrawals' },
    { id: 'reports', label: 'Reported Content' },
    { id: 'notifications', label: 'Broadcast Notifications' },
    { id: 'settings', label: 'Website Settings & Audit' },
  ];

  container.innerHTML = `<div class="max-w-7xl mx-auto px-4 py-12 text-sm text-slate-500">Loading Administrator Console...</div>`;

  try {
    let bodyHtml = '';

    if (activeTab === 'overview') {
      const qs = window.location.hash.includes('?')
        ? new URLSearchParams(window.location.hash.split('?')[1])
        : new URLSearchParams();
      const from = qs.get('from') || '';
      const to = qs.get('to') || '';
      const apiQs = new URLSearchParams();
      if (from) apiQs.set('from', from);
      if (to) apiQs.set('to', to);

      const data = await apiFetch(`/api/admin/overview${apiQs.toString() ? `?${apiQs}` : ''}`);
      const m = data.metrics;

      bodyHtml = `
        <div class="space-y-8">
          <div class="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">Platform Analytics &amp; Revenue Reports</h1>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Real-time ledger metrics across users, creators, commissions, and payouts.</p>
            </div>
            <form id="admin-date-filter" class="flex flex-wrap items-center gap-2 text-xs w-full sm:w-auto">
              <input type="date" name="from" value="${esc(from)}" class="flex-1 sm:flex-none min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111A2E]" />
              <span class="text-slate-400">to</span>
              <input type="date" name="to" value="${esc(to)}" class="flex-1 sm:flex-none min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111A2E]" />
              <button type="submit" class="min-h-[38px] px-3.5 py-1.5 font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950 whitespace-nowrap shrink-0">Filter</button>
              ${from || to ? `<a href="#/admin/overview" class="text-slate-500 hover:underline px-1 whitespace-nowrap">Clear</a>` : ''}
            </form>
          </div>

          <!-- Primary Financial & Platform KPI Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500">Gross Transaction Value</div>
              <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${formatInr(m.grossTransactionValue)}</div>
              <div class="text-[11px] text-slate-400 mt-1 tabular-nums">${m.totalPurchases} active purchases</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500">Platform Commission Revenue</div>
              <div class="font-mono text-2xl font-semibold text-[#0F2547] dark:text-sky-400 mt-1 tabular-nums">${formatInr(m.totalPlatformCommission)}</div>
              <div class="text-[11px] text-slate-400 mt-1">Net platform share</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500">Total Creator Earnings</div>
              <div class="font-mono text-2xl font-semibold text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">${formatInr(m.totalCreatorEarnings)}</div>
              <div class="text-[11px] text-slate-400 mt-1 tabular-nums">Pending payouts: ${formatInr(m.pendingWithdrawalsAmount)}</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500">Users / Active / Creators</div>
              <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${m.totalUsers} / ${m.activeUsers} / ${m.totalCreators}</div>
              <div class="text-[11px] text-slate-400 mt-1 tabular-nums">${m.publishedContent} published (${m.freeContent} free · ${m.paidContent} paid)</div>
            </div>
          </div>

          <!-- Action Queues Summary -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <a href="#/admin/approvals" class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 hover:border-slate-400 flex items-center justify-between">
              <span class="text-sm font-medium">Pending Content Approvals</span>
              <span class="font-mono text-lg font-semibold ${m.pendingApprovals > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400'} tabular-nums">${m.pendingApprovals}</span>
            </a>
            <a href="#/admin/withdrawals" class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 hover:border-slate-400 flex items-center justify-between">
              <span class="text-sm font-medium">Pending Withdrawal Requests</span>
              <span class="font-mono text-lg font-semibold ${m.pendingWithdrawalsCount > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400'} tabular-nums">${m.pendingWithdrawalsCount}</span>
            </a>
            <a href="#/admin/reports" class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 hover:border-slate-400 flex items-center justify-between">
              <span class="text-sm font-medium">Open Copyright / Content Reports</span>
              <span class="font-mono text-lg font-semibold ${m.openReports > 0 ? 'text-red-700 dark:text-red-400' : 'text-slate-400'} tabular-nums">${m.openReports}</span>
            </a>
          </div>

          <!-- Monthly Revenue & Commission SVG Chart -->
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Monthly Revenue &amp; Commission Ledger</h2>
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <span><strong class="text-[#0F2547] dark:text-sky-400">■</strong> Gross Volume</span>
                <span><strong class="text-emerald-700 dark:text-emerald-400">■</strong> Creator Share</span>
                <span><strong class="text-amber-600 dark:text-amber-400">■</strong> Platform Commission</span>
              </div>
            </div>
            ${renderRevenueSvgChart(data.monthlyRevenue || [])}
          </div>

          <!-- Popular Categories, Most Purchased Content, Top Creators -->
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h3 class="font-display text-base font-semibold mb-4">Popular Categories</h3>
              <div class="space-y-3 text-xs">
                ${(data.popularCategories || [])
                  .map(
                    (c) => `
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-medium text-slate-800 dark:text-slate-200 truncate">${esc(c.name)}</span>
                    <span class="font-mono text-slate-500 tabular-nums shrink-0">${c.contentCount} works · ${c.totalViews} views</span>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </div>

            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h3 class="font-display text-base font-semibold mb-4">Most Purchased Content</h3>
              <div class="space-y-3 text-xs">
                ${(data.topContent || [])
                  .map(
                    (c) => `
                  <div class="flex items-center justify-between gap-2">
                    <a href="#/content/${esc(c.slug)}" class="font-medium text-slate-800 dark:text-slate-200 hover:underline truncate">${esc(c.title)}</a>
                    <span class="font-mono text-slate-500 tabular-nums shrink-0">${c.purchasesCount} sales</span>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </div>

            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h3 class="font-display text-base font-semibold mb-4">Top Creators</h3>
              <div class="space-y-3 text-xs">
                ${(data.topCreators || [])
                  .map(
                    (cr) => `
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-medium text-slate-800 dark:text-slate-200 truncate">${esc(cr.displayName || cr.name)}</span>
                    <span class="font-mono text-emerald-700 dark:text-emerald-400 tabular-nums shrink-0">${formatInr(cr.totalEarningsInr || 0)} · ${cr.totalSales} sales</span>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (activeTab === 'users') {
      const data = await apiFetch('/api/admin/users');
      const canManageAdmins = Boolean(data.actorIsSuperAdmin);
      bodyHtml = `
        <div class="space-y-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">User Management (${data.users.length})</h1>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                ${
                  canManageAdmins
                    ? 'Primary Super Admin authority active: only you can promote or remove other Administrators.'
                    : 'Delegated Admin view: only the Primary Super Admin can grant or revoke Administrator roles.'
                }
              </p>
            </div>
            <a href="#/admin/tracker" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950 whitespace-nowrap">Open Digital User Tracker →</a>
          </div>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[760px] text-left text-sm">
              <thead class="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th class="px-4 py-3 font-semibold">User</th>
                  <th class="px-4 py-3 font-semibold">UID &amp; Unique ID</th>
                  <th class="px-4 py-3 font-semibold">Role</th>
                  <th class="px-4 py-3 font-semibold">Status</th>
                  <th class="px-4 py-3 font-semibold">Joined</th>
                  <th class="px-4 py-3 font-semibold text-right">Controls</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                ${data.users
                  .map((u) => {
                    const isPrimary = Boolean(u.isSuperAdmin);
                    const lockedForActor = isPrimary || (u.role === 'admin' && !canManageAdmins);
                    const allowedRoles = canManageAdmins ? ['user', 'creator', 'admin'] : ['user', 'creator'];
                    return `
                  <tr>
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-2">
                        <span class="font-medium text-slate-900 dark:text-white">${esc(u.name)}</span>
                        ${isPrimary ? '<span class="text-[11px] font-semibold text-amber-700 dark:text-amber-400">· Primary Super Admin</span>' : ''}
                      </div>
                      <div class="text-xs text-slate-500">${esc(u.email)}</div>
                    </td>
                    <td class="px-4 py-3 text-xs font-mono">
                      ${
                        isPrimary
                          ? `<span class="text-slate-400 font-sans">Shielded</span>`
                          : `
                            <div class="text-slate-800 dark:text-slate-200">${esc(u.publicUid || '—')}</div>
                            <div class="text-slate-500">${u.username ? `@${esc(u.username)}` : 'No ID set'}</div>
                          `
                      }
                    </td>
                    <td class="px-4 py-3">
                      ${
                        lockedForActor
                          ? `<span class="text-xs font-semibold text-slate-700 dark:text-slate-200">${isPrimary ? 'Super Admin (Locked)' : 'Admin (Locked)'}</span>`
                          : `<select data-user-id="${u.id}" class="adm-user-role text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                              ${allowedRoles.map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                            </select>`
                      }
                    </td>
                    <td class="px-4 py-3">${renderStatusLabel(u.status)}</td>
                    <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${formatDate(u.createdAt)}</td>
                    <td class="px-4 py-3 text-right whitespace-nowrap space-x-2 text-xs font-semibold">
                      ${
                        !isPrimary
                          ? `<a href="#/admin/tracker/${u.id}" class="text-[#0F2547] dark:text-sky-400 hover:underline">Track</a>`
                          : ''
                      }
                      ${
                        lockedForActor
                          ? `<span class="text-slate-400 font-normal">${isPrimary ? 'Shielded' : 'Protected'}</span>`
                          : `
                            ${u.status !== 'active' ? `<button type="button" data-uid="${u.id}" data-status="active" class="adm-user-status text-emerald-700 dark:text-emerald-400 hover:underline">Activate</button>` : ''}
                            ${u.status !== 'suspended' ? `<button type="button" data-uid="${u.id}" data-status="suspended" class="adm-user-status text-amber-700 dark:text-amber-400 hover:underline">Suspend</button>` : ''}
                            ${u.status !== 'blocked' ? `<button type="button" data-uid="${u.id}" data-status="blocked" class="adm-user-status text-red-700 dark:text-red-400 hover:underline">Block</button>` : ''}
                          `
                      }
                    </td>
                  </tr>
                `;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === 'tracker') {
      const qs = window.location.hash.includes('?')
        ? new URLSearchParams(window.location.hash.split('?')[1])
        : new URLSearchParams();
      const searchQ = qs.get('q') || '';

      if (subParam) {
        // Full User Digital Dossier View
        let dossier = null;
        let dossierError = null;
        try {
          dossier = await apiFetch(`/api/admin/users/${encodeURIComponent(subParam)}/dossier`);
        } catch (err) {
          dossierError = err.message || 'Unable to load user dossier.';
        }

        if (dossierError || !dossier) {
          bodyHtml = `
            <div class="space-y-6">
              <div class="flex items-center justify-between gap-3">
                <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Digital User Tracker</h1>
                <a href="#/admin/tracker" class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">← Back to Tracker Search</a>
              </div>
              <div class="p-6 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-sm text-amber-900 dark:text-amber-200">
                ${esc(dossierError)}
              </div>
            </div>
          `;
        } else {
          const u = dossier.user;
          const p = dossier.profile || {};
          const live = dossier.liveStatus || {};
          const sum = dossier.summary || {};
          const contentHistory = dossier.contentHistory || [];
          const userPayments = dossier.spending?.payments || [];
          const visits = dossier.visits || { byYear: [], byMonth: [], dailyLogs: [] };
          const recentSessions = dossier.recentSessions || [];

          bodyHtml = `
            <div class="space-y-6">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <a href="#/admin/tracker" class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">← Back to User Tracker</a>
                  <h1 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white mt-1">
                    ${esc(u.name)} ${u.username ? `<span class="font-mono text-base font-normal text-slate-500">@${esc(u.username)}</span>` : ''}
                  </h1>
                </div>
                <div class="flex items-center gap-2">
                  <button type="button" id="adm-dossier-refresh" class="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">
                    Refresh Live Data
                  </button>
                </div>
              </div>

              <!-- Live Presence Banner -->
              <div class="p-4 sm:p-5 rounded-xl border ${
                live.isOnline
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-900'
                  : 'bg-white dark:bg-[#111A2E] border-slate-200 dark:border-slate-800'
              } flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div class="space-y-1">
                  <div class="flex items-center gap-2 text-xs font-semibold">
                    <span class="w-2.5 h-2.5 rounded-full ${live.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}"></span>
                    <span class="${live.isOnline ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'}">
                      ${live.isOnline ? 'ONLINE NOW — Live Viewing' : `Last Seen: ${formatDateTime(live.lastSeenAt)}`}
                    </span>
                  </div>
                  ${
                    live.currentSession
                      ? `<div class="text-sm font-medium text-slate-900 dark:text-white">
                          ${live.isOnline ? 'Currently viewing:' : 'Last viewed:'}
                          ${
                            live.currentSession.contentSlug
                              ? `<a href="#/content/${esc(live.currentSession.contentSlug)}" class="underline text-[#0F2547] dark:text-sky-400">${esc(live.currentSession.pageTitle)}</a>`
                              : `<span>${esc(live.currentSession.pageTitle || live.currentSession.pagePath)}</span>`
                          }
                          <span class="text-xs font-mono text-slate-500 ml-2">(${formatDuration(live.currentSession.durationSeconds)} in session)</span>
                        </div>`
                      : `<div class="text-xs text-slate-500">No browsing activity recorded for this account yet.</div>`
                  }
                </div>
                <div class="text-right font-mono text-xs shrink-0">
                  <div class="text-slate-400">10-Digit UID</div>
                  <div class="text-base font-bold text-[#0F2547] dark:text-sky-400 tracking-wider">${esc(u.publicUid || '—')}</div>
                </div>
              </div>

              <!-- 4-Column Activity & Spending KPI Strip -->
              <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
                  <div class="text-xs text-slate-500">Total Money Spent</div>
                  <div class="font-mono text-2xl font-semibold text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">${formatInr(sum.totalSpentInr || 0)}</div>
                  <div class="text-[11px] text-slate-400 mt-1">${sum.successfulPaymentsCount || 0} successful payment(s)</div>
                </div>
                <div class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
                  <div class="text-xs text-slate-500">Contents Viewed</div>
                  <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${sum.totalContentsViewed || 0}</div>
                  <div class="text-[11px] text-slate-400 mt-1">Reading time: ${formatDuration(sum.totalContentReadSeconds || 0)}</div>
                </div>
                <div class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
                  <div class="text-xs text-slate-500">Total Time on Website</div>
                  <div class="font-mono text-2xl font-semibold text-[#0F2547] dark:text-sky-400 mt-1 tabular-nums">${formatDuration(sum.totalWebsiteSeconds || 0)}</div>
                  <div class="text-[11px] text-slate-400 mt-1">Across all recorded sessions</div>
                </div>
                <div class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
                  <div class="text-xs text-slate-500">Total Visit Days</div>
                  <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${sum.totalVisitDays || 0} days</div>
                  <div class="text-[11px] text-slate-400 mt-1">${sum.firstVisitDate ? `Since ${esc(sum.firstVisitDate)}` : 'No visits yet'}</div>
                </div>
              </div>

              <!-- Full Profile & Demographic Card -->
              <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
                <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Complete User Profile Details</h2>
                <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-xs">
                  <div>
                    <div class="text-slate-400">10-Digit UID</div>
                    <div class="font-mono font-semibold text-slate-900 dark:text-white mt-0.5">${esc(u.publicUid || '—')}</div>
                  </div>
                  <div>
                    <div class="text-slate-400">Unique ID</div>
                    <div class="font-mono font-semibold text-slate-900 dark:text-white mt-0.5">${u.username ? `@${esc(u.username)}` : '—'}</div>
                  </div>
                  <div>
                    <div class="text-slate-400">Email Address</div>
                    <div class="font-semibold text-slate-900 dark:text-white mt-0.5 break-all">${esc(u.email)}</div>
                  </div>
                  <div>
                    <div class="text-slate-400">Account Role &amp; Status</div>
                    <div class="font-semibold text-slate-900 dark:text-white mt-0.5 capitalize">${esc(u.role)} · ${esc(u.status)}</div>
                  </div>
                  <div>
                    <div class="text-slate-400">Occupation Role</div>
                    <div class="font-semibold text-slate-900 dark:text-white mt-0.5">${esc(p.occupationRole || '—')}</div>
                  </div>
                  <div>
                    <div class="text-slate-400">State</div>
                    <div class="font-semibold text-slate-900 dark:text-white mt-0.5">${esc(p.state || '—')}</div>
                  </div>
                  <div>
                    <div class="text-slate-400">Country</div>
                    <div class="font-semibold text-slate-900 dark:text-white mt-0.5">${esc(p.country || '—')}</div>
                  </div>
                  <div>
                    <div class="text-slate-400">Gender</div>
                    <div class="font-semibold text-slate-900 dark:text-white mt-0.5">${esc(p.gender || '—')}</div>
                  </div>
                  <div>
                    <div class="text-slate-400">Date of Birth</div>
                    <div class="font-mono font-semibold text-slate-900 dark:text-white mt-0.5">${esc(p.dateOfBirth || '—')}</div>
                  </div>
                  <div>
                    <div class="text-slate-400">Institution</div>
                    <div class="font-semibold text-slate-900 dark:text-white mt-0.5">${esc(p.institution || '—')}</div>
                  </div>
                  <div>
                    <div class="text-slate-400">Joined On</div>
                    <div class="font-semibold text-slate-900 dark:text-white mt-0.5">${formatDateTime(u.createdAt)}</div>
                  </div>
                  <div>
                    <div class="text-slate-400">Preferred Language</div>
                    <div class="font-semibold text-slate-900 dark:text-white mt-0.5">${esc(p.languagePreference || 'English')}</div>
                  </div>
                </div>
                <div class="pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                  <div class="text-slate-400 mb-1">Description / Bio</div>
                  <p class="text-slate-700 dark:text-slate-300">${esc(u.bio || 'No description provided.')}</p>
                </div>
              </div>

              <!-- Content Viewing History & Exact Time Spent -->
              <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div class="p-5 border-b border-slate-100 dark:border-slate-800">
                  <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Content Viewing History (${contentHistory.length} Publications)</h2>
                  <p class="text-xs text-slate-500 mt-0.5">Exact list of every publication viewed by this user, number of visits, and total time spent reading/watching.</p>
                </div>
                <div class="overflow-x-auto touch-scroll-x">
                  <table class="w-full min-w-[640px] text-left text-xs">
                    <thead class="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th class="px-4 py-3 font-semibold">Publication</th>
                        <th class="px-4 py-3 font-semibold">Format</th>
                        <th class="px-4 py-3 font-semibold text-right">Sessions</th>
                        <th class="px-4 py-3 font-semibold text-right">Total Time Spent</th>
                        <th class="px-4 py-3 font-semibold text-right">Last Viewed</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                      ${
                        contentHistory.length
                          ? contentHistory
                              .map(
                                (c) => `
                              <tr>
                                <td class="px-4 py-3 font-medium text-slate-900 dark:text-white">
                                  <a href="#/content/${esc(c.slug)}" class="hover:underline">${esc(c.title)}</a>
                                </td>
                                <td class="px-4 py-3 text-slate-500">${esc(c.contentType)} · ${c.isFree ? 'Free' : formatInr(c.priceInr)}</td>
                                <td class="px-4 py-3 text-right font-mono tabular-nums">${c.viewsCount}</td>
                                <td class="px-4 py-3 text-right font-mono font-semibold text-[#0F2547] dark:text-sky-400 tabular-nums">${formatDuration(c.totalDurationSeconds)}</td>
                                <td class="px-4 py-3 text-right text-slate-500 whitespace-nowrap">${formatDateTime(c.lastViewedAt)}</td>
                              </tr>
                            `
                              )
                              .join('')
                          : `<tr><td colspan="5" class="px-4 py-8 text-center text-slate-500">This user has not opened any publications yet.</td></tr>`
                      }
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Spending & Payment History -->
              <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div class="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Spending &amp; Payment History</h2>
                    <p class="text-xs text-slate-500 mt-0.5">Every payment attempted or completed on ScholarPress, with exact date and amount.</p>
                  </div>
                  <div class="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">Total Spent: ${formatInr(sum.totalSpentInr || 0)}</div>
                </div>
                <div class="overflow-x-auto touch-scroll-x">
                  <table class="w-full min-w-[640px] text-left text-xs">
                    <thead class="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th class="px-4 py-3 font-semibold">Date &amp; Time</th>
                        <th class="px-4 py-3 font-semibold">Publication</th>
                        <th class="px-4 py-3 font-semibold">Receipt No.</th>
                        <th class="px-4 py-3 font-semibold">Status</th>
                        <th class="px-4 py-3 font-semibold text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                      ${
                        userPayments.length
                          ? userPayments
                              .map(
                                (pay) => `
                              <tr>
                                <td class="px-4 py-3 text-slate-500 whitespace-nowrap">${formatDateTime(pay.createdAt)}</td>
                                <td class="px-4 py-3 font-medium text-slate-900 dark:text-white">
                                  <a href="#/content/${esc(pay.contentSlug)}" class="hover:underline">${esc(pay.contentTitle)}</a>
                                </td>
                                <td class="px-4 py-3 font-mono">${esc(pay.receiptNumber)}</td>
                                <td class="px-4 py-3">${renderStatusLabel(pay.status)}</td>
                                <td class="px-4 py-3 text-right font-mono font-semibold tabular-nums">${formatInr(pay.amountInr)}</td>
                              </tr>
                            `
                              )
                              .join('')
                          : `<tr><td colspan="5" class="px-4 py-8 text-center text-slate-500">No payments recorded for this user yet.</td></tr>`
                      }
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Visit Calendar Breakdown: Year / Month / Exact Day -->
              <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-6">
                <div>
                  <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Website Visit Calendar (Year · Month · Day)</h2>
                  <p class="text-xs text-slate-500 mt-0.5">Exact breakdown of which years, months, and individual days this user visited the website.</p>
                </div>

                <!-- Year-wise cards -->
                <div>
                  <div class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">Year-Wise Summary</div>
                  ${
                    visits.byYear.length
                      ? `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          ${visits.byYear
                            .map(
                              (y) => `
                            <div class="p-3.5 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800">
                              <div class="font-mono text-lg font-bold text-slate-900 dark:text-white">${y.year}</div>
                              <div class="text-xs text-slate-600 dark:text-slate-300 mt-1 tabular-nums">
                                <strong>${y.days}</strong> active day(s) · <strong>${formatDuration(y.totalSeconds)}</strong> · ${y.pageViews} views
                              </div>
                            </div>
                          `
                            )
                            .join('')}
                        </div>`
                      : `<p class="text-xs text-slate-500">No yearly visit records yet.</p>`
                  }
                </div>

                <!-- Month-wise table -->
                <div>
                  <div class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">Month-Wise Breakdown</div>
                  ${
                    visits.byMonth.length
                      ? `<div class="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                          <table class="w-full text-left text-xs">
                            <thead class="bg-slate-50 dark:bg-[#0B1120] text-slate-500 border-b border-slate-200 dark:border-slate-800">
                              <tr>
                                <th class="px-4 py-2.5 font-semibold">Month &amp; Year</th>
                                <th class="px-4 py-2.5 font-semibold text-right">Active Days</th>
                                <th class="px-4 py-2.5 font-semibold text-right">Page Views</th>
                                <th class="px-4 py-2.5 font-semibold text-right">Total Time Spent</th>
                              </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                              ${visits.byMonth
                                .map(
                                  (m) => `
                                <tr>
                                  <td class="px-4 py-2.5 font-semibold text-slate-900 dark:text-white">${esc(m.label)}</td>
                                  <td class="px-4 py-2.5 text-right font-mono tabular-nums">${m.days} day(s)</td>
                                  <td class="px-4 py-2.5 text-right font-mono tabular-nums">${m.pageViews}</td>
                                  <td class="px-4 py-2.5 text-right font-mono font-semibold text-[#0F2547] dark:text-sky-400 tabular-nums">${formatDuration(m.totalSeconds)}</td>
                                </tr>
                              `
                                )
                                .join('')}
                            </tbody>
                          </table>
                        </div>`
                      : `<p class="text-xs text-slate-500">No monthly visit records yet.</p>`
                  }
                </div>

                <!-- Exact Day-by-Day Visit Log -->
                <div>
                  <div class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">Day-by-Day Visit Log (${visits.dailyLogs.length} Days)</div>
                  ${
                    visits.dailyLogs.length
                      ? `<div class="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg max-h-96 overflow-y-auto">
                          <table class="w-full min-w-[560px] text-left text-xs">
                            <thead class="sticky top-0 bg-slate-50 dark:bg-[#0B1120] text-slate-500 border-b border-slate-200 dark:border-slate-800">
                              <tr>
                                <th class="px-4 py-2.5 font-semibold">Date</th>
                                <th class="px-4 py-2.5 font-semibold">Day</th>
                                <th class="px-4 py-2.5 font-semibold text-right">Page Views</th>
                                <th class="px-4 py-2.5 font-semibold text-right">Time on Site</th>
                                <th class="px-4 py-2.5 font-semibold text-right">First / Last Seen</th>
                              </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                              ${visits.dailyLogs
                                .map(
                                  (d) => `
                                <tr>
                                  <td class="px-4 py-2.5 font-mono font-semibold text-slate-900 dark:text-white">${esc(d.visitDate)}</td>
                                  <td class="px-4 py-2.5 text-slate-600 dark:text-slate-300">${esc(d.dayOfWeek)}</td>
                                  <td class="px-4 py-2.5 text-right font-mono tabular-nums">${d.pageViews}</td>
                                  <td class="px-4 py-2.5 text-right font-mono font-semibold text-[#0F2547] dark:text-sky-400 tabular-nums">${formatDuration(d.totalSeconds)}</td>
                                  <td class="px-4 py-2.5 text-right font-mono text-slate-500 whitespace-nowrap">${formatTimeOnly(d.firstSeenAt)} – ${formatTimeOnly(d.lastSeenAt)}</td>
                                </tr>
                              `
                                )
                                .join('')}
                            </tbody>
                          </table>
                        </div>`
                      : `<p class="text-xs text-slate-500">No daily visits recorded yet.</p>`
                  }
                </div>
              </div>

              <!-- Recent Live Activity Trail -->
              <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div class="p-5 border-b border-slate-100 dark:border-slate-800">
                  <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Recent Page-by-Page Activity Trail</h2>
                </div>
                <div class="overflow-x-auto touch-scroll-x">
                  <table class="w-full min-w-[600px] text-left text-xs">
                    <thead class="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th class="px-4 py-2.5 font-semibold">Page / Content</th>
                        <th class="px-4 py-2.5 font-semibold">Path</th>
                        <th class="px-4 py-2.5 font-semibold text-right">Duration</th>
                        <th class="px-4 py-2.5 font-semibold text-right">Last Active</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                      ${
                        recentSessions.length
                          ? recentSessions
                              .map(
                                (s) => `
                              <tr>
                                <td class="px-4 py-2.5 font-medium text-slate-900 dark:text-white">
                                  ${
                                    s.contentSlug
                                      ? `<a href="#/content/${esc(s.contentSlug)}" class="hover:underline">${esc(s.contentTitle || s.pageTitle || s.pagePath)}</a>`
                                      : esc(s.pageTitle || s.pagePath)
                                  }
                                </td>
                                <td class="px-4 py-2.5 font-mono text-slate-500">${esc(s.pagePath)}</td>
                                <td class="px-4 py-2.5 text-right font-mono tabular-nums">${formatDuration(s.durationSeconds)}</td>
                                <td class="px-4 py-2.5 text-right text-slate-500 whitespace-nowrap">${formatDateTime(s.lastSeenAt)}</td>
                              </tr>
                            `
                              )
                              .join('')
                          : `<tr><td colspan="4" class="px-4 py-8 text-center text-slate-500">No session history yet.</td></tr>`
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          `;
        }
      } else {
        // Tracker Search & Directory View
        const data = await apiFetch(
          `/api/admin/users/track${searchQ ? `?q=${encodeURIComponent(searchQ)}` : ''}`
        );
        const results = data.results || [];

        bodyHtml = `
          <div class="space-y-6">
            <div>
              <h1 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">Digital User Tracker</h1>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Search any user or delegated admin by their <strong>10-Digit UID</strong>, <strong>Unique ID (@name)</strong>, email, or name to inspect live viewing activity, content watch time, spending, and Day/Month/Year visit history. Primary Super Admin is strictly shielded and untrackable.
              </p>
            </div>

            <form id="adm-tracker-search-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row gap-3">
              <input name="q" value="${esc(searchQ)}" placeholder="Enter 10-digit UID (e.g. 4829105736), @unique_id, name, or email..." class="flex-1 px-4 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              <div class="flex gap-2">
                <button type="submit" class="px-5 py-2.5 text-xs font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 text-white dark:text-slate-950 whitespace-nowrap">
                  Search &amp; Track
                </button>
                ${searchQ ? `<a href="#/admin/tracker" class="px-4 py-2.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 flex items-center">Reset</a>` : ''}
              </div>
            </form>

            ${
              data.protected
                ? `<div class="p-5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-sm text-amber-900 dark:text-amber-200">
                    <strong>Access Shielded:</strong> ${esc(data.message)}
                  </div>`
                : `<div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
                    <table class="w-full min-w-[780px] text-left text-xs">
                      <thead class="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th class="px-4 py-3 font-semibold">User &amp; Status</th>
                          <th class="px-4 py-3 font-semibold">10-Digit UID / Unique ID</th>
                          <th class="px-4 py-3 font-semibold">Live / Last Activity</th>
                          <th class="px-4 py-3 font-semibold text-right">Contents</th>
                          <th class="px-4 py-3 font-semibold text-right">Spent</th>
                          <th class="px-4 py-3 font-semibold text-right">Visit Days</th>
                          <th class="px-4 py-3 font-semibold text-right">Dossier</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                        ${
                          results.length
                            ? results
                                .map(
                                  (u) => `
                                <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                                  <td class="px-4 py-3">
                                    <div class="flex items-center gap-2">
                                      <span class="w-2 h-2 rounded-full shrink-0 ${u.isOnline ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}" title="${u.isOnline ? 'Online now' : 'Offline'}"></span>
                                      <span class="font-semibold text-slate-900 dark:text-white">${esc(u.name)}</span>
                                      <span class="capitalize text-[10px] text-slate-400">(${esc(u.role)})</span>
                                    </div>
                                    <div class="text-[11px] text-slate-500 pl-4">${esc(u.email)}</div>
                                  </td>
                                  <td class="px-4 py-3 font-mono">
                                    <div class="font-semibold text-slate-800 dark:text-slate-200">${esc(u.publicUid || '—')}</div>
                                    <div class="text-slate-500">${u.username ? `@${esc(u.username)}` : 'No ID set'}</div>
                                  </td>
                                  <td class="px-4 py-3 max-w-[220px]">
                                    ${
                                      u.currentPageTitle || u.currentPagePath
                                        ? `<div class="font-medium text-slate-800 dark:text-slate-200 truncate">${esc(u.currentPageTitle || u.currentPagePath)}</div>
                                           <div class="text-[11px] ${u.isOnline ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}">${u.isOnline ? 'Online now' : formatDateTime(u.lastSeenAt)}</div>`
                                        : `<span class="text-slate-400">No activity yet</span>`
                                    }
                                  </td>
                                  <td class="px-4 py-3 text-right font-mono tabular-nums">${u.totalContentsViewed}</td>
                                  <td class="px-4 py-3 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">${formatInr(u.totalSpentInr)}</td>
                                  <td class="px-4 py-3 text-right font-mono tabular-nums">${u.totalVisitDays}d (${formatDuration(u.totalWebsiteSeconds)})</td>
                                  <td class="px-4 py-3 text-right whitespace-nowrap">
                                    <a href="#/admin/tracker/${u.id}" class="px-3 py-1.5 rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950 font-semibold">
                                      View Full Detail →
                                    </a>
                                  </td>
                                </tr>
                              `
                                )
                                .join('')
                            : `<tr><td colspan="7" class="px-4 py-10 text-center text-slate-500">No matching users found. Try searching by 10-digit UID, @unique_id, name, or email.</td></tr>`
                        }
                      </tbody>
                    </table>
                  </div>`
            }
          </div>
        `;
      }
    } else if (activeTab === 'creators') {
      const data = await apiFetch('/api/admin/users');
      const creators = data.users.filter((u) => u.role === 'creator' || u.role === 'admin');
      bodyHtml = `
        <div class="space-y-6">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Creator Management &amp; Individual Commission Overrides</h1>
            <p class="text-xs text-slate-500 mt-1">Assign a custom commission percentage (5%–20%) to specific creators, or leave blank to apply the platform default.</p>
          </div>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[680px] text-left text-sm">
              <thead class="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th class="px-4 py-3 font-semibold">Creator</th>
                  <th class="px-4 py-3 font-semibold text-right">Total Earnings</th>
                  <th class="px-4 py-3 font-semibold text-right">Available</th>
                  <th class="px-4 py-3 font-semibold">Verified</th>
                  <th class="px-4 py-3 font-semibold">Custom Commission (5–20%)</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                ${creators
                  .map(
                    (c) => `
                  <tr>
                    <td class="px-4 py-3">
                      <div class="font-medium text-slate-900 dark:text-white">${esc(c.displayName || c.name)}</div>
                      <div class="text-xs text-slate-500">${esc(c.email)} · ${c.totalSales || 0} sales</div>
                    </td>
                    <td class="px-4 py-3 text-right font-mono text-xs tabular-nums">${formatInr(c.totalEarningsInr || 0)}</td>
                    <td class="px-4 py-3 text-right font-mono text-xs text-emerald-700 dark:text-emerald-400 tabular-nums">${formatInr(c.availableBalanceInr || 0)}</td>
                    <td class="px-4 py-3">
                      <button type="button" data-uid="${c.id}" data-verified="${c.verified ? 'false' : 'true'}" class="adm-verify-creator text-xs font-semibold ${c.verified ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'} hover:underline">
                        ${c.verified ? 'Verified ✓' : 'Verify'}
                      </button>
                    </td>
                    <td class="px-4 py-3">
                      <form data-uid="${c.id}" class="adm-creator-comm-form flex items-center gap-2">
                        <input name="rate" type="number" min="5" max="20" step="0.5" value="${esc(c.customCommissionRate ?? '')}" placeholder="Default" class="w-24 px-2 py-1 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
                        <button type="submit" class="px-2.5 py-1 text-xs font-semibold rounded bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Save</button>
                      </form>
                    </td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === 'approvals' || activeTab === 'contents') {
      const onlyPending = activeTab === 'approvals';
      const data = await apiFetch(`/api/admin/contents${onlyPending ? '?status=pending' : ''}`);
      bodyHtml = `
        <div class="space-y-6">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">${onlyPending ? 'Content Approval Queue' : 'All Platform Content'} (${data.contents.length})</h1>
            <p class="text-xs text-slate-500 mt-1">${onlyPending ? 'Review creator submissions before publishing them to the marketplace.' : 'Approve, reject, remove, feature, or assign per-item commission rates (5%–20%).'}</p>
          </div>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[700px] text-left text-sm">
              <thead class="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th class="px-4 py-3 font-semibold">Publication</th>
                  <th class="px-4 py-3 font-semibold">Creator</th>
                  <th class="px-4 py-3 font-semibold">Price</th>
                  <th class="px-4 py-3 font-semibold">Status</th>
                  ${!onlyPending ? '<th class="px-4 py-3 font-semibold">Item Comm %</th>' : ''}
                  <th class="px-4 py-3 font-semibold text-right">Moderation</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                ${
                  data.contents.length
                    ? data.contents
                        .map(
                          (c) => `
                      <tr>
                        <td class="px-4 py-3">
                          <a href="#/content/${esc(c.slug)}" class="font-medium text-slate-900 dark:text-white hover:underline block">${esc(c.title)}</a>
                          <span class="text-xs text-slate-500">${esc(c.contentType)} · ${esc(c.categoryName || 'General')}${c.isFeatured ? ' · Featured' : ''}</span>
                        </td>
                        <td class="px-4 py-3 text-xs">${esc(c.creatorName)}</td>
                        <td class="px-4 py-3 font-mono text-xs tabular-nums">${c.isFree ? 'Free' : formatInr(c.priceInr)}</td>
                        <td class="px-4 py-3">${renderStatusLabel(c.status)}</td>
                        ${
                          !onlyPending
                            ? `<td class="px-4 py-3">
                                <form data-cid="${c.id}" class="adm-content-comm-form flex items-center gap-1.5">
                                  <input name="rate" type="number" min="5" max="20" step="0.5" value="${esc(c.customCommissionRate ?? '')}" placeholder="Auto" class="w-20 px-2 py-1 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
                                  <button type="submit" class="px-2 py-1 text-xs font-semibold rounded border border-slate-300 dark:border-slate-700">Set</button>
                                </form>
                              </td>`
                            : ''
                        }
                        <td class="px-4 py-3 text-right whitespace-nowrap space-x-2 text-xs font-semibold">
                          ${c.status !== 'approved' ? `<button type="button" data-cid="${c.id}" data-status="approved" class="adm-content-mod text-emerald-700 dark:text-emerald-400 hover:underline">Approve</button>` : ''}
                          ${c.status === 'pending' ? `<button type="button" data-cid="${c.id}" data-status="rejected" class="adm-content-reject text-amber-700 dark:text-amber-400 hover:underline">Reject</button>` : ''}
                          ${
                            !onlyPending
                              ? `<button type="button" data-cid="${c.id}" data-featured="${c.isFeatured ? 'false' : 'true'}" class="adm-content-feat text-[#1B3B6F] dark:text-sky-400 hover:underline">${c.isFeatured ? 'Unfeature' : 'Feature'}</button>`
                              : ''
                          }
                          ${c.status !== 'removed' ? `<button type="button" data-cid="${c.id}" data-status="removed" class="adm-content-reject text-red-700 dark:text-red-400 hover:underline">Remove</button>` : ''}
                        </td>
                      </tr>
                    `
                        )
                        .join('')
                    : `<tr><td colspan="${onlyPending ? 5 : 6}" class="px-4 py-8 text-center text-slate-500">No items in queue.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === 'categories') {
      const catData = await apiFetch('/api/catalog/categories');
      bodyHtml = `
        <div class="space-y-8">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Category &amp; Subject Management</h1>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <form id="adm-add-cat-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <h2 class="font-display text-base font-semibold">Add Category</h2>
              <input name="name" required placeholder="Category name (e.g. Economics)" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              <input name="description" placeholder="Short description" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Create Category</button>
            </form>

            <form id="adm-add-subj-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <h2 class="font-display text-base font-semibold">Add Subject / Topic</h2>
              <select name="categoryId" required class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                ${catData.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
              </select>
              <input name="name" required placeholder="Subject name (e.g. Macroeconomics)" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Create Subject</button>
            </form>
          </div>

          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
            ${catData.categories
              .map(
                (c) => `
              <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div class="font-semibold text-sm text-slate-900 dark:text-white">${esc(c.name)} <span class="font-mono text-xs font-normal text-slate-400">(${c.contentCount} works)</span></div>
                  <div class="text-xs text-slate-500 mt-0.5">${esc(c.description || '')}</div>
                  ${
                    c.subjects?.length
                      ? `<div class="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-slate-600 dark:text-slate-400">
                          ${c.subjects
                            .map(
                              (s) =>
                                `<span>${esc(s.name)} <button type="button" data-sid="${s.id}" class="adm-del-subj text-red-500 ml-0.5" title="Delete subject">×</button></span>`
                            )
                            .join('')}
                        </div>`
                      : ''
                  }
                </div>
                <button type="button" data-catid="${c.id}" class="adm-del-cat text-xs font-semibold text-red-600 hover:underline shrink-0">Delete Category</button>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    } else if (activeTab === 'transactions') {
      const data = await apiFetch('/api/admin/transactions');
      bodyHtml = `
        <div class="space-y-6">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Payment Transactions &amp; Refund Management</h1>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[720px] text-left text-sm">
              <thead class="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th class="px-4 py-3 font-semibold">Date / Receipt</th>
                  <th class="px-4 py-3 font-semibold">Buyer &amp; Publication</th>
                  <th class="px-4 py-3 font-semibold text-right">Gross</th>
                  <th class="px-4 py-3 font-semibold text-right">Platform Fee</th>
                  <th class="px-4 py-3 font-semibold text-right">Creator Net</th>
                  <th class="px-4 py-3 font-semibold">Status</th>
                  <th class="px-4 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                ${
                  data.payments.length
                    ? data.payments
                        .map(
                          (p) => `
                      <tr>
                        <td class="px-4 py-3 text-xs">
                          <div class="font-mono">${esc(p.receiptNumber)}</div>
                          <div class="text-slate-400">${formatDate(p.createdAt)} · ${esc(p.mode)}</div>
                        </td>
                        <td class="px-4 py-3 text-xs">
                          <div class="font-medium text-slate-900 dark:text-white">${esc(p.contentTitle)}</div>
                          <div class="text-slate-500">${esc(p.buyerName)} (${esc(p.buyerEmail)})</div>
                        </td>
                        <td class="px-4 py-3 text-right font-mono text-xs tabular-nums">${formatInr(p.amountInr)}</td>
                        <td class="px-4 py-3 text-right font-mono text-xs tabular-nums">${p.platformCommissionInr ? `${formatInr(p.platformCommissionInr)} (${Number(p.commissionRate)}%)` : '—'}</td>
                        <td class="px-4 py-3 text-right font-mono text-xs text-emerald-700 dark:text-emerald-400 tabular-nums">${p.creatorEarningsInr ? formatInr(p.creatorEarningsInr) : '—'}</td>
                        <td class="px-4 py-3">${renderStatusLabel(p.status)}</td>
                        <td class="px-4 py-3 text-right">
                          ${
                            p.status === 'captured'
                              ? `<button type="button" data-pid="${p.id}" class="adm-refund-btn text-xs font-semibold text-red-700 dark:text-red-400 hover:underline">Issue Refund</button>`
                              : `<span class="text-xs text-slate-400">—</span>`
                          }
                        </td>
                      </tr>
                    `
                        )
                        .join('')
                    : `<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500">No payments recorded yet.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === 'commission') {
      const { settings } = await apiFetch('/api/admin/settings');
      const rate = Number(settings.default_commission_rate || 10);
      bodyHtml = `
        <div class="max-w-2xl space-y-6">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Platform Commission Settings</h1>
            <p class="text-sm text-slate-600 dark:text-slate-400 mt-1">Configure the default revenue-sharing fee between <strong>5%</strong> and <strong>20%</strong>. Individual creator or content overrides take precedence.</p>
          </div>
          <form id="adm-comm-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            <div>
              <div class="flex items-center justify-between mb-2">
                <label class="text-sm font-semibold">Default Commission Rate</label>
                <span id="adm-comm-display" class="font-mono text-xl font-semibold text-[#0F2547] dark:text-sky-400 tabular-nums">${rate}%</span>
              </div>
              <input id="adm-comm-range" name="default_commission_rate" type="range" min="5" max="20" step="0.5" value="${rate}" class="w-full accent-[#0F2547]" />
              <div class="flex justify-between text-xs font-mono text-slate-400 mt-1"><span>5%</span><span>10%</span><span>15%</span><span>20%</span></div>
            </div>
            <div id="adm-comm-example" class="p-4 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 text-xs font-mono space-y-1 tabular-nums"></div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Minimum Creator Withdrawal Threshold (INR)</label>
              <input name="min_withdrawal_inr" type="number" min="10" value="${esc(settings.min_withdrawal_inr || '100')}" class="w-full sm:w-48 px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <button type="submit" class="px-5 py-2.5 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Save Commission Policy</button>
          </form>
        </div>
      `;
    } else if (activeTab === 'withdrawals') {
      const data = await apiFetch('/api/admin/withdrawals');
      bodyHtml = `
        <div class="space-y-6">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Creator Withdrawal Management</h1>
            <p class="text-xs text-slate-500 mt-1">Review requests in order: Pending → Approved → Mark Paid (requires confirmed UTR / payout reference).</p>
          </div>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[700px] text-left text-sm">
              <thead class="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th class="px-4 py-3 font-semibold">Date</th>
                  <th class="px-4 py-3 font-semibold">Creator</th>
                  <th class="px-4 py-3 font-semibold">Payout Destination</th>
                  <th class="px-4 py-3 font-semibold text-right">Amount</th>
                  <th class="px-4 py-3 font-semibold">Status</th>
                  <th class="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                ${
                  data.withdrawals.length
                    ? data.withdrawals
                        .map((w) => {
                          const pd = w.payoutDetails || {};
                          const dest =
                            w.payoutMethod === 'upi'
                              ? `UPI: ${pd.upiId || '—'}`
                              : `Bank: ${pd.accountHolder || ''} · A/C ${pd.accountNumber || ''} · IFSC ${pd.ifscCode || ''}`;
                          return `
                            <tr>
                              <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${formatDate(w.createdAt)}</td>
                              <td class="px-4 py-3 text-xs">
                                <div class="font-medium text-slate-900 dark:text-white">${esc(w.creatorName)}</div>
                                <div class="text-slate-500">${esc(w.creatorEmail)}</div>
                              </td>
                              <td class="px-4 py-3 text-xs font-mono">${esc(dest)}</td>
                              <td class="px-4 py-3 text-right font-mono font-semibold tabular-nums">${formatInr(w.amountInr)}</td>
                              <td class="px-4 py-3">
                                ${renderStatusLabel(w.status)}
                                ${w.payoutReference ? `<div class="text-[11px] font-mono text-slate-400">Ref: ${esc(w.payoutReference)}</div>` : ''}
                              </td>
                              <td class="px-4 py-3 text-right whitespace-nowrap space-x-2 text-xs font-semibold">
                                ${w.status === 'pending' ? `<button type="button" data-wid="${w.id}" data-act="approve" class="adm-wd-action text-emerald-700 dark:text-emerald-400 hover:underline">Approve</button>` : ''}
                                ${w.status === 'approved' ? `<button type="button" data-wid="${w.id}" class="adm-wd-paid text-[#0F2547] dark:text-sky-400 hover:underline">Confirm Paid</button>` : ''}
                                ${w.status === 'pending' || w.status === 'approved' ? `<button type="button" data-wid="${w.id}" class="adm-wd-reject text-red-700 dark:text-red-400 hover:underline">Reject</button>` : '<span class="text-slate-400">—</span>'}
                              </td>
                            </tr>
                          `;
                        })
                        .join('')
                    : `<tr><td colspan="6" class="px-4 py-8 text-center text-slate-500">No withdrawal requests yet.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === 'reports') {
      const data = await apiFetch('/api/admin/reports');
      bodyHtml = `
        <div class="space-y-6">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Reported Content &amp; Copyright Complaints</h1>
          <div class="space-y-4">
            ${
              data.reports.length
                ? data.reports
                    .map(
                      (r) => `
                  <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 space-y-3">
                    <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div>
                        <span class="font-semibold uppercase text-red-700 dark:text-red-400">${esc(r.reportType)}</span>
                        <span class="mx-1.5">·</span>
                        <span>Reported by ${esc(r.reporterName)} on ${formatDate(r.createdAt)}</span>
                      </div>
                      ${renderStatusLabel(r.status)}
                    </div>
                    <div>
                      <a href="#/content/${esc(r.contentSlug)}" class="font-display text-lg font-semibold text-slate-900 dark:text-white hover:underline">${esc(r.contentTitle)}</a>
                      <p class="text-sm text-slate-700 dark:text-slate-300 mt-1"><strong>Reason:</strong> ${esc(r.reason)}</p>
                      ${r.details ? `<p class="text-xs text-slate-500 mt-1">${esc(r.details)}</p>` : ''}
                      ${r.copyrightProof ? `<p class="text-xs font-mono text-slate-500 mt-1">Proof: ${esc(r.copyrightProof)}</p>` : ''}
                    </div>
                    ${
                      r.status === 'open' || r.status === 'reviewing'
                        ? `<div class="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button type="button" data-rid="${r.id}" data-remove="true" class="adm-report-resolve px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-700 text-white">Remove Content &amp; Resolve</button>
                            <button type="button" data-rid="${r.id}" data-remove="false" data-st="dismissed" class="adm-report-resolve px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700">Dismiss Report</button>
                          </div>`
                        : `<div class="text-xs text-slate-500">Resolution note: ${esc(r.resolutionNote || 'Closed')}</div>`
                    }
                  </div>
                `
                    )
                    .join('')
                : `<div class="p-10 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 text-center text-sm text-slate-500">No reports filed.</div>`
            }
          </div>
        </div>
      `;
    } else if (activeTab === 'notifications') {
      bodyHtml = `
        <div class="max-w-2xl space-y-6">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Broadcast In-App Notification</h1>
          <form id="adm-broadcast-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Target Audience</label>
              <select name="audience" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                <option value="all">All Registered Users</option>
                <option value="creators">All Content Creators</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Notification Title</label>
              <input name="title" required placeholder="e.g. New Creator Payout Schedule" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Message</label>
              <textarea name="message" rows="4" required class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]"></textarea>
            </div>
            <button type="submit" class="px-5 py-2.5 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Send Notification</button>
          </form>
        </div>
      `;
    } else if (activeTab === 'settings') {
      const [{ settings }, { logs }] = await Promise.all([
        apiFetch('/api/admin/settings'),
        apiFetch('/api/admin/audit-logs'),
      ]);
      bodyHtml = `
        <div class="space-y-8">
          <div class="max-w-2xl">
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-5">Website Settings</h1>
            <form id="adm-site-settings-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Platform Name</label>
                <input name="site_name" value="${esc(settings.site_name || 'ScholarPress')}" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Editorial Support Email</label>
                <input name="support_email" value="${esc(settings.support_email || '')}" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Homepage Announcement / Featured Banner (optional)</label>
                <input name="announcement_banner" value="${esc(settings.announcement_banner || '')}" placeholder="Leave blank to hide announcement bar" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <label class="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                <input type="checkbox" name="require_content_approval" ${settings.require_content_approval !== 'false' ? 'checked' : ''} />
                <span>Require administrator approval before new creator submissions go live</span>
              </label>
              <button type="submit" class="px-5 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Save Website Settings</button>
            </form>
          </div>

          <div>
            <h2 class="font-display text-xl font-semibold text-slate-900 dark:text-white mb-4">Administrator Audit Trail</h2>
            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
              <table class="w-full min-w-[580px] text-left text-xs">
                <thead class="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th class="px-4 py-2.5 font-semibold">Timestamp</th>
                    <th class="px-4 py-2.5 font-semibold">Actor</th>
                    <th class="px-4 py-2.5 font-semibold">Action</th>
                    <th class="px-4 py-2.5 font-semibold">Entity</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                  ${logs
                    .map(
                      (l) => `
                    <tr>
                      <td class="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">${formatDate(l.createdAt)}</td>
                      <td class="px-4 py-2.5">${esc(l.actorName || 'System')}</td>
                      <td class="px-4 py-2.5 font-mono">${esc(l.action)}</td>
                      <td class="px-4 py-2.5 text-slate-500">${esc(l.entityType)}${l.entityId ? ` #${esc(l.entityId)}` : ''}</td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div class="flex flex-col lg:flex-row gap-5 lg:gap-8">
          <aside class="lg:w-64 shrink-0">
            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4">
              <div class="flex items-center justify-between gap-3 px-2 sm:px-3 pb-2.5 mb-2.5 border-b border-slate-100 dark:border-slate-800">
                <div class="min-w-0">
                  <div class="font-display font-semibold text-sm text-slate-900 dark:text-white">Admin Console</div>
                  <div class="text-xs text-slate-500 truncate">${esc(store.user.email)}</div>
                </div>
                <div class="flex lg:hidden items-center gap-2.5 shrink-0">
                  <a href="#/creator" class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white whitespace-nowrap">Creator</a>
                  <a href="#/dashboard" class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white whitespace-nowrap">Reader</a>
                </div>
              </div>
              <nav class="flex lg:flex-col gap-1.5 overflow-x-auto no-scrollbar touch-scroll-x pb-0.5 lg:pb-0">
                ${tabs
                  .map(
                    (t) => `
                  <a href="#/admin/${t.id}" class="flex items-center px-3 py-2 min-h-[40px] rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    activeTab === t.id
                      ? 'bg-[#0F2547] text-white dark:bg-sky-500 dark:text-slate-950'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }">${esc(t.label)}</a>
                `
                  )
                  .join('')}
              </nav>
              <div class="hidden lg:block pt-3 mt-3 border-t border-slate-100 dark:border-slate-800 space-y-1">
                <a href="#/creator" class="block px-3 py-1.5 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">Creator Studio →</a>
                <a href="#/dashboard" class="block px-3 py-1.5 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">Reader Dashboard →</a>
              </div>
            </div>
          </aside>
          <div class="flex-1 min-w-0">${bodyHtml}</div>
        </div>
      </div>
    `;

    wireAdminHandlers(container, activeTab, subParam);
  } catch (err) {
    container.innerHTML = `<div class="max-w-3xl mx-auto p-12 text-red-600">${esc(err.message)}</div>`;
  }
}

function wireAdminHandlers(container, activeTab, subParam = null) {
  // User Tracker search & dossier refresh
  document.getElementById('adm-tracker-search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = String(new FormData(e.target).get('q') || '').trim();
    if (!q) {
      window.location.hash = '#/admin/tracker';
      return;
    }
    // If exact 10-digit UID or starts with @, open direct dossier lookup immediately
    if (/^\d{10}$/.test(q) || q.startsWith('@')) {
      window.location.hash = `#/admin/tracker/${encodeURIComponent(q.replace(/^@+/, ''))}`;
    } else {
      window.location.hash = `#/admin/tracker?q=${encodeURIComponent(q)}`;
    }
  });

  document.getElementById('adm-dossier-refresh')?.addEventListener('click', () => {
    renderAdminDashboardPage(container, activeTab, subParam);
  });

  // Date filter
  document.getElementById('admin-date-filter')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const qs = new URLSearchParams();
    if (fd.get('from')) qs.set('from', String(fd.get('from')));
    if (fd.get('to')) qs.set('to', String(fd.get('to')));
    window.location.hash = `#/admin/overview${qs.toString() ? `?${qs}` : ''}`;
  });

  // User role & status changes
  container.querySelectorAll('.adm-user-role').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await apiFetch(`/api/admin/users/${sel.dataset.userId}`, {
          method: 'PATCH',
          body: { role: sel.value },
        });
        showToast('User role updated.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('.adm-user-status').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/api/admin/users/${btn.dataset.uid}`, {
          method: 'PATCH',
          body: { status: btn.dataset.status },
        });
        showToast(`Account set to ${btn.dataset.status}.`, 'success');
        renderAdminDashboardPage(container, activeTab);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // Creator verification & custom commission
  container.querySelectorAll('.adm-verify-creator').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/api/admin/users/${btn.dataset.uid}`, {
          method: 'PATCH',
          body: { verified: btn.dataset.verified === 'true' },
        });
        showToast('Creator verification updated.', 'success');
        renderAdminDashboardPage(container, activeTab);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('.adm-creator-comm-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = form.querySelector('input[name="rate"]').value.trim();
      try {
        await apiFetch(`/api/admin/users/${form.dataset.uid}`, {
          method: 'PATCH',
          body: { customCommissionRate: raw === '' ? null : Number(raw) },
        });
        showToast('Creator commission override saved.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // Content approve / feature / custom commission / reject
  container.querySelectorAll('.adm-content-mod').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/api/admin/contents/${btn.dataset.cid}`, {
          method: 'PATCH',
          body: { status: btn.dataset.status },
        });
        showToast('Publication approved and live.', 'success');
        renderAdminDashboardPage(container, activeTab);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('.adm-content-feat').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/api/admin/contents/${btn.dataset.cid}`, {
          method: 'PATCH',
          body: { isFeatured: btn.dataset.featured === 'true' },
        });
        showToast('Featured status updated.', 'success');
        renderAdminDashboardPage(container, activeTab);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('.adm-content-comm-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = form.querySelector('input[name="rate"]').value.trim();
      try {
        await apiFetch(`/api/admin/contents/${form.dataset.cid}`, {
          method: 'PATCH',
          body: { customCommissionRate: raw === '' ? null : Number(raw) },
        });
        showToast('Content commission override updated.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('.adm-content-reject').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetStatus = btn.dataset.status;
      openModal({
        title: targetStatus === 'rejected' ? 'Reject Submission' : 'Remove Publication',
        bodyHtml: `
          <form id="adm-reject-modal-form" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold mb-1">Moderator Reason (sent to creator)</label>
              <textarea name="reason" rows="3" required placeholder="Explain what needs correction or why this content violates policy..." class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]"></textarea>
            </div>
            <div class="flex justify-end">
              <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-red-700 text-white">Confirm ${esc(targetStatus)}</button>
            </div>
          </form>
        `,
        onMount: (close) => {
          document.getElementById('adm-reject-modal-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const reason = new FormData(e.target).get('reason');
            try {
              await apiFetch(`/api/admin/contents/${btn.dataset.cid}`, {
                method: 'PATCH',
                body: { status: targetStatus, rejectionReason: reason },
              });
              showToast(`Publication marked ${targetStatus}.`, 'success');
              close();
              renderAdminDashboardPage(container, activeTab);
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        },
      });
    });
  });

  // Categories & subjects
  document.getElementById('adm-add-cat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiFetch('/api/admin/categories', { method: 'POST', body: Object.fromEntries(fd.entries()) });
      await loadGlobalCatalogMeta();
      showToast('Category added.', 'success');
      renderAdminDashboardPage(container, activeTab);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('adm-add-subj-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiFetch('/api/admin/subjects', { method: 'POST', body: Object.fromEntries(fd.entries()) });
      await loadGlobalCatalogMeta();
      showToast('Subject added.', 'success');
      renderAdminDashboardPage(container, activeTab);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.querySelectorAll('.adm-del-cat').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/api/admin/categories/${btn.dataset.catid}`, { method: 'DELETE' });
        await loadGlobalCatalogMeta();
        showToast('Category deleted.', 'success');
        renderAdminDashboardPage(container, activeTab);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('.adm-del-subj').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/api/admin/subjects/${btn.dataset.sid}`, { method: 'DELETE' });
        await loadGlobalCatalogMeta();
        showToast('Subject deleted.', 'success');
        renderAdminDashboardPage(container, activeTab);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // Refunds
  container.querySelectorAll('.adm-refund-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal({
        title: 'Issue Payment Refund & Reverse Earnings',
        bodyHtml: `
          <form id="adm-refund-modal-form" class="space-y-4">
            <p class="text-xs text-slate-500">Refunding revokes buyer access, marks the commission record reversed, and deducts the credited amount from the creator's wallet.</p>
            <div>
              <label class="block text-xs font-semibold mb-1">Refund Reason</label>
              <input name="reason" required placeholder="e.g. Duplicate charge / Buyer requested refund" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div class="flex justify-end">
              <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-red-700 text-white">Confirm Refund</button>
            </div>
          </form>
        `,
        onMount: (close) => {
          document.getElementById('adm-refund-modal-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const reason = new FormData(e.target).get('reason');
            try {
              const res = await apiFetch(`/api/admin/payments/${btn.dataset.pid}/refund`, {
                method: 'POST',
                body: { reason },
              });
              showToast(res.message, 'success');
              close();
              renderAdminDashboardPage(container, activeTab);
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        },
      });
    });
  });

  // Commission live simulator & save
  const rangeEl = document.getElementById('adm-comm-range');
  const updateCommPreview = () => {
    if (!rangeEl) return;
    const r = Number(rangeEl.value);
    const disp = document.getElementById('adm-comm-display');
    const ex = document.getElementById('adm-comm-example');
    if (disp) disp.textContent = `${r}%`;
    if (ex) {
      ex.innerHTML = `
        <div>Example on a ₹100 sale:</div>
        <div>Platform Commission (${r}%): <strong>₹${r.toFixed(2)}</strong> · Creator Earnings: <strong class="text-emerald-700 dark:text-emerald-400">₹${(100 - r).toFixed(2)}</strong></div>
      `;
    }
  };
  rangeEl?.addEventListener('input', updateCommPreview);
  updateCommPreview();

  document.getElementById('adm-comm-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: {
          settings: {
            default_commission_rate: fd.get('default_commission_rate'),
            min_withdrawal_inr: fd.get('min_withdrawal_inr'),
          },
        },
      });
      showToast(res.message, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Withdrawals
  container.querySelectorAll('.adm-wd-action').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const res = await apiFetch(`/api/admin/withdrawals/${btn.dataset.wid}`, {
          method: 'PATCH',
          body: { action: btn.dataset.act },
        });
        showToast(res.message, 'success');
        renderAdminDashboardPage(container, activeTab);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('.adm-wd-paid').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal({
        title: 'Confirm Payout Disbursement',
        bodyHtml: `
          <form id="adm-wd-paid-form" class="space-y-4">
            <p class="text-xs text-slate-500">Only mark this withdrawal as Paid after the actual UPI or NEFT/IMPS transfer has completed.</p>
            <div>
              <label class="block text-xs font-semibold mb-1">Bank UTR / UPI Transaction Reference ID</label>
              <input name="payoutReference" required minlength="4" placeholder="e.g. UTR432198765432" class="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div class="flex justify-end">
              <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-700 text-white">Mark Paid</button>
            </div>
          </form>
        `,
        onMount: (close) => {
          document.getElementById('adm-wd-paid-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payoutReference = new FormData(e.target).get('payoutReference');
            try {
              const res = await apiFetch(`/api/admin/withdrawals/${btn.dataset.wid}`, {
                method: 'PATCH',
                body: { action: 'paid', payoutReference },
              });
              showToast(res.message, 'success');
              close();
              renderAdminDashboardPage(container, activeTab);
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        },
      });
    });
  });

  container.querySelectorAll('.adm-wd-reject').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal({
        title: 'Reject Withdrawal Request',
        bodyHtml: `
          <form id="adm-wd-rej-form" class="space-y-4">
            <p class="text-xs text-slate-500">The held amount will be returned immediately to the creator's Available Balance.</p>
            <div>
              <label class="block text-xs font-semibold mb-1">Reason for Rejection</label>
              <input name="adminNote" required placeholder="e.g. Invalid IFSC code or unverified UPI ID" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div class="flex justify-end">
              <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-red-700 text-white">Reject &amp; Restore Balance</button>
            </div>
          </form>
        `,
        onMount: (close) => {
          document.getElementById('adm-wd-rej-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const adminNote = new FormData(e.target).get('adminNote');
            try {
              const res = await apiFetch(`/api/admin/withdrawals/${btn.dataset.wid}`, {
                method: 'PATCH',
                body: { action: 'reject', adminNote },
              });
              showToast(res.message, 'success');
              close();
              renderAdminDashboardPage(container, activeTab);
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        },
      });
    });
  });

  // Reports moderation
  container.querySelectorAll('.adm-report-resolve').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const removeContent = btn.dataset.remove === 'true';
      const status = btn.dataset.st || 'resolved';
      try {
        await apiFetch(`/api/admin/reports/${btn.dataset.rid}`, {
          method: 'PATCH',
          body: {
            status,
            removeContent,
            resolutionNote: removeContent
              ? 'Content removed by administrator following review.'
              : 'Report dismissed after review.',
          },
        });
        showToast('Report updated.', 'success');
        renderAdminDashboardPage(container, activeTab);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // Broadcast notifications
  document.getElementById('adm-broadcast-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await apiFetch('/api/admin/notifications/broadcast', {
        method: 'POST',
        body: Object.fromEntries(fd.entries()),
      });
      showToast(res.message, 'success');
      e.target.reset();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Website settings
  document.getElementById('adm-site-settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: {
          settings: {
            site_name: fd.get('site_name'),
            support_email: fd.get('support_email'),
            announcement_banner: fd.get('announcement_banner'),
            require_content_approval: fd.get('require_content_approval') === 'on' ? 'true' : 'false',
          },
        },
      });
      showToast(res.message, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function renderRevenueSvgChart(series) {
  if (!series.length) {
    return `<div class="py-10 text-center text-xs text-slate-500">No settled paid transactions yet in the selected period. Completed purchases will populate this chart automatically.</div>`;
  }
  const maxVal = Math.max(100, ...series.map((s) => s.gross));
  const barGroupW = 84;
  const chartW = Math.max(480, series.length * barGroupW + 60);
  const chartH = 210;
  const padBottom = 32;
  const plotH = chartH - padBottom - 16;

  const bars = series
    .map((s, i) => {
      const x = 40 + i * barGroupW;
      const hGross = Math.max(4, (s.gross / maxVal) * plotH);
      const hCreator = Math.max(2, (s.creatorEarnings / maxVal) * plotH);
      const hComm = Math.max(2, (s.commission / maxVal) * plotH);
      return `
        <g>
          <rect x="${x}" y="${16 + plotH - hGross}" width="18" height="${hGross}" rx="3" fill="#0F2547" class="dark:fill-sky-400" />
          <rect x="${x + 21}" y="${16 + plotH - hCreator}" width="18" height="${hCreator}" rx="3" fill="#047857" class="dark:fill-emerald-400" />
          <rect x="${x + 42}" y="${16 + plotH - hComm}" width="18" height="${hComm}" rx="3" fill="#D97706" class="dark:fill-amber-400" />
          <text x="${x + 30}" y="${chartH - 10}" text-anchor="middle" font-size="11" fill="currentColor" class="text-slate-500 font-mono">${esc(s.month)}</text>
        </g>
      `;
    })
    .join('');

  return `
    <div class="overflow-x-auto">
      <svg viewBox="0 0 ${chartW} ${chartH}" class="w-full max-w-full h-56">
        <line x1="30" y1="${16 + plotH}" x2="${chartW - 10}" y2="${16 + plotH}" stroke="currentColor" class="text-slate-200 dark:text-slate-800" stroke-width="1" />
        ${bars}
      </svg>
    </div>
  `;
}
