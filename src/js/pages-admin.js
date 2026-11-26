import {
  apiFetch,
  esc,
  formatDate,
  formatInr,
  formatRelativeAge,
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

function formatBlockRemaining(untilIso) {
  if (!untilIso) return 'Permanent';
  const diffMs = new Date(untilIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired (auto-unlocking)';
  const totalMins = Math.ceil(diffMs / 60000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 && days === 0) parts.push(`${mins}m`);
  return `${parts.join(' ') || '< 1m'} left`;
}

const NAV_GROUPS = [
  {
    group: 'Analytics',
    items: [{ id: 'overview', label: 'Overview & Revenue' }],
  },
  {
    group: 'Identity & Surveillance',
    items: [
      { id: 'users', label: 'User Directory', countKey: 'blockedUsers', countTone: 'warn' },
      { id: 'tracker', label: 'Digital User Tracker' },
      { id: 'deleted-accounts', label: 'Deleted Accounts Log', countKey: 'deletedAccountsCount', countTone: 'muted' },
    ],
  },
  {
    group: 'Editorial & Catalog',
    items: [
      { id: 'approvals', label: 'Content Approvals', countKey: 'pendingApprovals', countTone: 'warn' },
      { id: 'contents', label: 'All Publications' },
      { id: 'categories', label: 'Categories & Subjects' },
      { id: 'creators', label: 'Creator Directory' },
    ],
  },
  {
    group: 'Finance & Payouts',
    items: [
      { id: 'transactions', label: 'Transactions & Refunds' },
      { id: 'commission', label: 'Commission Policy' },
      { id: 'withdrawals', label: 'Creator Withdrawals', countKey: 'pendingWithdrawalsCount', countTone: 'warn' },
    ],
  },
  {
    group: 'Governance & System',
    items: [
      { id: 'history', label: 'Admin History' },
      { id: 'reports', label: 'Reported Content', countKey: 'openReports', countTone: 'danger' },
      { id: 'notifications', label: 'Broadcast Notices' },
      { id: 'settings', label: 'Platform Settings & Audit' },
    ],
  },
];

const ALL_TABS = NAV_GROUPS.flatMap((g) => g.items);

const BLOCK_DURATION_PRESETS = [
  { value: '1', label: '1 Hour' },
  { value: '6', label: '6 Hours' },
  { value: '24', label: '24 Hours' },
  { value: '72', label: '3 Days' },
  { value: '168', label: '7 Days' },
  { value: '720', label: '30 Days' },
  { value: 'custom', label: 'Custom Date & Time' },
  { value: 'permanent', label: 'Permanent' },
];

const QUICK_BLOCK_REASONS = [
  'Violation of ScholarPress community and academic integrity guidelines.',
  'Spam, automated scraping, or suspicious account activity detected.',
  'Copyright infringement or unauthorized redistribution of paid materials.',
  'Abusive language, harassment, or fraudulent payment behavior.',
];

const QUICK_DELETE_REASONS = [
  'Severe or repeated violation of ScholarPress Terms of Service.',
  'Confirmed copyright piracy or unauthorized distribution of creator content.',
  'Fraudulent account creation, spam abuse, or payment manipulation.',
  'Permanent administrative removal following policy investigation.',
];

// Hold the latest loaded users list for client-side filtering & modal lookups
let cachedAdminUsers = [];
let cachedMailerConfigured = false;

function openBlockUserModal(userObj, onSuccess) {
  const defaultMinDate = new Date(Date.now() + 15 * 60 * 1000);
  const localIsoMin = new Date(defaultMinDate.getTime() - defaultMinDate.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  openModal({
    title: `Restrict Account — ${userObj.name}`,
    bodyHtml: `
      <form id="adm-block-user-form" class="space-y-4">
        <div class="p-3.5 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div class="min-w-0">
            <div class="font-semibold text-slate-900 dark:text-white truncate">${esc(userObj.name)}</div>
            <div class="text-slate-500 truncate">${esc(userObj.email)}</div>
          </div>
          <div class="font-mono text-right text-[11px] text-slate-500">
            <div>UID: <span class="text-slate-800 dark:text-slate-200">${esc(userObj.publicUid || '—')}</span></div>
            ${userObj.username ? `<div>@${esc(userObj.username)}</div>` : ''}
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Restriction Action</label>
            <select name="status" id="adm-block-status" class="w-full px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1120]">
              <option value="blocked" selected>Block Account (Full Login Lock)</option>
              <option value="suspended">Suspend Account (Temporary Hold)</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Block Duration / Timing</label>
            <select name="durationPreset" id="adm-block-duration" class="w-full px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1120]">
              ${BLOCK_DURATION_PRESETS.map(
                (p) => `<option value="${p.value}" ${p.value === '24' ? 'selected' : ''}>${esc(p.label)}</option>`
              ).join('')}
            </select>
          </div>
        </div>

        <div id="adm-block-custom-wrap" class="hidden">
          <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Unlock Automatically On (Exact Date &amp; Time)</label>
          <input id="adm-block-custom-until" name="customUntil" type="datetime-local" min="${localIsoMin}" class="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1120]" />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Reason Shown to User on Login *</label>
          <textarea id="adm-block-reason" name="blockedReason" rows="3" required minlength="3" maxlength="1000" placeholder="Explain clearly why this account is being blocked. The user will see this exact message when they attempt to sign in..." class="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1120]">${esc(userObj.blockedReason || '')}</textarea>
          <div class="mt-2 flex flex-wrap gap-1.5">
            ${QUICK_BLOCK_REASONS.map(
              (r, i) => `
              <button type="button" data-quick-reason="${esc(r)}" class="adm-quick-reason text-[11px] text-left px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                Template ${i + 1}
              </button>
            `
            ).join('')}
          </div>
        </div>

        <div class="p-3 rounded-lg bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/70 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
          <div class="font-semibold">What the user experiences:</div>
          <div id="adm-block-preview">Immediate sign-out. Any login attempt will display your exact reason and the countdown timer until automatic unlock.</div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button type="button" id="adm-block-cancel" class="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300">Cancel</button>
          <button type="submit" id="adm-block-submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-700 hover:bg-amber-800 text-white">Apply Account Restriction</button>
        </div>
      </form>
    `,
    onMount: (close) => {
      const durSelect = document.getElementById('adm-block-duration');
      const customWrap = document.getElementById('adm-block-custom-wrap');
      const customInput = document.getElementById('adm-block-custom-until');
      const previewEl = document.getElementById('adm-block-preview');
      const reasonEl = document.getElementById('adm-block-reason');

      const syncDurationUi = () => {
        const val = durSelect?.value || '24';
        if (val === 'custom') {
          customWrap?.classList.remove('hidden');
          if (customInput) customInput.required = true;
          if (previewEl) {
            previewEl.textContent =
              'User will see your exact reason and the scheduled unlock date/time on login. Account unlocks automatically when the timer expires.';
          }
        } else {
          customWrap?.classList.add('hidden');
          if (customInput) customInput.required = false;
          if (previewEl) {
            previewEl.textContent =
              val === 'permanent'
                ? 'Permanent lock: user will see your exact reason and a Permanent Restriction notice on login until an admin manually unblocks them.'
                : `Timed lock (${durSelect.options[durSelect.selectedIndex]?.text}): user will see your exact reason and live unlock time on login, then unlock automatically.`;
          }
        }
      };

      durSelect?.addEventListener('change', syncDurationUi);
      syncDurationUi();

      document.querySelectorAll('.adm-quick-reason').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (reasonEl) {
            reasonEl.value = btn.dataset.quickReason || '';
            reasonEl.focus();
          }
        });
      });

      document.getElementById('adm-block-cancel')?.addEventListener('click', close);

      document.getElementById('adm-block-user-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const status = String(fd.get('status') || 'blocked');
        const preset = String(fd.get('durationPreset') || '24');
        const blockedReason = String(fd.get('blockedReason') || '').trim();
        const submitBtn = document.getElementById('adm-block-submit');

        const body = { status, blockedReason };
        if (preset === 'permanent') {
          body.permanent = true;
        } else if (preset === 'custom') {
          const rawDt = String(fd.get('customUntil') || '');
          if (!rawDt) {
            showToast('Please select a future unlock date and time.', 'error');
            return;
          }
          body.blockedUntil = new Date(rawDt).toISOString();
        } else {
          body.durationHours = Number(preset);
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Applying...';
        }
        try {
          const res = await apiFetch(`/api/admin/users/${userObj.id}`, {
            method: 'PATCH',
            body,
          });
          showToast(res.message || 'Account restriction applied.', 'success');
          close();
          if (onSuccess) onSuccess();
        } catch (err) {
          showToast(err.message, 'error');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Apply Account Restriction';
          }
        }
      });
    },
  });
}

