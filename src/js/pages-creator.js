import {
  apiFetch,
  CONTENT_TYPES,
  esc,
  formatBytes,
  formatDate,
  formatInr,
  LANGUAGES,
  notifyStore,
  openModal,
  PRESET_COVERS,
  renderStatusLabel,
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

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'upload', label: editId ? 'Edit Content' : 'Upload Content' },
    { id: 'published', label: 'Published Content' },
    { id: 'drafts', label: 'Drafts' },
    { id: 'pending', label: 'Pending & Review' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'earnings', label: 'Earnings' },
    { id: 'wallet', label: 'Wallet & Payouts' },
    { id: 'withdrawals', label: 'Withdrawal Requests' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'profile', label: 'Creator Profile' },
  ];

  container.innerHTML = `<div class="max-w-7xl mx-auto px-4 py-12 text-sm text-slate-500">Loading Creator Studio...</div>`;

  try {
    const data = await apiFetch('/api/creator/dashboard');
    let editPayload = null;
    if (activeTab === 'upload' && editId) {
      editPayload = await apiFetch(`/api/creator/contents/${editId}`);
    }

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

    // Wire table actions (Edit / Delete)
    container.querySelectorAll('.creator-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch(`/api/creator/contents/${btn.dataset.id}`, { method: 'DELETE' });
          showToast('Publication deleted.', 'success');
          renderCreatorDashboardPage(container, activeTab);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

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
                    <span class="text-xs text-slate-500">${esc(c.contentType)} · ${esc(c.categoryName || 'Uncategorized')}</span>
                  </td>
                  <td class="px-4 py-3 font-mono text-xs tabular-nums">${c.isFree ? 'Free' : formatInr(c.priceInr)}</td>
                  <td class="px-4 py-3">${renderStatusLabel(c.status)}</td>
                  <td class="px-4 py-3 text-right font-mono text-xs tabular-nums">${c.viewsCount} / ${c.purchasesCount}</td>
                  ${showNotes ? `<td class="px-4 py-3 text-xs text-red-600 dark:text-red-400">${esc(c.rejectionReason || '—')}</td>` : ''}
                  <td class="px-4 py-3 text-right whitespace-nowrap space-x-3 text-xs font-semibold">
                    <a href="#/creator/edit/${c.id}" class="text-[#0F2547] dark:text-sky-400 hover:underline">Edit</a>
                    <a href="#/content/${esc(c.slug)}" class="text-slate-600 dark:text-slate-300 hover:underline">View</a>
                    <button type="button" data-id="${c.id}" class="creator-delete-btn text-red-600 dark:text-red-400 hover:underline">Delete</button>
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
          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Category</label>
            <select name="categoryId" id="ed-category" class="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
              <option value="">Select category...</option>
              ${store.categories.map((c) => `<option value="${c.id}" ${item?.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Subject</label>
            <select name="subjectId" id="ed-subject" class="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
              <option value="">Select subject...</option>
              ${store.subjects.map((s) => `<option value="${s.id}" data-cat="${s.categoryId}" ${item?.subjectId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
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

        <!-- Cover Artwork Selection -->
        <div class="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Cover Image / Thumbnail</label>
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
          <input name="coverImageUrl" id="ed-cover-url" value="${esc(item?.coverImageUrl || PRESET_COVERS[0].url)}" placeholder="Or paste image URL / upload cover file below" class="w-full px-3.5 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
        </div>

        <!-- Rich-Text Editorial Studio -->
        <div class="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Full Content (Rich-Text Editor)</label>
          <div class="border border-slate-300 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-[#0B1120]">
            <div class="flex items-center gap-1 p-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111A2E] overflow-x-auto no-scrollbar touch-scroll-x">
              <button type="button" data-cmd="formatBlock" data-val="H2" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs font-semibold rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">H2</button>
              <button type="button" data-cmd="formatBlock" data-val="H3" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs font-semibold rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">H3</button>
              <button type="button" data-cmd="formatBlock" data-val="P" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">Paragraph</button>
              <button type="button" data-cmd="bold" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs font-bold rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">B</button>
              <button type="button" data-cmd="italic" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs italic rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">I</button>
              <button type="button" data-cmd="insertUnorderedList" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">• List</button>
              <button type="button" data-cmd="insertOrderedList" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">1. List</button>
              <button type="button" data-cmd="formatBlock" data-val="BLOCKQUOTE" class="rte-btn min-h-[34px] px-2.5 py-1 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">Quote</button>
              <button type="button" id="rte-insert-code" class="min-h-[34px] px-2.5 py-1 text-xs font-mono rounded hover:bg-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0">Code</button>
            </div>
            <div id="ed-rte" contenteditable="true" data-placeholder="Write your notes, article, poem, story, or lecture transcript here. Use H2 headings to auto-generate a Table of Contents..." class="sp-rte-editor reading-prose p-4 sm:p-5 max-w-none">${item?.bodyHtml || ''}</div>
          </div>
        </div>

        <!-- Authorized Video URL (optional) -->
        <div>
          <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Authorized Video Embed URL (optional, for Video Lectures / Tutorials)</label>
          <input name="externalVideoUrl" id="ed-video-url" placeholder="https://www.youtube.com/embed/... or authorized video embed link" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
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

        <!-- File Attachments (PDFs, Videos, Docs, Custom Cover) -->
        <div class="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Attach Protected PDF, Video, Document, or Cover Image</label>
              <p class="text-xs text-slate-500">Allowed: PDF (25MB), MP4/WebM (50MB), DOCX/TXT/MD (15MB), JPG/PNG/WebP (5MB).</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <input type="file" id="ed-file-input" accept=".pdf,.mp4,.webm,.jpg,.jpeg,.png,.webp,.txt,.md,.docx" class="max-w-full text-xs text-slate-600 dark:text-slate-300" />
            <label class="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" id="ed-file-preview" />
              <span>Allow free preview of this file</span>
            </label>
            ${
              item
                ? `<button type="button" id="ed-upload-file-btn" class="min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">Upload Now</button>`
                : `<span class="text-xs text-slate-400">(File attaches automatically when you save or submit)</span>`
            }
          </div>
          <div id="ed-files-list" class="space-y-2">
            ${files
              .map(
                (f) => `
              <div class="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
                <span class="truncate">${esc(f.originalName)} (${esc(f.fileType.toUpperCase())} · ${formatBytes(f.sizeBytes)}${f.isPreview ? ' · Public Preview' : ' · Protected'})</span>
                <button type="button" data-file-id="${f.id}" class="ed-del-file text-red-600 hover:underline font-semibold shrink-0">Remove</button>
              </div>
            `
              )
              .join('')}
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

  // Filter subjects by selected category
  const catSel = document.getElementById('ed-category');
  const subjSel = document.getElementById('ed-subject');
  const filterSubjects = () => {
    const cid = catSel?.value;
    if (!subjSel) return;
    Array.from(subjSel.options).forEach((opt) => {
      if (!opt.value) return;
      opt.hidden = Boolean(cid && opt.dataset.cat !== cid);
    });
  };
  catSel?.addEventListener('change', filterSubjects);
  filterSubjects();

  // Cover preset picker
  container.querySelectorAll('.ed-cover-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('ed-cover-url').value = btn.dataset.cover;
      container.querySelectorAll('.ed-cover-preset').forEach((b) => {
        const active = b.dataset.cover === btn.dataset.cover;
        b.classList.toggle('border-[#0F2547]', active);
        b.classList.toggle('dark:border-sky-400', active);
        b.classList.toggle('border-slate-200', !active);
      });
    });
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

  // Live Preview Modal
  document.getElementById('ed-preview-btn')?.addEventListener('click', () => {
    const title = document.getElementById('ed-title')?.value || 'Untitled Publication';
    const desc = document.getElementById('ed-desc')?.value || '';
    const html = document.getElementById('ed-rte')?.innerHTML || '';
    const ctype = document.getElementById('ed-type')?.value || '';
    const lang = document.getElementById('ed-language')?.value || 'English';
    const price = isFree ? 'Free' : formatInr(document.getElementById('ed-price')?.value || 0);
    openModal({
      title: 'Publication Preview',
      widthClass: 'max-w-3xl',
      bodyHtml: `
        <div class="space-y-4">
          <div class="text-xs text-slate-500">${esc(ctype)} · ${esc(lang)} · <strong class="font-mono text-slate-900 dark:text-white">${esc(price)}</strong></div>
          <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">${esc(title)}</h2>
          <p class="text-sm text-slate-600 dark:text-slate-300">${esc(desc)}</p>
          <hr class="border-slate-200 dark:border-slate-800" />
          <div class="reading-prose">${html || '<p class="text-slate-400">No body text entered yet.</p>'}</div>
        </div>
      `,
    });
  });

  // Upload file helper
  const uploadAttachedFile = async (contentId) => {
    const fileInput = document.getElementById('ed-file-input');
    const file = fileInput?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('isPreview', document.getElementById('ed-file-preview')?.checked ? 'true' : 'false');
    await apiFetch(`/api/creator/contents/${contentId}/files`, { method: 'POST', body: fd });
    fileInput.value = '';
  };

  document.getElementById('ed-upload-file-btn')?.addEventListener('click', async () => {
    if (!editingId) return;
    try {
      await uploadAttachedFile(editingId);
      showToast('File uploaded securely.', 'success');
      renderCreatorDashboardPage(container, 'upload', editingId);
    } catch (err) {
      showToast(err.message, 'error');
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
      shortDescription: document.getElementById('ed-desc')?.value.trim(),
      bodyHtml: document.getElementById('ed-rte')?.innerHTML || '',
      previewHtml: document.getElementById('ed-preview-html')?.value || '',
      coverImageUrl: document.getElementById('ed-cover-url')?.value.trim(),
      categoryId: document.getElementById('ed-category')?.value || null,
      subjectId: document.getElementById('ed-subject')?.value || null,
      language: document.getElementById('ed-language')?.value || 'English',
      contentType: document.getElementById('ed-type')?.value || 'Notes',
      isFree,
      priceInr: isFree ? 0 : Number(document.getElementById('ed-price')?.value || 0),
      tags: document.getElementById('ed-tags')?.value || '',
      externalVideoUrl: document.getElementById('ed-video-url')?.value.trim() || '',
      ownershipConfirmed: Boolean(document.getElementById('ed-ownership')?.checked),
      action,
    };

    try {
      let saved;
      if (editingId) {
        saved = await apiFetch(`/api/creator/contents/${editingId}`, { method: 'PUT', body: payload });
      } else {
        saved = await apiFetch('/api/creator/contents', { method: 'POST', body: payload });
      }
      const cid = saved.content.id;
      if (document.getElementById('ed-file-input')?.files?.[0]) {
        await uploadAttachedFile(cid);
      }
      showToast(saved.message, 'success');
      window.location.hash = action === 'draft' ? '#/creator/drafts' : '#/creator/overview';
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  document.getElementById('ed-save-draft')?.addEventListener('click', () => saveContent('draft'));
  document.getElementById('ed-submit-publish')?.addEventListener('click', () => saveContent('submit'));
}
