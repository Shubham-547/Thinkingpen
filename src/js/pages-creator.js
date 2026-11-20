import {
  apiFetch,
  CONTENT_TYPES,
  esc,
  formatBytes,
  formatDate,
  formatDateTime,
  formatInr,
  formatRelativeAge,
  LANGUAGES,
  loadGlobalCatalogMeta,
  notifyStore,
  openModal,
  PRESET_COVERS,
  renderStatusLabel,
  resolveVideoEmbed,
  showToast,
  store,
} from './api.js';

export async function renderCreatorDashboardPage(container, activeTab = 'overview', editId = null) {
  if (!store.user) {
    window.location.hash = '#/login';
    return;
  }
  if (store.user.role !== 'creator' && store.user.role !== 'admin') {
    window.location.hash = '#/become-creator';
    return;
  }

  container.innerHTML = `<div class="max-w-7xl mx-auto px-4 py-12 text-sm text-slate-500">Loading Creator Studio...</div>`;

  try {
    const [data, editPayload, historyPayload] = await Promise.all([
      apiFetch('/api/creator/dashboard'),
      activeTab === 'upload' && editId ? apiFetch(`/api/creator/contents/${editId}`) : Promise.resolve(null),
      activeTab === 'history' ? apiFetch('/api/creator/history') : Promise.resolve(null),
      activeTab === 'upload' && (!store.categories?.length || !store.subjects?.length)
        ? loadGlobalCatalogMeta()
        : Promise.resolve(null),
    ]);

    const deletedCount = Number(data.analytics?.deletedCount || 0);
    const tabs = [
      { id: 'overview', label: 'Overview' },
      { id: 'upload', label: editId ? 'Edit Content' : 'Upload Content' },
      { id: 'published', label: 'Published Content' },
      { id: 'drafts', label: 'Drafts' },
      { id: 'pending', label: 'Pending & Review' },
      { id: 'history', label: deletedCount > 0 ? `History & Recovery (${deletedCount})` : 'History & Recovery' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'earnings', label: 'Earnings' },
      { id: 'wallet', label: 'Wallet & Payouts' },
      { id: 'withdrawals', label: 'Withdrawal Requests' },
      { id: 'transactions', label: 'Transactions' },
      { id: 'profile', label: 'Creator Profile' },
    ];

    const wallet = data.wallet || {
      totalEarningsInr: '0.00',
      pendingEarningsInr: '0.00',
      availableBalanceInr: '0.00',
      withdrawnAmountInr: '0.00',
    };
    const commRate = Number(data.effectiveCommissionRate || 10);

    let bodyHtml = '';

    if (activeTab === 'overview') {
      bodyHtml = `
        <div class="space-y-8">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">Creator Studio</h1>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Active platform commission rate: <strong class="font-mono text-slate-900 dark:text-white">${commRate}%</strong> · You earn <strong class="font-mono text-emerald-700 dark:text-emerald-400">${(100 - commRate).toFixed(1)}%</strong> per paid sale.
              </p>
            </div>
            <a href="#/creator/upload" class="px-4 py-2.5 text-xs font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 text-white dark:text-slate-950 whitespace-nowrap shrink-0">
              + Publish New Content
            </a>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500 dark:text-slate-400">Available Balance</div>
              <div class="font-mono text-2xl font-semibold text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">${formatInr(wallet.availableBalanceInr)}</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500 dark:text-slate-400">Total Lifetime Earnings</div>
              <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${formatInr(wallet.totalEarningsInr)}</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500 dark:text-slate-400">Published / Pending</div>
              <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${data.analytics.publishedCount} / ${data.analytics.pendingCount}</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500 dark:text-slate-400">Total Views / Sales</div>
              <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${data.analytics.totalViews} / ${data.analytics.totalPurchases}</div>
            </div>
          </div>

          <div>
            <div class="flex items-baseline justify-between mb-4">
              <h2 class="font-display text-xl font-semibold text-slate-900 dark:text-white">Your Recent Works</h2>
              <a href="#/creator/published" class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">Manage all →</a>
            </div>
            ${renderCreatorContentTable(data.contents.slice(0, 6))}
          </div>
        </div>
      `;
    } else if (activeTab === 'upload') {
      bodyHtml = renderContentEditorHtml(editPayload, commRate);
    } else if (activeTab === 'published') {
      const list = data.contents.filter((c) => c.status === 'approved');
      bodyHtml = `
        <div>
          <div class="flex items-center justify-between mb-6">
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Published Content (${list.length})</h1>
            <a href="#/creator/upload" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">+ New Publication</a>
          </div>
          ${renderCreatorContentTable(list)}
        </div>
      `;
    } else if (activeTab === 'drafts') {
      const list = data.contents.filter((c) => c.status === 'draft');
      bodyHtml = `
        <div>
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-6">Saved Drafts (${list.length})</h1>
          ${renderCreatorContentTable(list)}
        </div>
      `;
    } else if (activeTab === 'pending') {
      const list = data.contents.filter((c) => c.status === 'pending' || c.status === 'rejected' || c.status === 'removed');
      bodyHtml = `
        <div>
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-6">Pending Approval &amp; Moderation Notes (${list.length})</h1>
          ${renderCreatorContentTable(list, true)}
        </div>
      `;
    } else if (activeTab === 'history') {
      bodyHtml = renderCreatorHistoryHtml(historyPayload || { deletedContents: [], history: [], retentionDays: 15 });
    } else if (activeTab === 'analytics') {
      const maxViews = Math.max(1, ...data.contents.map((c) => c.viewsCount || 0));
      bodyHtml = `
        <div class="space-y-6">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Content Performance Analytics</h1>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500">Total Views</div>
              <div class="font-mono text-2xl font-semibold mt-1 tabular-nums">${data.analytics.totalViews}</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500">Total Likes</div>
              <div class="font-mono text-2xl font-semibold mt-1 tabular-nums">${data.analytics.totalLikes}</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500">Total Paid Conversions</div>
              <div class="font-mono text-2xl font-semibold mt-1 tabular-nums">${data.analytics.totalPurchases}</div>
            </div>
          </div>

          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6">
            <h2 class="text-sm font-semibold text-slate-900 dark:text-white mb-4">Views &amp; Conversion Breakdown by Publication</h2>
            ${
              data.contents.length
                ? `<div class="space-y-4">
                    ${data.contents
                      .map((c) => {
                        const pct = Math.max(4, Math.round((c.viewsCount / maxViews) * 100));
                        return `
                          <div>
                            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs mb-1.5">
                              <span class="font-medium text-slate-900 dark:text-slate-100 truncate sm:pr-4">${esc(c.title)}</span>
                              <span class="font-mono text-slate-500 tabular-nums shrink-0">${c.viewsCount} views · ${c.likesCount} likes · ${c.purchasesCount} sales · ★ ${Number(c.avgRating).toFixed(1)}</span>
                            </div>
                            <div class="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div class="h-full bg-[#0F2547] dark:bg-sky-400 rounded-full" style="width:${pct}%"></div>
                            </div>
                          </div>
                        `;
                      })
                      .join('')}
                  </div>`
                : `<p class="text-sm text-slate-500">Publish content to view readership analytics.</p>`
            }
          </div>
        </div>
      `;
    } else if (activeTab === 'earnings') {
      bodyHtml = `
        <div class="space-y-6">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Earnings &amp; Commission Breakdown</h1>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[640px] text-left text-sm">
              <thead class="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th class="px-4 py-3 font-semibold">Date</th>
                  <th class="px-4 py-3 font-semibold">Publication</th>
                  <th class="px-4 py-3 font-semibold text-right">Sale Price</th>
                  <th class="px-4 py-3 font-semibold text-right">Commission</th>
                  <th class="px-4 py-3 font-semibold text-right">Your Earnings</th>
                  <th class="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                ${
                  data.commissions.length
                    ? data.commissions
                        .map(
                          (cm) => `
                      <tr>
                        <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${formatDate(cm.createdAt)}</td>
                        <td class="px-4 py-3 font-medium">${esc(cm.contentTitle)}</td>
                        <td class="px-4 py-3 text-right font-mono tabular-nums">${formatInr(cm.grossAmountInr)}</td>
                        <td class="px-4 py-3 text-right font-mono text-xs text-slate-500 tabular-nums">${formatInr(cm.platformCommissionInr)} (${Number(cm.commissionRate)}%)</td>
                        <td class="px-4 py-3 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">${formatInr(cm.creatorEarningsInr)}</td>
                        <td class="px-4 py-3">${renderStatusLabel(cm.status)}</td>
                      </tr>
                    `
                        )
                        .join('')
                    : `<tr><td colspan="6" class="px-4 py-8 text-center text-slate-500">No paid sales recorded yet.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      `;
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
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div class="flex flex-col lg:flex-row gap-5 lg:gap-8">
          <aside class="lg:w-60 shrink-0">
            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4">
              <div class="flex items-center justify-between gap-3 px-2 sm:px-3 pb-2.5 mb-2.5 border-b border-slate-100 dark:border-slate-800">
                <div class="min-w-0">
                  <div class="font-semibold text-sm text-slate-900 dark:text-white truncate">${esc(data.profile?.displayName || store.user.name)}</div>
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
          <div class="flex-1 min-w-0">${bodyHtml}</div>
        </div>
      </div>
    `;

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
      wireCreatorHistoryHandlers(container, historyPayload || { deletedContents: [], history: [] });
    }

    // Wire Upload / Editor studio if active
    if (activeTab === 'upload') {
      wireContentEditor(container, editPayload, commRate);
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
    container.innerHTML = `<div class="max-w-3xl mx-auto p-12 text-red-600">${esc(err.message)}</div>`;
  }
}

function renderCreatorContentTable(list, showNotes = false) {
  return `
    <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
      <table class="w-full min-w-[640px] text-left text-sm">
        <thead class="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
          <tr>
            <th class="px-4 py-3 font-semibold">Title &amp; Type</th>
            <th class="px-4 py-3 font-semibold">Pricing</th>
            <th class="px-4 py-3 font-semibold">Status</th>
            <th class="px-4 py-3 font-semibold text-right">Views / Sales</th>
            ${showNotes ? '<th class="px-4 py-3 font-semibold">Moderator Note</th>' : ''}
            <th class="px-4 py-3 font-semibold text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
          ${
            list.length
              ? list
                  .map(
                    (c) => `
                <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                  <td class="px-4 py-3">
                    <a href="#/content/${esc(c.slug)}" class="font-medium text-slate-900 dark:text-white hover:underline block">${esc(c.title)}</a>
                    <span class="text-xs text-slate-500">${esc(c.contentType)} · ${esc(c.categoryName || 'Uncategorized')}${c.authorName ? ` · Author: ${esc(c.authorName)}` : ''}</span>
                  </td>
                  <td class="px-4 py-3 font-mono text-xs tabular-nums">${c.isFree ? 'Free' : formatInr(c.priceInr)}</td>
                  <td class="px-4 py-3">${renderStatusLabel(c.status)}</td>
                  <td class="px-4 py-3 text-right font-mono text-xs tabular-nums">${c.viewsCount} / ${c.purchasesCount}</td>
                  ${showNotes ? `<td class="px-4 py-3 text-xs text-red-600 dark:text-red-400">${esc(c.rejectionReason || '—')}</td>` : ''}
                  <td class="px-4 py-3 text-right whitespace-nowrap space-x-3 text-xs font-semibold">
                    <a href="#/creator/edit/${c.id}" class="text-[#0F2547] dark:text-sky-400 hover:underline">Edit</a>
                    <a href="#/content/${esc(c.slug)}" class="text-slate-600 dark:text-slate-300 hover:underline">View</a>
                    <button type="button" data-id="${c.id}" class="creator-delete-btn text-red-600 dark:text-red-400 hover:underline" title="Move to 15-day Recovery Bin">Delete</button>
                  </td>
                </tr>
              `
                  )
                  .join('')
              : `<tr><td colspan="${showNotes ? 6 : 5}" class="px-4 py-8 text-center text-slate-500">No publications in this view yet.</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderContentEditorHtml(editPayload, commRate) {
  const item = editPayload?.content || null;
  const files = editPayload?.files || [];
  const existingExternalVideoUrl =
    files.find((f) => f.fileType === 'video' && f.externalVideoUrl)?.externalVideoUrl || '';
  const isPaid = item ? !item.isFree : false;
  const currentPrice = item ? Number(item.priceInr) : 49;

  return `
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">${item ? 'Edit Publication' : 'Publish New Educational Content'}</h1>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Select format, write rich text or attach PDFs/videos, configure Free or INR pricing, and preview before submission.</p>
        </div>
        <button type="button" id="ed-preview-btn" class="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">
          Preview Content
        </button>
      </div>

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
          <button type="button" id="ed-save-draft" class="w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">Save as Draft</button>
          <button type="button" id="ed-submit-publish" class="w-full sm:w-auto min-h-[44px] px-6 py-2.5 text-xs font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950">
            ${item ? 'Save & Submit for Approval' : 'Submit for Approval'}
          </button>
        </div>
      </form>
    </div>
  `;
}

function wireContentEditor(container, editPayload, commRate) {
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
            <img src="${previewUrl}" alt="${esc(f.name)}" class="w-full h-full object-cover" />
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
    queuedUploadFiles.push(...accepted);
    if (incoming.length > BATCH_PICK_LIMIT) {
      showToast(`Added ${accepted.length} files. Click Attach again to add more.`, 'info');
    } else {
      showToast(`${accepted.length} file${accepted.length > 1 ? 's' : ''} added.`, 'success');
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

  // Upload queued files in chunks of 20 so creators can attach unlimited total files across clicks
  const uploadAttachedFilesBatch = async (contentId) => {
    if (!queuedUploadFiles.length) return null;
    let totalUploaded = 0;
    for (let i = 0; i < queuedUploadFiles.length; i += BATCH_PICK_LIMIT) {
      const chunk = queuedUploadFiles.slice(i, i + BATCH_PICK_LIMIT);
      const fd = new FormData();
      for (const f of chunk) {
        fd.append('files', f);
      }
      fd.append('isPreview', 'false');
      const res = await apiFetch(`/api/creator/contents/${contentId}/files/batch`, {
        method: 'POST',
        body: fd,
      });
      totalUploaded += Number(res?.count || chunk.length);
    }
    queuedUploadFiles = [];
    renderQueuedFiles();
    return { count: totalUploaded, message: `${totalUploaded} file${totalUploaded === 1 ? '' : 's'} uploaded successfully.` };
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
    if (draftBtn) draftBtn.disabled = true;
    if (pubBtn) {
      pubBtn.disabled = true;
      pubBtn.textContent = queuedUploadFiles.length
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
      window.location.hash = action === 'draft' ? '#/creator/drafts' : '#/creator/overview';
    } catch (err) {
      showToast(err.message, 'error');
      if (draftBtn) draftBtn.disabled = false;
      if (pubBtn) {
        pubBtn.disabled = false;
        pubBtn.textContent = editingId ? 'Save & Submit for Approval' : 'Submit for Approval';
      }
    }
  };

  document.getElementById('ed-save-draft')?.addEventListener('click', () => saveContent('draft'));
  document.getElementById('ed-submit-publish')?.addEventListener('click', () => saveContent('submit'));
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

function renderCreatorHistoryHtml(payload) {
  const deletedList = payload.deletedContents || [];
  const historyList = payload.history || [];
  const retentionDays = Number(payload.retentionDays || 15);

  const actionMeta = {
    created: { label: 'Created', cls: 'text-sky-700 dark:text-sky-400' },
    updated: { label: 'Updated', cls: 'text-slate-700 dark:text-slate-300' },
    deleted: { label: 'Deleted (15d Bin)', cls: 'text-amber-700 dark:text-amber-400' },
    recovered: { label: 'Recovered', cls: 'text-emerald-700 dark:text-emerald-400' },
    permanently_deleted: { label: 'Deleted Forever', cls: 'text-red-700 dark:text-red-400' },
    auto_purged: { label: 'Auto-Purged (15d)', cls: 'text-red-700 dark:text-red-400' },
  };

  return `
    <div class="space-y-8">
      <div>
        <h1 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">History &amp; 15-Day Recovery Bin</h1>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Deleted content is safely kept in the database for <strong>${retentionDays} days</strong>. You can inspect details and recover any deleted work before its countdown expires.
        </p>
      </div>

      <!-- 15-Day Deleted Content Recovery Bin -->
      <section class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Deleted Content — Recoverable (${deletedList.length})</h2>
          <span class="text-xs font-mono text-amber-700 dark:text-amber-400">Auto-deletes permanently after 15 days</span>
        </div>

        <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
          <table class="w-full min-w-[760px] text-left text-xs">
            <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
              <tr>
                <th class="px-4 py-3 font-semibold">Deleted Content</th>
                <th class="px-4 py-3 font-semibold">Deleted On &amp; Age</th>
                <th class="px-4 py-3 font-semibold">Recovery Window</th>
                <th class="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              ${
                deletedList.length
                  ? deletedList
                      .map(
                        (item) => `
                    <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                      <td class="px-4 py-3">
                        <div class="font-semibold text-slate-900 dark:text-white">${esc(item.title)}</div>
                        <div class="text-[11px] text-slate-500 mt-0.5">
                          ${esc(item.contentType)} · ${esc(item.categoryName || 'Uncategorized')}
                          ${item.authorName ? ` · Author: ${esc(item.authorName)}` : ''}
                          · ${item.isFree ? 'Free' : formatInr(item.priceInr)}
                        </div>
                      </td>
                      <td class="px-4 py-3 whitespace-nowrap">
                        <div class="font-semibold text-slate-800 dark:text-slate-200">${esc(formatRelativeAge(item.deletedAt))}</div>
                        <div class="text-[11px] font-mono text-slate-500">${esc(formatDateTime(item.deletedAt))}</div>
                      </td>
                      <td class="px-4 py-3 whitespace-nowrap">
                        <div class="font-mono font-semibold text-amber-700 dark:text-amber-400">${esc(formatRecoveryCountdown(item.purgeAfter))}</div>
                        <div class="text-[11px] text-slate-500">Expires ${esc(formatDate(item.purgeAfter))}</div>
                      </td>
                      <td class="px-4 py-3 text-right whitespace-nowrap space-x-2.5 font-semibold">
                        <button type="button" data-del-detail-id="${item.id}" class="cr-deleted-detail text-slate-600 dark:text-slate-300 hover:underline">Details</button>
                        <button type="button" data-recover-id="${item.id}" class="cr-recover-btn px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white">Recover</button>
                        <button type="button" data-perm-del-id="${item.id}" class="cr-perm-delete-btn text-red-600 dark:text-red-400 hover:underline">Delete Forever</button>
                      </td>
                    </tr>
                  `
                      )
                      .join('')
                  : `<tr><td colspan="4" class="px-4 py-10 text-center text-slate-500">Your 15-day Recovery Bin is empty. Any deleted publication will appear here for 15 days.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- Complete Creator Activity History Log -->
      <section class="space-y-3">
        <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Content Activity History (${historyList.length})</h2>
        <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
          <table class="w-full min-w-[700px] text-left text-xs">
            <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
              <tr>
                <th class="px-4 py-3 font-semibold">Event</th>
                <th class="px-4 py-3 font-semibold">Publication</th>
                <th class="px-4 py-3 font-semibold">Date, Time &amp; Age</th>
                <th class="px-4 py-3 font-semibold text-right">Details</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              ${
                historyList.length
                  ? historyList
                      .map((h) => {
                        const meta = actionMeta[h.action] || { label: h.action, cls: 'text-slate-600 dark:text-slate-300' };
                        return `
                          <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                            <td class="px-4 py-3 font-semibold ${meta.cls} whitespace-nowrap">${esc(meta.label)}</td>
                            <td class="px-4 py-3">
                              <div class="font-medium text-slate-900 dark:text-white">${esc(h.contentTitle)}</div>
                              <div class="text-[11px] text-slate-500">${esc(h.contentType || 'Publication')}${h.authorName ? ` · Author: ${esc(h.authorName)}` : ''}</div>
                            </td>
                            <td class="px-4 py-3 whitespace-nowrap">
                              <div class="font-medium text-slate-800 dark:text-slate-200">${esc(formatRelativeAge(h.createdAt))}</div>
                              <div class="text-[11px] font-mono text-slate-500">${esc(formatDateTime(h.createdAt))}</div>
                            </td>
                            <td class="px-4 py-3 text-right whitespace-nowrap">
                              <button type="button" data-hist-id="${h.id}" class="cr-hist-detail font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">Details</button>
                            </td>
                          </tr>
                        `;
                      })
                      .join('')
                  : `<tr><td colspan="4" class="px-4 py-8 text-center text-slate-500">No history events recorded yet.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function wireCreatorHistoryHandlers(container, payload) {
  const deletedList = payload.deletedContents || [];
  const historyList = payload.history || [];

  container.querySelectorAll('.cr-recover-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.recoverId;
      btn.disabled = true;
      btn.textContent = 'Recovering...';
      try {
        const res = await apiFetch(`/api/creator/contents/${id}/recover`, { method: 'POST' });
        showToast(res.message || 'Content recovered successfully!', 'success');
        renderCreatorDashboardPage(container, 'history');
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Recover';
      }
    });
  });

  container.querySelectorAll('.cr-perm-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.permDelId);
      const item = deletedList.find((d) => Number(d.id) === id);
      openModal({
        title: 'Delete Permanently?',
        bodyHtml: `
          <div class="space-y-4 text-xs">
            <p class="text-slate-600 dark:text-slate-300 leading-relaxed">
              Are you sure you want to permanently erase <strong>${esc(item?.title || 'this content')}</strong>? Once permanently deleted, it cannot be recovered.
            </p>
            <div class="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button type="button" id="cr-perm-cancel" class="px-3.5 py-2 font-semibold rounded-lg border border-slate-300 dark:border-slate-700">Cancel</button>
              <button type="button" id="cr-perm-confirm" class="px-4 py-2 font-semibold rounded-lg bg-red-700 hover:bg-red-800 text-white">Delete Permanently</button>
            </div>
          </div>
        `,
        onMount: (close) => {
          document.getElementById('cr-perm-cancel')?.addEventListener('click', close);
          document.getElementById('cr-perm-confirm')?.addEventListener('click', async () => {
            try {
              const res = await apiFetch(`/api/creator/contents/${id}/permanent`, { method: 'DELETE' });
              showToast(res.message || 'Permanently deleted.', 'success');
              close();
              renderCreatorDashboardPage(container, 'history');
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        },
      });
    });
  });

  container.querySelectorAll('.cr-deleted-detail').forEach((btn) => {
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

  container.querySelectorAll('.cr-hist-detail').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.histId);
      const h = historyList.find((x) => Number(x.id) === id);
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
}