function openDeleteUserModal(userObj, onSuccess) {
  openModal({
    title: 'Permanently Delete User Account',
    bodyHtml: `
      <form id="adm-delete-user-form" class="space-y-4">
        <div class="p-3.5 rounded-lg bg-red-50/90 dark:bg-red-950/35 border border-red-200 dark:border-red-900/80 text-xs text-red-900 dark:text-red-200 space-y-1.5">
          <div class="font-bold uppercase tracking-wider text-[11px] text-red-800 dark:text-red-300">Irreversible Database Erasure</div>
          <p class="leading-relaxed">
            Deleting <strong>${esc(userObj.name)}</strong> (<span class="font-mono">${esc(userObj.email)}</span>) will permanently erase their account, profile, 10-digit UID, saved bookmarks, activity history, publications, and session access from the database. They will have to register from scratch to return.
          </p>
        </div>

        <div class="p-3 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
          <strong>Gmail Reason Delivery:</strong>
          ${
            cachedMailerConfigured
              ? `<span class="text-emerald-700 dark:text-emerald-400 font-semibold">Active</span> — your deletion reason will be emailed directly to <span class="font-mono">${esc(userObj.email)}</span> and recorded in the Deleted Accounts Log.`
              : `<span class="text-amber-700 dark:text-amber-400 font-semibold">SMTP not yet configured</span> — account will be erased from the DB and the deletion reason will be logged and shown if they try to sign in. Configure <span class="font-mono">SMTP_USER</span> &amp; <span class="font-mono">SMTP_PASS</span> in Render Settings for Gmail inbox delivery.`
          }
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Mandatory Deletion Reason (emailed to user's Gmail) *</label>
          <textarea id="adm-delete-reason" name="reason" rows="3" required minlength="5" maxlength="1000" placeholder="Write the exact reason why this account is being permanently erased..." class="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1120]"></textarea>
          <div class="mt-2 flex flex-wrap gap-1.5">
            ${QUICK_DELETE_REASONS.map(
              (r, i) => `
              <button type="button" data-quick-del="${esc(r)}" class="adm-quick-del text-[11px] text-left px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                Reason ${i + 1}
              </button>
            `
            ).join('')}
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Type <span class="font-mono text-red-700 dark:text-red-400">${esc(userObj.email)}</span> to confirm permanent deletion *
          </label>
          <input id="adm-delete-confirm-email" name="confirmEmail" type="email" required autocomplete="off" placeholder="${esc(userObj.email)}" class="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1120]" />
        </div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button type="button" id="adm-delete-cancel" class="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300">Cancel</button>
          <button type="submit" id="adm-delete-submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-red-700 hover:bg-red-800 text-white">Erase Account &amp; Send Reason</button>
        </div>
      </form>
    `,
    onMount: (close) => {
      const reasonEl = document.getElementById('adm-delete-reason');
      document.querySelectorAll('.adm-quick-del').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (reasonEl) {
            reasonEl.value = btn.dataset.quickDel || '';
            reasonEl.focus();
          }
        });
      });

      document.getElementById('adm-delete-cancel')?.addEventListener('click', close);

      document.getElementById('adm-delete-user-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const reason = String(fd.get('reason') || '').trim();
        const confirmEmail = String(fd.get('confirmEmail') || '').trim().toLowerCase();
        const submitBtn = document.getElementById('adm-delete-submit');

        if (confirmEmail !== userObj.email.toLowerCase()) {
          showToast('Confirmation email does not match the target user email.', 'error');
          return;
        }
        if (reason.length < 5) {
          showToast('Please enter a deletion reason of at least 5 characters.', 'error');
          return;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Erasing Account...';
        }
        try {
          const res = await apiFetch(`/api/admin/users/${userObj.id}`, {
            method: 'DELETE',
            body: { reason },
          });
          showToast(res.message || 'Account permanently deleted.', res.emailSent ? 'success' : 'info');
          close();
          if (onSuccess) onSuccess();
        } catch (err) {
          showToast(err.message, 'error');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Erase Account & Send Reason';
          }
        }
      });
    },
  });
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

  container.innerHTML = `
    <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-12 text-xs font-mono text-slate-500">
      Loading Administrator Console...
    </div>
  `;

  try {
    // Load live sidebar queue counters alongside the active workspace view
    let sidebarCounts = {};
    try {
      const ov = await apiFetch('/api/admin/overview');
      sidebarCounts = ov.metrics || {};
      cachedMailerConfigured = Boolean(ov.mailerConfigured);
    } catch {
      sidebarCounts = {};
    }

    let bodyHtml = '';
    let breadcrumbTitle = ALL_TABS.find((t) => t.id === activeTab)?.label || 'Overview & Revenue';
    let topRightAction = `<a href="#/admin/tracker" class="px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 whitespace-nowrap">Track User by UID</a>`;

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
      sidebarCounts = m;
      cachedMailerConfigured = Boolean(data.mailerConfigured);

      bodyHtml = `
        <div class="space-y-6">
          <div class="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Executive Platform Analytics</h1>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Real-time ledger across accounts, moderation queues, commissions, and disbursements.</p>
            </div>
            <form id="admin-date-filter" class="flex flex-wrap items-center gap-2 text-xs w-full sm:w-auto">
              <input type="date" name="from" value="${esc(from)}" class="flex-1 sm:flex-none min-h-[36px] px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111A2E] font-mono" />
              <span class="text-slate-400">to</span>
              <input type="date" name="to" value="${esc(to)}" class="flex-1 sm:flex-none min-h-[36px] px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111A2E] font-mono" />
              <button type="submit" class="min-h-[36px] px-3.5 py-1.5 font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950 whitespace-nowrap">Apply</button>
              ${from || to ? `<a href="#/admin/overview" class="text-slate-500 hover:underline px-1 whitespace-nowrap">Clear</a>` : ''}
            </form>
          </div>

          <!-- Primary Executive KPI Row (Single-elevation crisp grid) -->
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Gross Transaction Volume</div>
              <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1.5 tabular-nums">${formatInr(m.grossTransactionValue)}</div>
              <div class="text-[11px] text-slate-500 mt-1.5 font-mono tabular-nums">${m.totalPurchases} active purchases</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Platform Commission Net</div>
              <div class="font-mono text-2xl font-semibold text-[#0F2547] dark:text-sky-400 mt-1.5 tabular-nums">${formatInr(m.totalPlatformCommission)}</div>
              <div class="text-[11px] text-slate-500 mt-1.5">Settled platform share</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Creator Net Earnings</div>
              <div class="font-mono text-2xl font-semibold text-emerald-700 dark:text-emerald-400 mt-1.5 tabular-nums">${formatInr(m.totalCreatorEarnings)}</div>
              <div class="text-[11px] text-slate-500 mt-1.5 font-mono tabular-nums">Pending payout: ${formatInr(m.pendingWithdrawalsAmount)}</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Registered Accounts</div>
              <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1.5 tabular-nums">${m.totalUsers}</div>
              <div class="text-[11px] text-slate-500 mt-1.5 font-mono tabular-nums">${m.activeUsers} active · ${m.blockedUsers || 0} restricted · ${m.totalCreators} creators</div>
            </div>
          </div>

          <!-- Operational Action Queues -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <a href="#/admin/approvals" class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition-colors flex items-center justify-between">
              <span class="text-xs font-semibold text-slate-700 dark:text-slate-200">Pending Approvals</span>
              <span class="font-mono text-lg font-semibold ${m.pendingApprovals > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400'} tabular-nums">${m.pendingApprovals}</span>
            </a>
            <a href="#/admin/withdrawals" class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition-colors flex items-center justify-between">
              <span class="text-xs font-semibold text-slate-700 dark:text-slate-200">Pending Withdrawals</span>
              <span class="font-mono text-lg font-semibold ${m.pendingWithdrawalsCount > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400'} tabular-nums">${m.pendingWithdrawalsCount}</span>
            </a>
            <a href="#/admin/reports" class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition-colors flex items-center justify-between">
              <span class="text-xs font-semibold text-slate-700 dark:text-slate-200">Open Abuse Reports</span>
              <span class="font-mono text-lg font-semibold ${m.openReports > 0 ? 'text-red-700 dark:text-red-400' : 'text-slate-400'} tabular-nums">${m.openReports}</span>
            </a>
            <a href="#/admin/deleted-accounts" class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition-colors flex items-center justify-between">
              <span class="text-xs font-semibold text-slate-700 dark:text-slate-200">Deleted Accounts</span>
              <span class="font-mono text-lg font-semibold text-slate-600 dark:text-slate-300 tabular-nums">${m.deletedAccountsCount || 0}</span>
            </a>
          </div>

          <!-- Monthly Revenue & Commission SVG Chart -->
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <h2 class="font-display text-base font-semibold text-slate-900 dark:text-white">Monthly Revenue &amp; Commission Ledger</h2>
                <p class="text-[11px] text-slate-500 mt-0.5">${m.publishedContent} published works (${m.freeContent} free · ${m.paidContent} paid)</p>
              </div>
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <span><strong class="text-[#0F2547] dark:text-sky-400">■</strong> Gross Volume</span>
                <span><strong class="text-emerald-700 dark:text-emerald-400">■</strong> Creator Share</span>
                <span><strong class="text-amber-600 dark:text-amber-400">■</strong> Commission</span>
              </div>
            </div>
            ${renderRevenueSvgChart(data.monthlyRevenue || [])}
          </div>

          <!-- Ranked Performance Lists -->
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3.5">Popular Categories</h3>
              <div class="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                ${(data.popularCategories || [])
                  .map(
                    (c) => `
                  <div class="py-2 flex items-center justify-between gap-2">
                    <span class="font-medium text-slate-800 dark:text-slate-200 truncate">${esc(c.name)}</span>
                    <span class="font-mono text-slate-500 tabular-nums shrink-0">${c.contentCount} · ${c.totalViews} views</span>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </div>

            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3.5">Top Performing Publications</h3>
              <div class="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                ${(data.topContent || [])
                  .map(
                    (c) => `
                  <div class="py-2 flex items-center justify-between gap-2">
                    <a href="#/content/${esc(c.slug)}" class="font-medium text-slate-800 dark:text-slate-200 hover:underline truncate">${esc(c.title)}</a>
                    <span class="font-mono text-slate-500 tabular-nums shrink-0">${c.purchasesCount} sales</span>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </div>

            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3.5">Top Creators</h3>
              <div class="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                ${(data.topCreators || [])
                  .map(
                    (cr) => `
                  <div class="py-2 flex items-center justify-between gap-2">
                    <span class="font-medium text-slate-800 dark:text-slate-200 truncate">${esc(cr.displayName || cr.name)}</span>
                    <span class="font-mono text-emerald-700 dark:text-emerald-400 tabular-nums shrink-0">${formatInr(cr.totalEarningsInr || 0)}</span>
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
      cachedAdminUsers = data.users || [];
      cachedMailerConfigured = Boolean(data.mailerConfigured);

      const totalCount = cachedAdminUsers.length;
      const activeCount = cachedAdminUsers.filter((u) => u.status === 'active').length;
      const restrictedCount = cachedAdminUsers.filter((u) => u.status !== 'active').length;
      const adminCount = cachedAdminUsers.filter((u) => u.role === 'admin').length;

      topRightAction = `<a href="#/admin/deleted-accounts" class="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 whitespace-nowrap">Deleted Accounts Log</a>`;

      bodyHtml = `
        <div class="space-y-5">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">User Directory &amp; Access Enforcement</h1>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
              ${
                canManageAdmins
                  ? 'Primary Super Admin authority active: manage roles, apply timed account blocks with user-visible reasons, or permanently erase accounts with Gmail notices.'
                  : 'Delegated Admin view: manage standard user and creator accounts. Administrator privilege changes remain locked to the Primary Super Admin.'
              }
            </p>
          </div>

          <!-- Directory KPI Summary Strip -->
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-[11px] font-medium text-slate-500">Total Accounts</div>
              <div class="font-mono text-xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${totalCount}</div>
            </div>
            <div class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-[11px] font-medium text-slate-500">Active Accounts</div>
              <div class="font-mono text-xl font-semibold text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">${activeCount}</div>
            </div>
            <div class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-[11px] font-medium text-slate-500">Blocked / Suspended</div>
              <div class="font-mono text-xl font-semibold ${restrictedCount > 0 ? 'text-red-700 dark:text-red-400' : 'text-slate-400'} mt-1 tabular-nums">${restrictedCount}</div>
            </div>
            <div class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-[11px] font-medium text-slate-500">Administrators</div>
              <div class="font-mono text-xl font-semibold text-[#0F2547] dark:text-sky-400 mt-1 tabular-nums">${adminCount}</div>
            </div>
          </div>

          <!-- Search & Filter Toolbar -->
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex flex-col md:flex-row items-stretch md:items-center gap-3">
            <input id="adm-users-search" type="search" placeholder="Filter by name, email, 10-digit UID, or @unique_id..." class="flex-1 px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            <div class="flex items-center gap-2">
              <select id="adm-users-role-filter" class="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                <option value="all">All Roles</option>
                <option value="user">Users Only</option>
                <option value="creator">Creators Only</option>
                <option value="admin">Admins Only</option>
              </select>
              <select id="adm-users-status-filter" class="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="restricted">Blocked / Suspended</option>
              </select>
            </div>
          </div>

          <!-- High-Density User Directory Table -->
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[920px] text-left text-xs">
              <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
                <tr>
                  <th class="px-4 py-3 font-semibold">Account</th>
                  <th class="px-4 py-3 font-semibold">UID &amp; Unique ID</th>
                  <th class="px-4 py-3 font-semibold">Role</th>
                  <th class="px-4 py-3 font-semibold">Status &amp; Restriction</th>
                  <th class="px-4 py-3 font-semibold">Joined</th>
                  <th class="px-4 py-3 font-semibold text-right">Enforcement Controls</th>
                </tr>
              </thead>
              <tbody id="adm-users-tbody" class="divide-y divide-slate-100 dark:divide-slate-800">
                ${renderUserDirectoryRows(cachedAdminUsers, canManageAdmins)}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === 'deleted-accounts') {
      const data = await apiFetch('/api/admin/deleted-accounts');
      cachedMailerConfigured = Boolean(data.mailerConfigured);
      const logs = data.logs || [];

      topRightAction = `<a href="#/admin/users" class="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap">← Back to User Directory</a>`;

      bodyHtml = `
        <div class="space-y-5">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Permanently Deleted Accounts Ledger</h1>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Permanent audit log of erased user accounts, admin-supplied deletion reasons, and Gmail delivery status.
            </p>
          </div>

          ${
            !data.mailerConfigured
              ? `<div class="p-4 rounded-xl bg-amber-50/80 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/70 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <strong>Gmail SMTP Delivery Pending:</strong> Configure <span class="font-mono">SMTP_USER</span> &amp; <span class="font-mono">SMTP_PASS</span> in Render Environment Variables so deletion reason emails deliver automatically to users' Gmail inboxes.
                  </div>
                  <a href="#/admin/settings" class="font-semibold underline whitespace-nowrap">View SMTP Setup →</a>
                </div>`
              : ''
          }

          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[860px] text-left text-xs">
              <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
                <tr>
                  <th class="px-4 py-3 font-semibold">Former Account</th>
                  <th class="px-4 py-3 font-semibold">Former UID / ID</th>
                  <th class="px-4 py-3 font-semibold">Deletion Reason</th>
                  <th class="px-4 py-3 font-semibold">Deleted By</th>
                  <th class="px-4 py-3 font-semibold">Gmail Notice</th>
                  <th class="px-4 py-3 font-semibold text-right">Erased On</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                ${
                  logs.length
                    ? logs
                        .map(
                          (row) => `
                      <tr>
                        <td class="px-4 py-3">
                          <div class="font-semibold text-slate-900 dark:text-white">${esc(row.deletedUserName)}</div>
                          <div class="text-slate-500">${esc(row.deletedUserEmail)} · <span class="capitalize">${esc(row.deletedRole)}</span></div>
                        </td>
                        <td class="px-4 py-3 font-mono">
                          <div class="text-slate-800 dark:text-slate-200">${esc(row.deletedPublicUid || '—')}</div>
                          <div class="text-slate-500">${row.deletedUsername ? `@${esc(row.deletedUsername)}` : '—'}</div>
                        </td>
                        <td class="px-4 py-3 max-w-[300px]">
                          <p class="text-slate-800 dark:text-slate-200 leading-relaxed">${esc(row.reason)}</p>
                        </td>
                        <td class="px-4 py-3 text-slate-600 dark:text-slate-300">
                          ${esc(row.actorName || 'Administrator')}
                        </td>
                        <td class="px-4 py-3 max-w-[200px]">
                          <div class="font-semibold ${row.emailSent ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}">
                            ${row.emailSent ? 'Delivered to Gmail' : 'Logged (SMTP Pending)'}
                          </div>
                          ${row.emailStatusNote ? `<div class="text-[11px] text-slate-500 truncate" title="${esc(row.emailStatusNote)}">${esc(row.emailStatusNote)}</div>` : ''}
                        </td>
                        <td class="px-4 py-3 text-right font-mono text-slate-500 whitespace-nowrap">${formatDateTime(row.deletedAt)}</td>
                      </tr>
                    `
                        )
                        .join('')
                    : `<tr><td colspan="6" class="px-4 py-10 text-center text-slate-500">No user accounts have been permanently deleted yet.</td></tr>`
                }
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
        breadcrumbTitle = 'Digital User Dossier';
        let dossier = null;
        let dossierError = null;
        try {
          dossier = await apiFetch(`/api/admin/users/${encodeURIComponent(subParam)}/dossier`);
        } catch (err) {
          dossierError = err.message || 'Unable to load user dossier.';
        }

        if (dossierError || !dossier) {
          topRightAction = `<a href="#/admin/tracker" class="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700">← Back to Tracker</a>`;
          bodyHtml = `
            <div class="space-y-5">
              <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Digital User Tracker</h1>
              <div class="p-5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-sm text-amber-900 dark:text-amber-200">
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

          cachedAdminUsers = [u];
          const canEnforce = u.role !== 'admin' || Boolean(store.user?.isSuperAdmin);

          topRightAction = `
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" id="adm-dossier-refresh" class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">Refresh</button>
              ${
                canEnforce
                  ? u.status === 'active'
                    ? `<button type="button" data-block-uid="${u.id}" class="adm-open-block-modal px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-700 hover:bg-amber-800 text-white">Block Account</button>`
                    : `<button type="button" data-unblock-uid="${u.id}" class="adm-unblock-user px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white">Unblock</button>`
                  : ''
              }
              ${
                canEnforce
                  ? `<button type="button" data-delete-uid="${u.id}" class="adm-open-delete-modal px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-700 hover:bg-red-800 text-white">Delete Account</button>`
                  : ''
              }
            </div>
          `;

          bodyHtml = `
            <div class="space-y-6">
              <div>
                <a href="#/admin/tracker" class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">← Back to Tracker Directory</a>
                <div class="flex flex-wrap items-baseline justify-between gap-3 mt-1">
                  <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
                    ${esc(u.name)} ${u.username ? `<span class="font-mono text-sm font-normal text-slate-500">@${esc(u.username)}</span>` : ''}
                  </h1>
                  <div class="font-mono text-xs text-slate-500">
                    UID <span class="font-semibold text-[#0F2547] dark:text-sky-400 tracking-wider">${esc(u.publicUid || '—')}</span>
                  </div>
                </div>
              </div>

              ${
                u.status !== 'active'
                  ? `<div class="p-4 rounded-xl bg-red-50/90 dark:bg-red-950/35 border border-red-200 dark:border-red-900/80 text-xs text-red-900 dark:text-red-200 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div class="font-bold uppercase tracking-wider text-[11px] text-red-800 dark:text-red-300">Account Currently ${esc(u.status)}</div>
                        <div class="mt-0.5"><strong>Reason:</strong> ${esc(u.blockedReason || 'Administrative restriction')}</div>
                        <div class="font-mono text-[11px] mt-0.5">${u.blockedUntil ? `Unlocks: ${formatDateTime(u.blockedUntil)} (${formatBlockRemaining(u.blockedUntil)})` : 'Duration: Permanent'}</div>
                      </div>
                      ${canEnforce ? `<button type="button" data-unblock-uid="${u.id}" class="adm-unblock-user px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 text-white">Restore Active Access</button>` : ''}
                    </div>`
                  : ''
              }

              <!-- Live Presence Bar -->
              <div class="p-4 sm:p-5 rounded-xl border ${
                live.isOnline
                  ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900'
                  : 'bg-white dark:bg-[#111A2E] border-slate-200 dark:border-slate-800'
              } flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="space-y-1">
                  <div class="flex items-center gap-2 text-xs font-semibold">
                    <span class="w-2 h-2 rounded-full ${live.isOnline ? 'bg-emerald-500' : 'bg-slate-400'}"></span>
                    <span class="${live.isOnline ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'}">
                      ${live.isOnline ? 'Live Session Active' : `Offline · Last seen ${formatDateTime(live.lastSeenAt)}`}
                    </span>
                  </div>
                  ${
                    live.currentSession
                      ? `<div class="text-sm font-medium text-slate-900 dark:text-white">
                          ${live.isOnline ? 'Viewing now:' : 'Last viewed:'}
                          ${
                            live.currentSession.contentSlug
                              ? `<a href="#/content/${esc(live.currentSession.contentSlug)}" class="underline text-[#0F2547] dark:text-sky-400">${esc(live.currentSession.pageTitle)}</a>`
                              : `<span>${esc(live.currentSession.pageTitle || live.currentSession.pagePath)}</span>`
                          }
                          <span class="text-xs font-mono text-slate-500 ml-2 tabular-nums">(${formatDuration(live.currentSession.durationSeconds)})</span>
                        </div>`
                      : `<div class="text-xs text-slate-500">No browsing activity recorded for this account yet.</div>`
                  }
                </div>
                <div class="text-xs text-slate-500 font-mono">
                  Role: <span class="capitalize font-semibold text-slate-900 dark:text-white">${esc(u.role)}</span> · Status: ${renderStatusLabel(u.status)}
                </div>
              </div>

              <!-- 4-Column Activity & Spending KPI Strip -->
              <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
                  <div class="text-[11px] font-medium text-slate-500">Total Money Spent</div>
                  <div class="font-mono text-2xl font-semibold text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">${formatInr(sum.totalSpentInr || 0)}</div>
                  <div class="text-[11px] text-slate-500 mt-1 font-mono">${sum.successfulPaymentsCount || 0} successful payment(s)</div>
                </div>
                <div class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
                  <div class="text-[11px] font-medium text-slate-500">Contents Viewed</div>
                  <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${sum.totalContentsViewed || 0}</div>
                  <div class="text-[11px] text-slate-500 mt-1 font-mono">Read time: ${formatDuration(sum.totalContentReadSeconds || 0)}</div>
                </div>
                <div class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
                  <div class="text-[11px] font-medium text-slate-500">Total Time on Site</div>
                  <div class="font-mono text-2xl font-semibold text-[#0F2547] dark:text-sky-400 mt-1 tabular-nums">${formatDuration(sum.totalWebsiteSeconds || 0)}</div>
                  <div class="text-[11px] text-slate-500 mt-1">Across all sessions</div>
                </div>
                <div class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
                  <div class="text-[11px] font-medium text-slate-500">Active Visit Days</div>
                  <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${sum.totalVisitDays || 0}</div>
                  <div class="text-[11px] text-slate-500 mt-1 font-mono">${sum.firstVisitDate ? `Since ${esc(sum.firstVisitDate)}` : 'No visits yet'}</div>
                </div>
              </div>

              <!-- Full Profile & Demographic Card -->
              <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-500">Verified Identity &amp; Profile Details</h2>
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
                    <div class="text-slate-400">Joined On</div>
                    <div class="font-mono font-semibold text-slate-900 dark:text-white mt-0.5">${formatDateTime(u.createdAt)}</div>
                  </div>
                  <div>
                    <div class="text-slate-400">Profession / Role</div>
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
                    <div class="text-slate-400">Gender &amp; DOB</div>
                    <div class="font-semibold text-slate-900 dark:text-white mt-0.5">${esc(p.gender || '—')} · <span class="font-mono">${esc(p.dateOfBirth || '—')}</span></div>
                  </div>
                </div>
                <div class="pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                  <div class="text-slate-400 mb-1">Description / Bio</div>
                  <p class="text-slate-700 dark:text-slate-300">${esc(u.bio || 'No description provided.')}</p>
                </div>
              </div>

              <!-- Content Viewing History -->
              <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <h2 class="text-sm font-semibold text-slate-900 dark:text-white">Content Viewing History (${contentHistory.length})</h2>
                    <p class="text-[11px] text-slate-500">Every publication opened by this user with exact watch/reading duration.</p>
                  </div>
                </div>
                <div class="overflow-x-auto touch-scroll-x">
                  <table class="w-full min-w-[640px] text-left text-xs">
                    <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
                      <tr>
                        <th class="px-4 py-2.5 font-semibold">Publication</th>
                        <th class="px-4 py-2.5 font-semibold">Format</th>
                        <th class="px-4 py-2.5 font-semibold text-right">Sessions</th>
                        <th class="px-4 py-2.5 font-semibold text-right">Total Time Spent</th>
                        <th class="px-4 py-2.5 font-semibold text-right">Last Viewed</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                      ${
                        contentHistory.length
                          ? contentHistory
                              .map(
                                (c) => `
                              <tr>
                                <td class="px-4 py-2.5 font-medium text-slate-900 dark:text-white">
                                  <a href="#/content/${esc(c.slug)}" class="hover:underline">${esc(c.title)}</a>
                                </td>
                                <td class="px-4 py-2.5 text-slate-500">${esc(c.contentType)} · ${c.isFree ? 'Free' : formatInr(c.priceInr)}</td>
                                <td class="px-4 py-2.5 text-right font-mono tabular-nums">${c.viewsCount}</td>
                                <td class="px-4 py-2.5 text-right font-mono font-semibold text-[#0F2547] dark:text-sky-400 tabular-nums">${formatDuration(c.totalDurationSeconds)}</td>
                                <td class="px-4 py-2.5 text-right font-mono text-slate-500 whitespace-nowrap">${formatDateTime(c.lastViewedAt)}</td>
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

              <!-- Spending History -->
              <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 class="text-sm font-semibold text-slate-900 dark:text-white">Purchase &amp; Spending History</h2>
                    <p class="text-[11px] text-slate-500">All recorded transactions with receipt number and timestamp.</p>
                  </div>
                  <div class="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">Total: ${formatInr(sum.totalSpentInr || 0)}</div>
                </div>
                <div class="overflow-x-auto touch-scroll-x">
                  <table class="w-full min-w-[640px] text-left text-xs">
                    <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
                      <tr>
                        <th class="px-4 py-2.5 font-semibold">Date &amp; Time</th>
                        <th class="px-4 py-2.5 font-semibold">Publication</th>
                        <th class="px-4 py-2.5 font-semibold">Receipt</th>
                        <th class="px-4 py-2.5 font-semibold">Status</th>
                        <th class="px-4 py-2.5 font-semibold text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                      ${
                        userPayments.length
                          ? userPayments
                              .map(
                                (pay) => `
                              <tr>
                                <td class="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">${formatDateTime(pay.createdAt)}</td>
                                <td class="px-4 py-2.5 font-medium text-slate-900 dark:text-white">
                                  <a href="#/content/${esc(pay.contentSlug)}" class="hover:underline">${esc(pay.contentTitle)}</a>
                                </td>
                                <td class="px-4 py-2.5 font-mono">${esc(pay.receiptNumber)}</td>
                                <td class="px-4 py-2.5">${renderStatusLabel(pay.status)}</td>
                                <td class="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">${formatInr(pay.amountInr)}</td>
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
              <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
                <div>
                  <h2 class="text-sm font-semibold text-slate-900 dark:text-white">Website Visit Calendar (Year · Month · Day)</h2>
                  <p class="text-[11px] text-slate-500 mt-0.5">Complete chronological breakdown of every day, month, and year this user visited ScholarPress.</p>
                </div>

                <div>
                  <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Year-Wise Summary</div>
                  ${
                    visits.byYear.length
                      ? `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          ${visits.byYear
                            .map(
                              (y) => `
                            <div class="p-3.5 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800">
                              <div class="font-mono text-base font-bold text-slate-900 dark:text-white">${y.year}</div>
                              <div class="text-xs text-slate-600 dark:text-slate-300 mt-0.5 font-mono tabular-nums">
                                ${y.days}d · ${formatDuration(y.totalSeconds)} · ${y.pageViews} views
                              </div>
                            </div>
                          `
                            )
                            .join('')}
                        </div>`
                      : `<p class="text-xs text-slate-500">No yearly visit records yet.</p>`
                  }
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Month-Wise Breakdown</div>
                    ${
                      visits.byMonth.length
                        ? `<div class="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                            <table class="w-full text-left text-xs">
                              <thead class="bg-slate-50 dark:bg-[#0B1120] text-slate-500 border-b border-slate-200 dark:border-slate-800">
                                <tr>
                                  <th class="px-3 py-2 font-semibold">Month</th>
                                  <th class="px-3 py-2 font-semibold text-right">Days</th>
                                  <th class="px-3 py-2 font-semibold text-right">Time</th>
                                </tr>
                              </thead>
                              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                                ${visits.byMonth
                                  .map(
                                    (m) => `
                                  <tr>
                                    <td class="px-3 py-2 font-medium text-slate-900 dark:text-white">${esc(m.label)}</td>
                                    <td class="px-3 py-2 text-right font-mono tabular-nums">${m.days}d</td>
                                    <td class="px-3 py-2 text-right font-mono font-semibold text-[#0F2547] dark:text-sky-400 tabular-nums">${formatDuration(m.totalSeconds)}</td>
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

                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Day-by-Day Visit Log (${visits.dailyLogs.length})</div>
                    ${
                      visits.dailyLogs.length
                        ? `<div class="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg max-h-80 overflow-y-auto">
                            <table class="w-full text-left text-xs">
                              <thead class="sticky top-0 bg-slate-50 dark:bg-[#0B1120] text-slate-500 border-b border-slate-200 dark:border-slate-800">
                                <tr>
                                  <th class="px-3 py-2 font-semibold">Date &amp; Day</th>
                                  <th class="px-3 py-2 font-semibold text-right">Time</th>
                                  <th class="px-3 py-2 font-semibold text-right">Window</th>
                                </tr>
                              </thead>
                              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                                ${visits.dailyLogs
                                  .map(
                                    (d) => `
                                  <tr>
                                    <td class="px-3 py-2"><span class="font-mono font-semibold text-slate-900 dark:text-white">${esc(d.visitDate)}</span> <span class="text-slate-500">${esc(d.dayOfWeek.slice(0, 3))}</span></td>
                                    <td class="px-3 py-2 text-right font-mono font-semibold text-[#0F2547] dark:text-sky-400 tabular-nums">${formatDuration(d.totalSeconds)}</td>
                                    <td class="px-3 py-2 text-right font-mono text-slate-500 whitespace-nowrap">${formatTimeOnly(d.firstSeenAt)}–${formatTimeOnly(d.lastSeenAt)}</td>
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
              </div>

              <!-- Recent Page-by-Page Trail -->
              <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                  <h2 class="text-sm font-semibold text-slate-900 dark:text-white">Recent Page-by-Page Session Trail</h2>
                </div>
                <div class="overflow-x-auto touch-scroll-x">
                  <table class="w-full min-w-[600px] text-left text-xs">
                    <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
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
                                <td class="px-4 py-2.5 text-right font-mono text-slate-500 whitespace-nowrap">${formatDateTime(s.lastSeenAt)}</td>
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
        const data = await apiFetch(
          `/api/admin/users/track${searchQ ? `?q=${encodeURIComponent(searchQ)}` : ''}`
        );
        const results = data.results || [];
        topRightAction = `<a href="#/admin/users" class="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap">User Directory</a>`;

        bodyHtml = `
          <div class="space-y-5">
            <div>
              <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Digital User Tracker</h1>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Look up any user or delegated admin by <strong>10-Digit UID</strong>, <strong>@unique_id</strong>, email, or name to inspect live browsing activity, content reading time, spending, and Day/Month/Year visit history. Primary Super Admin is strictly shielded.
              </p>
            </div>

            <form id="adm-tracker-search-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex flex-col sm:flex-row gap-2.5">
              <input name="q" value="${esc(searchQ)}" placeholder="Enter 10-digit UID (e.g. 4829105736), @unique_id, name, or email..." class="flex-1 px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              <div class="flex gap-2">
                <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 text-white dark:text-slate-950 whitespace-nowrap">
                  Search &amp; Track
                </button>
                ${searchQ ? `<a href="#/admin/tracker" class="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 flex items-center">Reset</a>` : ''}
              </div>
            </form>

            ${
              data.protected
                ? `<div class="p-5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200">
                    <strong>Access Shielded:</strong> ${esc(data.message)}
                  </div>`
                : `<div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
                    <table class="w-full min-w-[800px] text-left text-xs">
                      <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
                        <tr>
                          <th class="px-4 py-3 font-semibold">User &amp; Presence</th>
                          <th class="px-4 py-3 font-semibold">10-Digit UID / Unique ID</th>
                          <th class="px-4 py-3 font-semibold">Live / Last Activity</th>
                          <th class="px-4 py-3 font-semibold text-right">Contents</th>
                          <th class="px-4 py-3 font-semibold text-right">Spent</th>
                          <th class="px-4 py-3 font-semibold text-right">Visits</th>
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
                                      <span class="capitalize text-[11px] text-slate-400">· ${esc(u.role)}</span>
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
                                           <div class="text-[11px] ${u.isOnline ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400 font-mono'}">${u.isOnline ? 'Online now' : formatDateTime(u.lastSeenAt)}</div>`
                                        : `<span class="text-slate-400">No activity yet</span>`
                                    }
                                  </td>
                                  <td class="px-4 py-3 text-right font-mono tabular-nums">${u.totalContentsViewed}</td>
                                  <td class="px-4 py-3 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">${formatInr(u.totalSpentInr)}</td>
                                  <td class="px-4 py-3 text-right font-mono tabular-nums">${u.totalVisitDays}d (${formatDuration(u.totalWebsiteSeconds)})</td>
                                  <td class="px-4 py-3 text-right whitespace-nowrap">
                                    <a href="#/admin/tracker/${u.id}" class="font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">
                                      Inspect Dossier →
                                    </a>
                                  </td>
                                </tr>
                              `
                                )
                                .join('')
                            : `<tr><td colspan="7" class="px-4 py-10 text-center text-slate-500">No matching users found. Search by 10-digit UID, @unique_id, name, or email.</td></tr>`
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
        <div class="space-y-5">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Creator Directory &amp; Commission Overrides</h1>
            <p class="text-xs text-slate-500 mt-1">Verify creators or assign individual commission rates (5%–20%). Leave blank to inherit the platform default.</p>
          </div>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[700px] text-left text-xs">
              <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
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
                      <div class="font-semibold text-slate-900 dark:text-white">${esc(c.displayName || c.name)}</div>
                      <div class="text-slate-500">${esc(c.email)} · <span class="font-mono">${c.totalSales || 0}</span> sales</div>
                    </td>
                    <td class="px-4 py-3 text-right font-mono tabular-nums">${formatInr(c.totalEarningsInr || 0)}</td>
                    <td class="px-4 py-3 text-right font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">${formatInr(c.availableBalanceInr || 0)}</td>
                    <td class="px-4 py-3">
                      <button type="button" data-uid="${c.id}" data-verified="${c.verified ? 'false' : 'true'}" class="adm-verify-creator font-semibold ${c.verified ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'} hover:underline">
                        ${c.verified ? 'Verified' : 'Mark Verified'}
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
        <div class="space-y-5">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">${onlyPending ? 'Content Approval Queue' : 'All Platform Publications'} (${data.contents.length})</h1>
            <p class="text-xs text-slate-500 mt-1">${onlyPending ? 'Review pending submissions before publishing to the live catalog.' : 'Approve, reject, remove, feature, or configure item-level commission rates.'}</p>
          </div>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[740px] text-left text-xs">
              <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
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
                          <a href="#/content/${esc(c.slug)}" class="font-semibold text-slate-900 dark:text-white hover:underline block">${esc(c.title)}</a>
                          <span class="text-slate-500">${esc(c.contentType)} · ${esc(c.categoryName || 'General')}${c.isFeatured ? ' · Featured' : ''}</span>
                        </td>
                        <td class="px-4 py-3">${esc(c.creatorName)}</td>
                        <td class="px-4 py-3 font-mono tabular-nums">${c.isFree ? 'Free' : formatInr(c.priceInr)}</td>
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
                        <td class="px-4 py-3 text-right whitespace-nowrap space-x-2.5 font-semibold">
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
                    : `<tr><td colspan="${onlyPending ? 5 : 6}" class="px-4 py-10 text-center text-slate-500">No items in queue.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === 'categories') {
      const catData = await apiFetch('/api/catalog/categories');
      bodyHtml = `
        <div class="space-y-6">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Categories &amp; Subjects</h1>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <form id="adm-add-cat-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-500">Create Category</h2>
              <input name="name" required placeholder="Category name (e.g. Economics)" class="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              <input name="description" placeholder="Short description" class="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Create Category</button>
            </form>

            <form id="adm-add-subj-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-500">Create Subject / Topic</h2>
              <select name="categoryId" required class="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                ${catData.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
              </select>
              <input name="name" required placeholder="Subject name (e.g. Macroeconomics)" class="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Create Subject</button>
            </form>
          </div>

          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
            ${catData.categories
              .map(
                (c) => `
              <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div class="font-semibold text-sm text-slate-900 dark:text-white">${esc(c.name)} <span class="font-mono text-xs font-normal text-slate-400">(${c.contentCount})</span></div>
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
                <button type="button" data-catid="${c.id}" class="adm-del-cat text-xs font-semibold text-red-600 hover:underline shrink-0">Delete</button>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    } else if (activeTab === 'transactions') {
      const [data, gwCfg] = await Promise.all([
        apiFetch('/api/admin/transactions'),
        apiFetch('/api/payments/config').catch(() => ({
          provider: 'razorpay',
          mode: 'sandbox',
          keyId: null,
          configured: false,
          webhookConfigured: false,
        })),
      ]);
      const isLiveGateway = gwCfg.configured && gwCfg.mode === 'live';
      const isTestGateway = gwCfg.configured && gwCfg.mode !== 'live';
      const gwBadge = isLiveGateway
        ? '<span class="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">Live Razorpay Active</span>'
        : isTestGateway
        ? '<span class="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">Razorpay Test Mode</span>'
        : '<span class="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">Local Sandbox Mode</span>';
      const maskedKey = gwCfg.keyId
        ? `${String(gwCfg.keyId).slice(0, 12)}••••${String(gwCfg.keyId).slice(-4)}`
        : 'Not set';
      const webhookUrl = `${window.location.origin}/api/payments/webhook/razorpay`;

      bodyHtml = `
        <div class="space-y-5">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Transactions &amp; Refunds Ledger</h1>
            <p class="text-xs text-slate-500 mt-1">All captured, pending, and refunded orders with platform commission split.</p>
          </div>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div class="space-y-1.5">
              <div class="flex flex-wrap items-center gap-2.5">
                <span class="text-xs font-semibold uppercase tracking-wider text-slate-500">Razorpay Gateway</span>
                ${gwBadge}
                <span class="px-2 py-0.5 rounded text-[11px] font-mono ${gwCfg.webhookConfigured ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}">
                  Webhook: ${gwCfg.webhookConfigured ? 'Verified Secret Set' : 'Secret Not Set'}
                </span>
              </div>
              <p class="text-xs text-slate-600 dark:text-slate-400">
                Key ID: <code class="font-mono text-slate-800 dark:text-slate-200">${esc(maskedKey)}</code> ·
                ${
                  gwCfg.configured
                    ? 'Orders, HMAC verification, payment capture, and refunds sync directly with Razorpay.'
                    : 'Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET in server environment variables to process real INR payments.'
                }
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2 shrink-0">
              <code class="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-700 dark:text-slate-300 max-w-[260px] sm:max-w-xs truncate">${esc(webhookUrl)}</code>
              <button type="button" id="adm-copy-webhook-url" data-url="${esc(webhookUrl)}" class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">Copy Webhook URL</button>
            </div>
          </div>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[760px] text-left text-xs">
              <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
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
                        <td class="px-4 py-3">
                          <div class="font-mono text-slate-900 dark:text-white">${esc(p.receiptNumber)}</div>
                          <div class="text-slate-400 font-mono">${formatDate(p.createdAt)} · ${esc(p.mode)}</div>
                        </td>
                        <td class="px-4 py-3">
                          <div class="font-semibold text-slate-900 dark:text-white">${esc(p.contentTitle)}</div>
                          <div class="text-slate-500">${esc(p.buyerName)} (${esc(p.buyerEmail)})</div>
                        </td>
                        <td class="px-4 py-3 text-right font-mono tabular-nums">${formatInr(p.amountInr)}</td>
                        <td class="px-4 py-3 text-right font-mono tabular-nums">${p.platformCommissionInr ? `${formatInr(p.platformCommissionInr)} (${Number(p.commissionRate)}%)` : '—'}</td>
                        <td class="px-4 py-3 text-right font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">${p.creatorEarningsInr ? formatInr(p.creatorEarningsInr) : '—'}</td>
                        <td class="px-4 py-3">${renderStatusLabel(p.status)}</td>
                        <td class="px-4 py-3 text-right">
                          ${
                            p.status === 'captured'
                              ? `<button type="button" data-pid="${p.id}" class="adm-refund-btn font-semibold text-red-700 dark:text-red-400 hover:underline">Issue Refund</button>`
                              : `<span class="text-slate-400">—</span>`
                          }
                        </td>
                      </tr>
                    `
                        )
                        .join('')
                    : `<tr><td colspan="7" class="px-4 py-10 text-center text-slate-500">No payments recorded yet.</td></tr>`
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
        <div class="max-w-2xl space-y-5">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Platform Commission Policy</h1>
            <p class="text-xs text-slate-600 dark:text-slate-400 mt-1">Configure the default revenue-sharing rate (5%–20%) and creator payout threshold. Per-creator or per-item overrides take precedence.</p>
          </div>
          <form id="adm-comm-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            <div>
              <div class="flex items-center justify-between mb-2">
                <label class="text-xs font-semibold uppercase tracking-wider text-slate-500">Default Commission Rate</label>
                <span id="adm-comm-display" class="font-mono text-xl font-semibold text-[#0F2547] dark:text-sky-400 tabular-nums">${rate}%</span>
              </div>
              <input id="adm-comm-range" name="default_commission_rate" type="range" min="5" max="20" step="0.5" value="${rate}" class="w-full accent-[#0F2547]" />
              <div class="flex justify-between text-xs font-mono text-slate-400 mt-1"><span>5%</span><span>10%</span><span>15%</span><span>20%</span></div>
            </div>
            <div id="adm-comm-example" class="p-4 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 text-xs font-mono space-y-1 tabular-nums"></div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Minimum Creator Withdrawal Threshold (INR)</label>
              <input name="min_withdrawal_inr" type="number" min="10" value="${esc(settings.min_withdrawal_inr || '100')}" class="w-full sm:w-48 px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <button type="submit" class="px-5 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Save Commission Policy</button>
          </form>
        </div>
      `;
    } else if (activeTab === 'withdrawals') {
      const data = await apiFetch('/api/admin/withdrawals');
      bodyHtml = `
        <div class="space-y-5">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Creator Withdrawal Disbursements</h1>
            <p class="text-xs text-slate-500 mt-1">Workflow: Pending → Approved → Mark Paid (requires confirmed bank UTR / UPI reference ID).</p>
          </div>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[740px] text-left text-xs">
              <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
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
                              <td class="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">${formatDate(w.createdAt)}</td>
                              <td class="px-4 py-3">
                                <div class="font-semibold text-slate-900 dark:text-white">${esc(w.creatorName)}</div>
                                <div class="text-slate-500">${esc(w.creatorEmail)}</div>
                              </td>
                              <td class="px-4 py-3 font-mono">${esc(dest)}</td>
                              <td class="px-4 py-3 text-right font-mono font-semibold tabular-nums">${formatInr(w.amountInr)}</td>
                              <td class="px-4 py-3">
                                ${renderStatusLabel(w.status)}
                                ${w.payoutReference ? `<div class="text-[11px] font-mono text-slate-400">Ref: ${esc(w.payoutReference)}</div>` : ''}
                              </td>
                              <td class="px-4 py-3 text-right whitespace-nowrap space-x-2.5 font-semibold">
                                ${w.status === 'pending' ? `<button type="button" data-wid="${w.id}" data-act="approve" class="adm-wd-action text-emerald-700 dark:text-emerald-400 hover:underline">Approve</button>` : ''}
                                ${w.status === 'approved' ? `<button type="button" data-wid="${w.id}" class="adm-wd-paid text-[#0F2547] dark:text-sky-400 hover:underline">Confirm Paid</button>` : ''}
                                ${w.status === 'pending' || w.status === 'approved' ? `<button type="button" data-wid="${w.id}" class="adm-wd-reject text-red-700 dark:text-red-400 hover:underline">Reject</button>` : '<span class="text-slate-400">—</span>'}
                              </td>
                            </tr>
                          `;
                        })
                        .join('')
                    : `<tr><td colspan="6" class="px-4 py-10 text-center text-slate-500">No withdrawal requests yet.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === 'reports') {
      const data = await apiFetch('/api/admin/reports');
      bodyHtml = `
        <div class="space-y-5">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Reported Content &amp; Copyright Complaints</h1>
            <p class="text-xs text-slate-500 mt-1">Investigate flagged publications and execute takedowns or dismissals.</p>
          </div>
          <div class="space-y-3">
            ${
              data.reports.length
                ? data.reports
                    .map(
                      (r) => `
                  <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 space-y-3">
                    <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div>
                        <span class="font-semibold uppercase text-red-700 dark:text-red-400">${esc(r.reportType)}</span>
                        <span class="mx-1.5 text-slate-400">·</span>
                        <span class="text-slate-600 dark:text-slate-300">Reported by ${esc(r.reporterName)} on <span class="font-mono">${formatDate(r.createdAt)}</span></span>
                      </div>
                      ${renderStatusLabel(r.status)}
                    </div>
                    <div>
                      <a href="#/content/${esc(r.contentSlug)}" class="font-display text-base font-semibold text-slate-900 dark:text-white hover:underline">${esc(r.contentTitle)}</a>
                      <p class="text-xs text-slate-700 dark:text-slate-300 mt-1"><strong>Reason:</strong> ${esc(r.reason)}</p>
                      ${r.details ? `<p class="text-xs text-slate-500 mt-1">${esc(r.details)}</p>` : ''}
                      ${r.copyrightProof ? `<p class="text-xs font-mono text-slate-500 mt-1">Proof: ${esc(r.copyrightProof)}</p>` : ''}
                    </div>
                    ${
                      r.status === 'open' || r.status === 'reviewing'
                        ? `<div class="flex flex-wrap gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                            <button type="button" data-rid="${r.id}" data-remove="true" class="adm-report-resolve px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-700 text-white">Remove Content &amp; Resolve</button>
                            <button type="button" data-rid="${r.id}" data-remove="false" data-st="dismissed" class="adm-report-resolve px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700">Dismiss</button>
                          </div>`
                        : `<div class="text-xs text-slate-500">Resolution: ${esc(r.resolutionNote || 'Closed')}</div>`
                    }
                  </div>
                `
                    )
                    .join('')
                : `<div class="p-10 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">No reports filed.</div>`
            }
          </div>
        </div>
      `;
    } else if (activeTab === 'notifications') {
      bodyHtml = `
        <div class="max-w-2xl space-y-5">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Broadcast Platform Notice</h1>
            <p class="text-xs text-slate-500 mt-1">Deliver an official in-app announcement to all registered accounts or all creators.</p>
          </div>
          <form id="adm-broadcast-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Target Audience</label>
              <select name="audience" class="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                <option value="all">All Registered Accounts</option>
                <option value="creators">All Content Creators</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Announcement Title</label>
              <input name="title" required placeholder="e.g. Updated Creator Payout Schedule" class="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Message</label>
              <textarea name="message" rows="4" required class="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]"></textarea>
            </div>
            <button type="submit" class="px-5 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Dispatch Broadcast</button>
          </form>
        </div>
      `;
    } else if (activeTab === 'settings') {
      const [settingsRes, { logs }] = await Promise.all([
        apiFetch('/api/admin/settings'),
        apiFetch('/api/admin/audit-logs'),
      ]);
      const settings = settingsRes.settings || {};
      const mailerOk = Boolean(settingsRes.mailerConfigured);

      bodyHtml = `
        <div class="space-y-6">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Platform Settings, Email &amp; Audit Trail</h1>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <form id="adm-site-settings-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-500">General Configuration</h2>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Platform Name</label>
                <input name="site_name" value="${esc(settings.site_name || 'ScholarPress')}" class="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Editorial Support Email</label>
                <input name="support_email" value="${esc(settings.support_email || '')}" class="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Homepage Announcement Banner</label>
                <input name="announcement_banner" value="${esc(settings.announcement_banner || '')}" placeholder="Leave blank to hide" class="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <label class="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input type="checkbox" name="require_content_approval" ${settings.require_content_approval !== 'false' ? 'checked' : ''} />
                <span>Require administrator approval before new creator uploads go live</span>
              </label>
              <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Save Configuration</button>
            </form>

            <!-- Gmail SMTP Status Card -->
            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3.5">
              <div class="flex items-center justify-between gap-2">
                <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-500">Gmail SMTP Notification Engine</h2>
                <span class="text-xs font-semibold ${mailerOk ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}">
                  ${mailerOk ? 'Connected' : 'Not Configured'}
                </span>
              </div>
              <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Used automatically to email users the exact deletion reason when their account is permanently erased, and optional restriction notices on timed blocks.
              </p>
              ${
                mailerOk
                  ? `<div class="p-3 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-900/70 text-xs space-y-1 font-mono">
                      <div>Host: ${esc(settingsRes.smtpHost || 'smtp.gmail.com')}</div>
                      <div>Sender: ${esc(settingsRes.smtpUser || 'Configured')}</div>
                    </div>`
                  : `<div class="p-3.5 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 text-[11px] space-y-1.5 text-slate-600 dark:text-slate-300">
                      <div class="font-semibold text-slate-900 dark:text-white">To activate Gmail delivery on Render, add these Environment Variables:</div>
                      <div class="font-mono space-y-0.5 text-slate-700 dark:text-slate-300">
                        <div>SMTP_HOST=smtp.gmail.com</div>
                        <div>SMTP_PORT=465</div>
                        <div>SMTP_USER=personal.shubham1872@gmail.com</div>
                        <div>SMTP_PASS=&lt;16-character Gmail App Password&gt;</div>
                      </div>
                    </div>`
              }
            </div>
          </div>

          <!-- Administrator Audit Trail -->
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <h2 class="text-sm font-semibold text-slate-900 dark:text-white">Administrator Audit Trail</h2>
              <a href="#/admin/history" class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">Open Full Admin History →</a>
            </div>
            <div class="overflow-x-auto touch-scroll-x">
              <table class="w-full min-w-[600px] text-left text-xs">
                <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
                  <tr>
                    <th class="px-4 py-2.5 font-semibold">Timestamp</th>
                    <th class="px-4 py-2.5 font-semibold">Actor</th>
                    <th class="px-4 py-2.5 font-semibold">Action</th>
                    <th class="px-4 py-2.5 font-semibold">Target Entity</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                  ${logs
                    .map(
                      (l) => `
                    <tr>
                      <td class="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">${formatDateTime(l.createdAt)}</td>
                      <td class="px-4 py-2.5 font-medium text-slate-900 dark:text-white">${esc(l.actorName || 'System')}</td>
                      <td class="px-4 py-2.5 font-mono text-slate-700 dark:text-slate-300">${esc(l.action)}</td>
                      <td class="px-4 py-2.5 text-slate-500 font-mono">${esc(l.entityType)}${l.entityId ? ` #${esc(l.entityId)}` : ''}</td>
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
    } else if (activeTab === 'history') {
      const qs = window.location.hash.includes('?')
        ? new URLSearchParams(window.location.hash.split('?')[1])
        : new URLSearchParams();
      const activeCategory = qs.get('category') || 'all';
      const searchQ = qs.get('q') || '';
      const apiQs = new URLSearchParams();
      if (activeCategory && activeCategory !== 'all') apiQs.set('category', activeCategory);
      if (searchQ) apiQs.set('q', searchQ);

      const histRes = await apiFetch(`/api/admin/history${apiQs.toString() ? `?${apiQs}` : ''}`);
      const rows = histRes.history || [];
      const counts = histRes.counts || {};

      const filterDefs = [
        { id: 'all', label: 'All Actions', count: counts.all || 0 },
        { id: 'blocks', label: 'Blocks & Suspensions', count: counts.blocks || 0 },
        { id: 'deletions', label: 'Permanent Deletes', count: counts.deletions || 0 },
        { id: 'users', label: 'Role & User Changes', count: counts.users || 0 },
        { id: 'content', label: 'Content & Reports', count: counts.content || 0 },
        { id: 'finance', label: 'Finance & Payouts', count: counts.finance || 0 },
        { id: 'system', label: 'Broadcasts & Settings', count: counts.system || 0 },
      ];

      const actionTone = (action) => {
        if (action === 'delete_user_permanent' || action === 'user_blocked') return 'text-red-700 dark:text-red-400';
        if (action === 'user_suspended' || action === 'refund_payment') return 'text-amber-700 dark:text-amber-400';
        if (action === 'user_unblocked' || action === 'withdrawal_paid') return 'text-emerald-700 dark:text-emerald-400';
        return 'text-[#0F2547] dark:text-sky-400';
      };

      topRightAction = `<a href="#/admin/users" class="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap">User Directory</a>`;

      bodyHtml = `
        <div class="space-y-5">
          <div>
            <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Admin Console History</h1>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Complete chronological record of every suspension, block, permanent account deletion, role change, content moderation, payout, and settings update. Click <strong>Details</strong> on any entry to view full changes and the complete history of that entity.
            </p>
          </div>

          <!-- Category Filter Tabs + Search -->
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-3">
            <div class="flex flex-wrap gap-1.5">
              ${filterDefs
                .map(
                  (f) => `
                <a href="#/admin/history?category=${encodeURIComponent(f.id)}${searchQ ? `&q=${encodeURIComponent(searchQ)}` : ''}" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    activeCategory === f.id
                      ? 'bg-[#0F2547] text-white dark:bg-sky-500 dark:text-slate-950'
                      : 'bg-slate-100 dark:bg-[#0B1120] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
                  }">
                  ${esc(f.label)} <span class="font-mono opacity-80">(${f.count})</span>
                </a>
              `
                )
                .join('')}
            </div>

            <form id="adm-history-search-form" class="flex flex-wrap items-center gap-2">
              <input type="hidden" name="category" value="${esc(activeCategory)}" />
              <input name="q" type="search" value="${esc(searchQ)}" placeholder="Search by user name, email, UID, admin actor, reason, or action..." class="flex-1 min-w-[220px] px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Filter</button>
              ${searchQ ? `<a href="#/admin/history?category=${encodeURIComponent(activeCategory)}" class="text-xs text-slate-500 hover:underline px-2">Clear</a>` : ''}
            </form>
          </div>

          <!-- Admin History Ledger Table -->
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[880px] text-left text-xs">
              <thead class="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120]/60">
                <tr>
                  <th class="px-4 py-3 font-semibold">Action</th>
                  <th class="px-4 py-3 font-semibold">Target &amp; Summary of Change</th>
                  <th class="px-4 py-3 font-semibold">Performed By</th>
                  <th class="px-4 py-3 font-semibold">Date, Time &amp; Age</th>
                  <th class="px-4 py-3 font-semibold text-right">Inspect</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                ${
                  rows.length
                    ? rows
                        .map(
                          (row) => `
                      <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                        <td class="px-4 py-3 whitespace-nowrap">
                          <div class="font-semibold ${actionTone(row.action)}">${esc(row.actionLabel)}</div>
                          <div class="text-[10px] font-mono text-slate-400 uppercase">${esc(row.entityType)}${row.entityId ? ` #${esc(row.entityId)}` : ''}</div>
                        </td>
                        <td class="px-4 py-3 max-w-[360px]">
                          <div class="text-slate-800 dark:text-slate-200 leading-relaxed">${esc(row.summary)}</div>
                        </td>
                        <td class="px-4 py-3 whitespace-nowrap">
                          <div class="font-medium text-slate-900 dark:text-white">${esc(row.actorName || 'System')}</div>
                          ${row.actorEmail ? `<div class="text-[11px] text-slate-500">${esc(row.actorEmail)}</div>` : ''}
                        </td>
                        <td class="px-4 py-3 whitespace-nowrap">
                          <div class="font-medium text-slate-800 dark:text-slate-200">${esc(formatRelativeAge(row.createdAt))}</div>
                          <div class="text-[11px] font-mono text-slate-500">${esc(formatDateTime(row.createdAt))}</div>
                        </td>
                        <td class="px-4 py-3 text-right whitespace-nowrap">
                          <button type="button" data-adm-hist-id="${row.id}" class="adm-hist-detail-btn px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-[#0F2547] dark:text-sky-400">
                            Details
                          </button>
                        </td>
                      </tr>
                    `
                        )
                        .join('')
                    : `<tr><td colspan="5" class="px-4 py-10 text-center text-slate-500">No admin actions matched this filter yet.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
        <div class="flex flex-col lg:flex-row gap-6">
          <!-- Grouped Executive Left Navigation Sidebar -->
          <aside class="lg:w-[256px] shrink-0">
            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 lg:sticky lg:top-20">
              <div class="px-2 pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-display font-semibold text-sm text-slate-900 dark:text-white">Admin Console</span>
                  <span class="text-[11px] font-mono font-semibold ${store.user.isSuperAdmin ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500'}">
                    ${store.user.isSuperAdmin ? 'Super Admin' : 'Admin'}
                  </span>
                </div>
                <div class="text-[11px] text-slate-500 truncate mt-0.5">${esc(store.user.email)}</div>
              </div>

              <!-- Mobile horizontal tab strip -->
              <nav class="flex lg:hidden gap-1.5 overflow-x-auto no-scrollbar touch-scroll-x pb-1">
                ${ALL_TABS.map(
                  (t) => `
                  <a href="#/admin/${t.id}" class="flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-lg text-xs font-medium whitespace-nowrap shrink-0 ${
                    activeTab === t.id
                      ? 'bg-[#0F2547] text-white dark:bg-sky-500 dark:text-slate-950'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }">${esc(t.label)}</a>
                `
                ).join('')}
              </nav>

              <!-- Desktop grouped vertical sidebar -->
              <nav class="hidden lg:block space-y-4">
                ${NAV_GROUPS.map(
                  (grp) => `
                  <div>
                    <div class="px-2.5 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">${esc(grp.group)}</div>
                    <div class="space-y-0.5">
                      ${grp.items
                        .map((item) => {
                          const cnt = item.countKey ? Number(sidebarCounts[item.countKey] || 0) : 0;
                          const isActive = activeTab === item.id;
                          const countColor = isActive
                            ? 'text-white/80 dark:text-slate-950/80'
                            : item.countTone === 'danger' && cnt > 0
                            ? 'text-red-600 dark:text-red-400'
                            : item.countTone === 'warn' && cnt > 0
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-slate-400';
                          return `
                            <a href="#/admin/${item.id}" class="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                              isActive
                                ? 'bg-[#0F2547] text-white dark:bg-sky-500 dark:text-slate-950'
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                            }">
                              <span class="truncate">${esc(item.label)}</span>
                              ${cnt > 0 ? `<span class="font-mono text-[11px] font-semibold tabular-nums ${countColor}">${cnt}</span>` : ''}
                            </a>
                          `;
                        })
                        .join('')}
                    </div>
                  </div>
                `
                ).join('')}
              </nav>

              <div class="hidden lg:flex items-center justify-between pt-3 mt-4 border-t border-slate-100 dark:border-slate-800 px-2 text-[11px] text-slate-500">
                <a href="#/creator" class="hover:text-slate-900 dark:hover:text-white">Creator Studio →</a>
                <a href="#/dashboard" class="hover:text-slate-900 dark:hover:text-white">Reader →</a>
              </div>
            </div>
          </aside>

          <!-- Main Executive Workspace -->
          <div class="flex-1 min-w-0 space-y-5">
            <!-- Contextual Top Workspace Bar -->
            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2 text-xs">
                <a href="#/admin/overview" class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">Admin Console</a>
                <span class="text-slate-300 dark:text-slate-700">/</span>
                <span class="font-semibold text-slate-900 dark:text-white">${esc(breadcrumbTitle)}</span>
              </div>
              <div class="flex items-center gap-2">
                ${topRightAction}
              </div>
            </div>

            ${bodyHtml}
          </div>
        </div>
      </div>
    `;

    wireAdminHandlers(container, activeTab, subParam);
  } catch (err) {
    container.innerHTML = `<div class="max-w-3xl mx-auto p-12 text-red-600 text-sm">${esc(err.message)}</div>`;
  }
}

function renderUserDirectoryRows(userList, canManageAdmins) {
  if (!userList.length) {
    return `<tr><td colspan="6" class="px-4 py-10 text-center text-slate-500">No users match the current filter.</td></tr>`;
  }
  return userList
    .map((u) => {
      const isPrimary = Boolean(u.isSuperAdmin);
      const lockedForActor = isPrimary || (u.role === 'admin' && !canManageAdmins);
      const allowedRoles = canManageAdmins ? ['user', 'creator', 'admin'] : ['user', 'creator'];
      const isRestricted = u.status === 'blocked' || u.status === 'suspended';

      return `
        <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-900/35">
          <td class="px-4 py-3">
            <div class="flex items-center gap-1.5">
              <span class="font-semibold text-slate-900 dark:text-white">${esc(u.name)}</span>
              ${isPrimary ? '<span class="text-[11px] font-semibold text-amber-700 dark:text-amber-400">· Primary Super Admin</span>' : ''}
            </div>
            <div class="text-[11px] text-slate-500">${esc(u.email)}</div>
          </td>
          <td class="px-4 py-3 font-mono">
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
                ? `<span class="font-semibold text-slate-700 dark:text-slate-200">${isPrimary ? 'Super Admin (Locked)' : 'Admin (Locked)'}</span>`
                : `<select data-user-id="${u.id}" class="adm-user-role text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                    ${allowedRoles.map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                  </select>`
            }
          </td>
          <td class="px-4 py-3 max-w-[230px]">
            <div>${renderStatusLabel(u.status)}</div>
            ${
              isRestricted
                ? `<div class="text-[11px] font-mono text-red-700 dark:text-red-400 mt-0.5">${esc(formatBlockRemaining(u.blockedUntil))}</div>
                   ${u.blockedReason ? `<div class="text-[11px] text-slate-500 truncate" title="${esc(u.blockedReason)}">${esc(u.blockedReason)}</div>` : ''}`
                : ''
            }
          </td>
          <td class="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">${formatDate(u.createdAt)}</td>
          <td class="px-4 py-3 text-right whitespace-nowrap space-x-2.5 font-semibold">
            ${
              !isPrimary
                ? `<a href="#/admin/tracker/${u.id}" class="text-[#0F2547] dark:text-sky-400 hover:underline">Track</a>`
                : ''
            }
            ${
              lockedForActor
                ? `<span class="text-slate-400 font-normal">${isPrimary ? 'Shielded' : 'Protected'}</span>`
                : `
                  ${
                    isRestricted
                      ? `<button type="button" data-unblock-uid="${u.id}" class="adm-unblock-user text-emerald-700 dark:text-emerald-400 hover:underline">Unblock</button>`
                      : ''
                  }
                  <button type="button" data-block-uid="${u.id}" class="adm-open-block-modal text-amber-700 dark:text-amber-400 hover:underline">${isRestricted ? 'Edit Block' : 'Block'}</button>
                  <button type="button" data-delete-uid="${u.id}" class="adm-open-delete-modal text-red-700 dark:text-red-400 hover:underline">Delete</button>
                `
            }
          </td>
        </tr>
      `;
    })
    .join('');
}

function wireUserRowActionHandlers(container, activeTab, subParam) {
  // Role select changes
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
        renderAdminDashboardPage(container, activeTab, subParam);
      }
    });
  });

  // Unblock / restore active
  container.querySelectorAll('.adm-unblock-user').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/api/admin/users/${btn.dataset.unblockUid}`, {
          method: 'PATCH',
          body: { status: 'active' },
        });
        showToast('Account restored to active status.', 'success');
        renderAdminDashboardPage(container, activeTab, subParam);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // Timed Block / Suspend modal
  container.querySelectorAll('.adm-open-block-modal').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = Number(btn.dataset.blockUid);
      const userObj = cachedAdminUsers.find((u) => Number(u.id) === uid);
      if (!userObj) return;
      openBlockUserModal(userObj, () => {
        renderAdminDashboardPage(container, activeTab, subParam);
      });
    });
  });

  // Permanent Delete Account modal
  container.querySelectorAll('.adm-open-delete-modal').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = Number(btn.dataset.deleteUid);
      const userObj = cachedAdminUsers.find((u) => Number(u.id) === uid);
      if (!userObj) return;
      openDeleteUserModal(userObj, () => {
        if (activeTab === 'tracker' && subParam) {
          window.location.hash = '#/admin/deleted-accounts';
        } else {
          renderAdminDashboardPage(container, activeTab, subParam);
        }
      });
    });
  });
}

function wireAdminHandlers(container, activeTab, subParam = null) {
  wireUserRowActionHandlers(container, activeTab, subParam);

  // User Directory live client-side search & filters
  if (activeTab === 'users') {
    const searchInput = document.getElementById('adm-users-search');
    const roleFilter = document.getElementById('adm-users-role-filter');
    const statusFilter = document.getElementById('adm-users-status-filter');
    const tbody = document.getElementById('adm-users-tbody');
    const canManageAdmins = Boolean(store.user?.isSuperAdmin);

    const applyFilters = () => {
      if (!tbody) return;
      const q = (searchInput?.value || '').trim().replace(/^@+/, '').toLowerCase();
      const role = roleFilter?.value || 'all';
      const st = statusFilter?.value || 'all';

      const filtered = cachedAdminUsers.filter((u) => {
        if (role !== 'all' && u.role !== role) return false;
        if (st === 'active' && u.status !== 'active') return false;
        if (st === 'restricted' && u.status === 'active') return false;
        if (!q) return true;
        return (
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.publicUid && u.publicUid.toLowerCase().includes(q)) ||
          (u.username && u.username.toLowerCase().includes(q))
        );
      });

      tbody.innerHTML = renderUserDirectoryRows(filtered, canManageAdmins);
      wireUserRowActionHandlers(container, activeTab, subParam);
    };

    searchInput?.addEventListener('input', applyFilters);
    roleFilter?.addEventListener('change', applyFilters);
    statusFilter?.addEventListener('change', applyFilters);
  }

  // User Tracker search & dossier refresh
  document.getElementById('adm-tracker-search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = String(new FormData(e.target).get('q') || '').trim();
    if (!q) {
      window.location.hash = '#/admin/tracker';
      return;
    }
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

  // Copy Razorpay webhook URL
  document.getElementById('adm-copy-webhook-url')?.addEventListener('click', async (e) => {
    const url = e.currentTarget.dataset.url || '';
    try {
      await navigator.clipboard.writeText(url);
      showToast('Webhook URL copied to clipboard.', 'success');
    } catch {
      showToast(url, 'info');
    }
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

  // Admin History search & Details modal (shows full diff + chronological Entity History)
  document.getElementById('adm-history-search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const cat = String(fd.get('category') || 'all');
    const q = String(fd.get('q') || '').trim();
    const qs = new URLSearchParams();
    if (cat && cat !== 'all') qs.set('category', cat);
    if (q) qs.set('q', q);
    window.location.hash = `#/admin/history${qs.toString() ? `?${qs}` : ''}`;
  });

  container.querySelectorAll('.adm-hist-detail-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const histId = btn.dataset.admHistId;
      btn.disabled = true;
      btn.textContent = 'Loading...';
      try {
        const res = await apiFetch(`/api/admin/history/${histId}`);
        const entry = res.entry;
        const snap = res.entitySnapshot;
        const entityTimeline = res.entityHistory || [];
        const detailEntries = Object.entries(entry.details || {}).filter(
          ([, v]) => v !== null && v !== undefined && v !== ''
        );

        const formatDetailVal = (k, v) => {
          if (typeof v === 'boolean') return v ? 'Yes' : 'No';
          if (
            (k.toLowerCase().includes('until') || k.toLowerCase().includes('at')) &&
            typeof v === 'string' &&
            !Number.isNaN(new Date(v).getTime())
          ) {
            return formatDateTime(v);
          }
          if (typeof v === 'object') return JSON.stringify(v);
          return String(v);
        };

        openModal({
          title: `Action History Detail — ${entry.actionLabel}`,
          widthClass: 'max-w-2xl',
          bodyHtml: `
            <div class="space-y-5 text-xs">
              <div class="p-4 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 space-y-1.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-semibold text-sm text-slate-900 dark:text-white">${esc(entry.actionLabel)}</span>
                  <span class="font-mono text-[11px] text-slate-500">#${entry.id} · ${esc(entry.entityType)}${entry.entityId ? ` #${esc(entry.entityId)}` : ''}</span>
                </div>
                <p class="text-slate-700 dark:text-slate-300 leading-relaxed">${esc(entry.summary)}</p>
                <div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 pt-1">
                  <span>By: <strong class="text-slate-800 dark:text-slate-200">${esc(entry.actorName || 'System')}</strong>${entry.actorEmail ? ` (${esc(entry.actorEmail)})` : ''}</span>
                  <span>When: <strong class="text-slate-800 dark:text-slate-200">${esc(formatRelativeAge(entry.createdAt))}</strong> (${esc(formatDateTime(entry.createdAt))})</span>
                  ${entry.ipAddress ? `<span class="font-mono">IP: ${esc(entry.ipAddress)}</span>` : ''}
                </div>
              </div>

              ${
                snap
                  ? `<div class="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E]">
                      <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Current Entity Status</div>
                      ${
                        snap.exists
                          ? `<div class="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div class="font-semibold text-slate-900 dark:text-white">${esc(snap.name || snap.title || '')}</div>
                                <div class="text-slate-500 font-mono text-[11px]">${esc(snap.email || snap.slug || '')}${snap.publicUid ? ` · UID: ${esc(snap.publicUid)}` : ''}</div>
                              </div>
                              <div>${renderStatusLabel(snap.status)}</div>
                            </div>`
                          : `<div class="text-red-700 dark:text-red-400 font-medium">${esc(snap.note || 'Entity no longer exists.')}</div>`
                      }
                    </div>`
                  : ''
              }

              <!-- Structured Change Details -->
              <div>
                <h3 class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Recorded Changes &amp; Metadata</h3>
                ${
                  detailEntries.length
                    ? `<dl class="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-4">
                        ${detailEntries
                          .map(
                            ([k, v]) => `
                          <div class="py-2.5 flex items-start justify-between gap-4">
                            <dt class="text-slate-500 capitalize shrink-0">${esc(k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' '))}</dt>
                            <dd class="font-mono text-slate-900 dark:text-slate-100 text-right break-words max-w-[65%]">${esc(formatDetailVal(k, v))}</dd>
                          </div>
                        `
                          )
                          .join('')}
                      </dl>`
                    : `<p class="text-slate-500">No extra detail fields were attached to this action.</p>`
                }
              </div>

              <!-- Complete Entity History Timeline -->
              ${
                entityTimeline.length > 0
                  ? `<div>
                      <h3 class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Complete History for This ${esc(entry.entityType)} (${entityTimeline.length} event${entityTimeline.length > 1 ? 's' : ''})</h3>
                      <div class="space-y-2 max-h-64 overflow-y-auto pr-1">
                        ${entityTimeline
                          .map(
                            (ev) => `
                          <div class="p-3 rounded-lg border ${
                            ev.id === entry.id
                              ? 'border-[#0F2547] dark:border-sky-400 bg-slate-50 dark:bg-[#0B1120]'
                              : 'border-slate-200 dark:border-slate-800'
                          }">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                              <span class="font-semibold text-slate-900 dark:text-white">${esc(ev.actionLabel)}${ev.id === entry.id ? ' (Current)' : ''}</span>
                              <span class="font-mono text-[11px] text-slate-500">${esc(formatRelativeAge(ev.createdAt))} · ${esc(formatDateTime(ev.createdAt))}</span>
                            </div>
                            <div class="text-slate-600 dark:text-slate-300 mt-1">${esc(ev.summary)}</div>
                            <div class="text-[11px] text-slate-400 mt-1">Actor: ${esc(ev.actorName || 'System')}</div>
                          </div>
                        `
                          )
                          .join('')}
                      </div>
                    </div>`
                  : ''
              }
            </div>
          `,
        });
      } catch (err) {
        showToast(err.message || 'Unable to load history details.', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Details';
      }
    });
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
