import {
  apiFetch,
  esc,
  formatDate,
  formatInr,
  LANGUAGES,
  notifyStore,
  openModal,
  refreshCurrentUser,
  renderContentCard,
  renderStatusLabel,
  setSessionToken,
  showToast,
  store,
} from './api.js';
import { signInWithGoogle } from './firebase.js';

export function renderAuthPage(container, mode = 'login') {
  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';
  const isReset = mode === 'reset';
  const isVerify = mode === 'verify';

  if (isForgot) {
    container.innerHTML = `
      <div class="max-w-md mx-auto px-4 py-8 sm:py-16">
        <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-8">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-2">Forgot Password</h1>
          <p class="text-sm text-slate-600 dark:text-slate-400 mb-6">Enter your registered email address to request a secure password reset.</p>
          <form id="forgot-form" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Email Address</label>
              <input name="email" type="email" required class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <button type="submit" class="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 text-white dark:text-slate-950">Request Password Reset</button>
          </form>
          <div id="forgot-result" class="mt-4"></div>
          <p class="text-xs text-slate-500 mt-6 text-center"><a href="#/login" class="font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">Back to Sign In</a></p>
        </div>
      </div>
    `;
    document.getElementById('forgot-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = new FormData(e.target).get('email');
      try {
        const res = await apiFetch('/api/auth/forgot-password', { method: 'POST', body: { email } });
        const box = document.getElementById('forgot-result');
        box.innerHTML = `
          <div class="p-4 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 text-xs space-y-2">
            <p class="text-slate-700 dark:text-slate-300">${esc(res.message)}</p>
          </div>
        `;
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    return;
  }

  if (isReset) {
    const qs = window.location.hash.includes('?')
      ? new URLSearchParams(window.location.hash.split('?')[1])
      : new URLSearchParams();
    const prefillToken = qs.get('token') || '';
    container.innerHTML = `
      <div class="max-w-md mx-auto px-4 py-8 sm:py-16">
        <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-8">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-2">Reset Password</h1>
          <p class="text-sm text-slate-600 dark:text-slate-400 mb-6">Provide your reset token and choose a new password (minimum 8 characters).</p>
          <form id="reset-form" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Reset Token</label>
              <input name="token" value="${esc(prefillToken)}" required class="w-full px-3.5 py-2.5 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">New Password</label>
              <input name="password" type="password" minlength="8" required class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <button type="submit" class="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 text-white dark:text-slate-950">Update Password</button>
          </form>
        </div>
      </div>
    `;
    document.getElementById('reset-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await apiFetch('/api/auth/reset-password', {
          method: 'POST',
          body: { token: fd.get('token'), password: fd.get('password') },
        });
        showToast(res.message, 'success');
        window.location.hash = '#/login';
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    return;
  }

  if (isVerify) {
    const qs = window.location.hash.includes('?')
      ? new URLSearchParams(window.location.hash.split('?')[1])
      : new URLSearchParams();
    const prefillToken = qs.get('token') || '';
    container.innerHTML = `
      <div class="max-w-md mx-auto px-4 py-8 sm:py-16">
        <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-8">
          <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-2">Verify Email Address</h1>
          <p class="text-sm text-slate-600 dark:text-slate-400 mb-6">Confirm your email verification token below to mark your account verified.</p>
          <form id="verify-form" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Verification Token</label>
              <input name="token" value="${esc(prefillToken)}" required class="w-full px-3.5 py-2.5 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <button type="submit" class="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 text-white dark:text-slate-950">Verify Email</button>
          </form>
        </div>
      </div>
    `;
    document.getElementById('verify-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = new FormData(e.target).get('token');
      try {
        const res = await apiFetch('/api/auth/verify-email', { method: 'POST', body: { token } });
        showToast(res.message, 'success');
        await refreshCurrentUser();
        window.location.hash = '#/dashboard';
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    return;
  }

  container.innerHTML = `
    <div class="max-w-md mx-auto px-4 py-8 sm:py-14">
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-8">
        <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-1.5">
          ${isSignup ? 'Create your ScholarPress account' : 'Sign in to ScholarPress'}
        </h1>
        <p class="text-sm text-slate-600 dark:text-slate-400 mb-6">
          ${isSignup ? 'Read free resources, build your library, or publish and monetize your work.' : 'Access your library, creator studio, and payouts.'}
        </p>

        <!-- Primary Google Sign-In (Firebase Auth) -->
        <button type="button" id="google-signin-btn" class="w-full py-2.5 px-4 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1120] hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-900 dark:text-white flex items-center justify-center gap-2.5 transition-colors mb-5">
          <svg class="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"/><path fill="#FBBC05" d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"/><path fill="#EA4335" d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>
          Continue with Google
        </button>

        <div class="relative my-5">
          <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-slate-200 dark:border-slate-800"></div></div>
          <div class="relative flex justify-center text-xs"><span class="px-3 bg-white dark:bg-[#111A2E] text-slate-400">or continue with email</span></div>
        </div>

        <form id="auth-email-form" class="space-y-4">
          ${
            isSignup
              ? `<div>
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Full Name</label>
                  <input name="name" required placeholder="e.g. Aarav Sharma" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
                </div>`
              : ''
          }
          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Email Address</label>
            <input name="email" type="email" required placeholder="you@university.edu" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
          </div>
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">Password</label>
              ${!isSignup ? `<a href="#/forgot-password" class="text-xs text-[#1B3B6F] dark:text-sky-400 hover:underline">Forgot password?</a>` : ''}
            </div>
            <input name="password" type="password" minlength="8" required placeholder="Minimum 8 characters" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
          </div>
          ${
            isSignup
              ? `<label class="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer pt-1">
                  <input type="checkbox" name="registerAsCreator" class="mt-0.5 rounded" />
                  <span>Also enable <strong>Creator / Publisher</strong> tools so I can upload notes, PDFs, articles, and lectures (I agree to the <a href="#/terms" class="underline">Creator Agreement</a>).</span>
                </label>`
              : ''
          }
          <button type="submit" class="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors">
            ${isSignup ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <p class="text-xs text-slate-500 dark:text-slate-400 mt-6 text-center">
          ${
            isSignup
              ? 'Already have an account? <a href="#/login" class="font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">Sign in</a>'
              : 'New to ScholarPress? <a href="#/signup" class="font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">Create an account</a>'
          }
        </p>
      </div>
    </div>
  `;

  document.getElementById('google-signin-btn')?.addEventListener('click', async () => {
    try {
      const { idToken } = await signInWithGoogle();
      setSessionToken(null); // Use Firebase ID token
      const res = await apiFetch('/api/auth/firebase-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      store.user = res.user;
      notifyStore();
      showToast(`Signed in as ${res.user.name}.`, 'success');
      window.location.hash = res.user.role === 'admin' ? '#/admin' : '#/dashboard';
    } catch (err) {
      showToast(err.message || 'Google Sign-In was cancelled or failed.', 'error');
    }
  });

  document.getElementById('auth-email-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const endpoint = isSignup ? '/api/auth/register' : '/api/auth/login';
      const payload = isSignup
        ? {
            name: fd.get('name'),
            email: fd.get('email'),
            password: fd.get('password'),
            registerAsCreator: fd.get('registerAsCreator') === 'on',
          }
        : {
            email: fd.get('email'),
            password: fd.get('password'),
          };

      const res = await apiFetch(endpoint, { method: 'POST', body: payload });
      setSessionToken(res.token);
      store.user = res.user;
      notifyStore();
      showToast(isSignup ? 'Account created successfully.' : `Welcome back, ${res.user.name}.`, 'success');

      if (isSignup && res.verificationTokenPreview) {
        window.location.hash = `#/verify-email?token=${encodeURIComponent(res.verificationTokenPreview)}`;
      } else {
        window.location.hash = res.user.role === 'admin' ? '#/admin' : res.user.role === 'creator' ? '#/creator' : '#/dashboard';
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

export function renderBecomeCreatorPage(container) {
  if (!store.user) {
    container.innerHTML = `
      <div class="max-w-2xl mx-auto px-4 py-16 text-center">
        <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-10">
          <h1 class="font-display text-3xl font-semibold text-slate-900 dark:text-white mb-3">Publish &amp; Earn on ScholarPress</h1>
          <p class="text-sm text-slate-600 dark:text-slate-400 mb-7 leading-relaxed">
            Turn your study notes, PDF monographs, research papers, video lectures, poems, and stories into recurring educational impact and INR income. Sign in or register first to activate your Creator Studio.
          </p>
          <div class="flex items-center justify-center gap-3">
            <a href="#/signup" class="px-5 py-2.5 text-sm font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Create Account</a>
            <a href="#/login" class="px-5 py-2.5 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700">Sign In</a>
          </div>
        </div>
      </div>
    `;
    return;
  }

  if (store.user.role === 'creator' || store.user.role === 'admin') {
    window.location.hash = '#/creator';
    return;
  }

  container.innerHTML = `
    <div class="max-w-2xl mx-auto px-4 py-8 sm:py-12">
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-8">
        <h1 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white mb-2">Activate Creator Publishing</h1>
        <p class="text-sm text-slate-600 dark:text-slate-400 mb-6">
          Set up your public author profile and preferred INR payout method to start uploading free or paid educational content.
        </p>

        <form id="become-creator-form" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Public Author / Creator Name</label>
            <input name="displayName" value="${esc(store.user.name)}" required class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Academic Tagline</label>
            <input name="tagline" placeholder="e.g. Mathematics Educator & Competitive Exam Mentor" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Subjects &amp; Areas of Expertise</label>
            <input name="expertise" placeholder="e.g. Organic Chemistry, NEET Revision, Indian Polity" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Preferred Payout Method</label>
              <select name="payoutMethod" id="bc-payout-method" class="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                <option value="upi">UPI (India)</option>
                <option value="bank_transfer">Bank Transfer (NEFT / IMPS)</option>
              </select>
            </div>
            <div id="bc-upi-wrap">
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">UPI ID (optional now)</label>
              <input name="upiId" placeholder="yourname@upi" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
          </div>

          <label class="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 pt-2">
            <input type="checkbox" name="acceptedAgreement" required class="mt-0.5 rounded" />
            <span>I confirm that I will only publish original or properly licensed educational works, and I accept the <a href="#/terms" class="underline font-semibold">Creator Agreement, Commission Policy (5%–20%), and Content Guidelines</a>.</span>
          </label>

          <button type="submit" class="px-6 py-2.5 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 text-white dark:text-slate-950">
            Activate Creator Dashboard
          </button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('become-creator-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await apiFetch('/api/auth/become-creator', {
        method: 'POST',
        body: {
          displayName: fd.get('displayName'),
          tagline: fd.get('tagline'),
          expertise: fd.get('expertise'),
          payoutMethod: fd.get('payoutMethod'),
          payoutDetails: fd.get('upiId') ? { upiId: fd.get('upiId') } : {},
          acceptedAgreement: fd.get('acceptedAgreement') === 'on',
        },
      });
      store.user = res.user;
      notifyStore();
      showToast(res.message, 'success');
      window.location.hash = '#/creator';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

export async function renderUserDashboardPage(container, activeTab = 'overview') {
  if (!store.user) {
    window.location.hash = '#/login';
    return;
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'library', label: 'My Library & Purchases' },
    { id: 'bookmarks', label: 'Bookmarks' },
    { id: 'following', label: 'Following' },
    { id: 'history', label: 'Purchase History' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'settings', label: 'Profile Settings' },
  ];

  container.innerHTML = `<div class="max-w-7xl mx-auto px-4 py-12 text-sm text-slate-500">Loading your dashboard...</div>`;

  try {
    const data = await apiFetch('/api/community/user-dashboard');
    const activePurchases = (data.purchases || []).filter((p) => p.status === 'active');
    const unreadCount = (data.notifications || []).filter((n) => !n.isRead).length;

    let tabBody = '';

    if (activeTab === 'overview') {
      tabBody = `
        <div class="space-y-8">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500 dark:text-slate-400">Purchased Resources</div>
              <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${activePurchases.length}</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500 dark:text-slate-400">Saved Bookmarks</div>
              <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${data.bookmarks.length}</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500 dark:text-slate-400">Creators Followed</div>
              <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${data.following.length}</div>
            </div>
            <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
              <div class="text-xs text-slate-500 dark:text-slate-400">Unread Notifications</div>
              <div class="font-mono text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">${unreadCount}</div>
            </div>
          </div>

          ${
            !store.user.emailVerified
              ? `<div class="p-5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 flex flex-wrap items-center justify-between gap-4">
                  <div class="text-sm text-amber-900 dark:text-amber-200">
                    <strong>Email verification pending:</strong> Verify your email address to secure account recovery and notifications.
                  </div>
                  <button type="button" id="dash-resend-verify" class="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-800 text-white whitespace-nowrap shrink-0">Generate Verification Link</button>
                </div>`
              : ''
          }

          ${
            store.user.role === 'user'
              ? `<div class="p-6 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 class="font-display text-xl font-semibold text-slate-900 dark:text-white">Share your knowledge &amp; earn</h2>
                    <p class="text-sm text-slate-600 dark:text-slate-400 mt-1">Upgrade your account to publish study notes, PDFs, articles, poems, and video lectures.</p>
                  </div>
                  <a href="#/become-creator" class="px-5 py-2.5 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950 whitespace-nowrap shrink-0">Become a Creator</a>
                </div>`
              : ''
          }

          ${
            store.user.canBootstrapAdmin
              ? `<div class="p-6 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Initial Platform Administrator Setup</h2>
                    <p class="text-xs text-slate-600 dark:text-slate-400 mt-1">No administrator has claimed this workspace yet (or your email is authorized as platform owner). Activate Administrator Dashboard access for your account.</p>
                  </div>
                  <button type="button" id="dash-bootstrap-admin" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950 whitespace-nowrap shrink-0">Enable Admin Dashboard</button>
                </div>`
              : ''
          }

          <div>
            <div class="flex items-baseline justify-between mb-4">
              <h2 class="font-display text-xl font-semibold text-slate-900 dark:text-white">Recent Library Access</h2>
              <a href="#/dashboard/library" class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">Open full library →</a>
            </div>
            ${
              activePurchases.length
                ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    ${activePurchases
                      .slice(0, 4)
                      .map(
                        (p) => `
                      <a href="#/content/${esc(p.slug)}" class="p-4 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 hover:border-slate-400 flex items-center justify-between gap-4">
                        <div class="min-w-0">
                          <div class="text-xs text-slate-500">${esc(p.contentType)} · ${esc(p.creatorName)}</div>
                          <div class="font-display font-semibold text-slate-900 dark:text-white truncate">${esc(p.title)}</div>
                        </div>
                        <span class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 whitespace-nowrap shrink-0">Read →</span>
                      </a>
                    `
                      )
                      .join('')}
                  </div>`
                : `<p class="text-sm text-slate-500">You have not purchased any paid publications yet. <a href="#/explore" class="underline text-[#0F2547] dark:text-sky-400">Browse the catalog</a>.</p>`
            }
          </div>
        </div>
      `;
    } else if (activeTab === 'library') {
      tabBody = `
        <div>
          <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-1">My Purchased Library</h2>
          <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">All unlocked premium notes, PDFs, e-books, and video lectures.</p>
          ${
            activePurchases.length
              ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                  ${activePurchases
                    .map(
                      (p) => `
                    <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-4">
                      <div>
                        <div class="text-xs text-slate-500 dark:text-slate-400 mb-1">${esc(p.categoryName || 'General')} · ${esc(p.contentType)} · Purchased ${formatDate(p.purchasedAt)}</div>
                        <a href="#/content/${esc(p.slug)}" class="font-display text-lg font-semibold text-slate-900 dark:text-white hover:underline">${esc(p.title)}</a>
                        <div class="text-xs text-slate-500 mt-1">By ${esc(p.creatorName)} · Receipt ${esc(p.receiptNumber || '—')}</div>
                      </div>
                      <div class="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                        <span class="font-mono text-sm font-semibold text-slate-700 dark:text-slate-200">${formatInr(p.pricePaidInr)}</span>
                        <div class="flex items-center gap-3">
                          ${p.paymentId ? `<button type="button" data-receipt-id="${p.paymentId}" class="view-receipt-btn text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white">Receipt</button>` : ''}
                          <a href="#/content/${esc(p.slug)}" class="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Open Resource</a>
                        </div>
                      </div>
                    </div>
                  `
                    )
                    .join('')}
                </div>`
              : `<div class="p-10 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 text-center">
                  <p class="text-sm text-slate-500 mb-4">Your purchased library is empty.</p>
                  <a href="#/explore" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] text-white">Explore Catalog</a>
                </div>`
          }
        </div>
      `;
    } else if (activeTab === 'bookmarks') {
      tabBody = `
        <div>
          <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-6">Saved Bookmarks</h2>
          ${
            data.bookmarks.length
              ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-6">${data.bookmarks.map((b) => renderContentCard({ ...b, id: b.contentId })).join('')}</div>`
              : `<div class="p-10 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 text-center text-sm text-slate-500">No bookmarks saved yet.</div>`
          }
        </div>
      `;
    } else if (activeTab === 'following') {
      tabBody = `
        <div>
          <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-6">Creators You Follow</h2>
          ${
            data.following.length
              ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  ${data.following
                    .map(
                      (f) => `
                    <div class="p-5 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
                      <div>
                        <a href="#/creator-profile/${f.creatorId}" class="font-display text-lg font-semibold text-slate-900 dark:text-white hover:underline">${esc(f.displayName || f.name)}</a>
                        <div class="text-xs text-slate-500 dark:text-slate-400">${esc(f.tagline || 'Educator')} · ${f.followerCount || 0} followers</div>
                      </div>
                      <button type="button" data-unfollow="${f.creatorId}" class="unfollow-btn px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">Unfollow</button>
                    </div>
                  `
                    )
                    .join('')}
                </div>`
              : `<div class="p-10 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 text-center text-sm text-slate-500">You are not following any creators yet.</div>`
          }
        </div>
      `;
    } else if (activeTab === 'history') {
      tabBody = `
        <div>
          <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-6">Purchase &amp; Payment History</h2>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto touch-scroll-x">
            <table class="w-full min-w-[600px] text-left text-sm">
              <thead class="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th class="px-4 py-3 font-semibold">Date</th>
                  <th class="px-4 py-3 font-semibold">Receipt</th>
                  <th class="px-4 py-3 font-semibold">Publication</th>
                  <th class="px-4 py-3 font-semibold">Status</th>
                  <th class="px-4 py-3 font-semibold text-right">Amount</th>
                  <th class="px-4 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                ${
                  data.paymentHistory.length
                    ? data.paymentHistory
                        .map(
                          (p) => `
                      <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                        <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${formatDate(p.createdAt)}</td>
                        <td class="px-4 py-3 font-mono text-xs">${esc(p.receiptNumber)}</td>
                        <td class="px-4 py-3 font-medium"><a href="#/content/${esc(p.contentSlug)}" class="hover:underline">${esc(p.contentTitle)}</a></td>
                        <td class="px-4 py-3">${renderStatusLabel(p.status)}</td>
                        <td class="px-4 py-3 text-right font-mono tabular-nums">${formatInr(p.amountInr)}</td>
                        <td class="px-4 py-3 text-right">
                          <button type="button" data-receipt-id="${p.id}" class="view-receipt-btn text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">View Receipt</button>
                        </td>
                      </tr>
                    `
                        )
                        .join('')
                    : `<tr><td colspan="6" class="px-4 py-8 text-center text-slate-500 text-sm">No payment transactions recorded yet.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === 'notifications') {
      tabBody = `
        <div>
          <div class="flex items-center justify-between mb-6">
            <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Notifications</h2>
            <button type="button" id="mark-all-read-btn" class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">Mark all as read</button>
          </div>
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
            ${
              data.notifications.length
                ? data.notifications
                    .map(
                      (n) => `
                  <div class="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${n.isRead ? 'opacity-75' : 'bg-sky-50/40 dark:bg-sky-950/20'}">
                    <div>
                      <div class="text-sm font-semibold text-slate-900 dark:text-white">${esc(n.title)}</div>
                      <p class="text-xs text-slate-600 dark:text-slate-400 mt-0.5">${esc(n.message)}</p>
                      <div class="text-[11px] text-slate-400 mt-1">${formatDate(n.createdAt)}</div>
                    </div>
                    <div class="flex items-center gap-3 shrink-0">
                      ${n.link ? `<a href="${esc(n.link)}" class="text-xs font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">Open</a>` : ''}
                      ${!n.isRead ? `<button type="button" data-notif-id="${n.id}" class="mark-notif-btn text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">Mark read</button>` : ''}
                    </div>
                  </div>
                `
                    )
                    .join('')
                : `<p class="p-8 text-center text-sm text-slate-500">No notifications yet.</p>`
            }
          </div>
        </div>
      `;
    } else if (activeTab === 'settings') {
      const prof = store.user.profile || {};
      tabBody = `
        <div class="max-w-2xl">
          <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-6">Profile &amp; Account Settings</h2>
          <form id="user-profile-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Full Name</label>
                <input name="name" value="${esc(store.user.name)}" required class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Email (read-only)</label>
                <input value="${esc(store.user.email)}" disabled class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 opacity-75" />
              </div>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Bio</label>
              <textarea name="bio" rows="3" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">${esc(store.user.bio || '')}</textarea>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Headline / Role</label>
                <input name="headline" value="${esc(prof.headline || '')}" placeholder="e.g. M.Sc. Physics Student" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Institution / University</label>
                <input name="institution" value="${esc(prof.institution || '')}" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Location</label>
                <input name="location" value="${esc(prof.location || '')}" placeholder="e.g. Bengaluru, India" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Preferred Reading Language</label>
                <select name="languagePreference" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                  ${LANGUAGES.map((l) => `<option value="${esc(l)}" ${prof.languagePreference === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Website / Portfolio URL</label>
              <input name="websiteUrl" value="${esc(prof.websiteUrl || '')}" placeholder="https://" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <button type="submit" class="px-5 py-2.5 text-sm font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Save Profile</button>
          </form>

          <form id="user-password-form" class="mt-6 bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div>
              <h3 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Account Security &amp; Password</h3>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Update your password anytime. Minimum 8 characters recommended.</p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Current Password</label>
                <input name="currentPassword" type="password" placeholder="Required if set" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">New Password</label>
                <input name="newPassword" type="password" minlength="8" required placeholder="Minimum 8 characters" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
            </div>
            <button type="submit" class="px-5 py-2.5 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white">Update Password</button>
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
                  <div class="font-semibold text-sm text-slate-900 dark:text-white truncate">${esc(store.user.name)}</div>
                  <div class="text-xs text-slate-500 capitalize">${esc(store.user.role)} Account</div>
                </div>
                <div class="flex lg:hidden items-center gap-2 shrink-0">
                  ${store.user.role === 'creator' || store.user.role === 'admin' ? `<a href="#/creator" class="text-xs font-semibold text-[#1B3B6F] dark:text-sky-400 whitespace-nowrap">Creator →</a>` : ''}
                  ${store.user.role === 'admin' ? `<a href="#/admin" class="text-xs font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">Admin →</a>` : ''}
                </div>
              </div>
              <nav class="flex lg:flex-col gap-1.5 overflow-x-auto no-scrollbar touch-scroll-x pb-0.5 lg:pb-0">
                ${tabs
                  .map(
                    (t) => `
                  <a href="#/dashboard/${t.id}" class="flex items-center justify-between gap-2 px-3 py-2 min-h-[40px] rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    activeTab === t.id
                      ? 'bg-[#0F2547] text-white dark:bg-sky-500 dark:text-slate-950'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }">
                    <span>${esc(t.label)}</span>
                    ${t.id === 'notifications' && unreadCount > 0 ? `<span class="font-mono text-xs">${unreadCount}</span>` : ''}
                  </a>
                `
                  )
                  .join('')}
              </nav>
              ${
                store.user.role === 'creator' || store.user.role === 'admin'
                  ? `<div class="hidden lg:block pt-3 mt-3 border-t border-slate-100 dark:border-slate-800">
                      <a href="#/creator" class="block px-3 py-2 rounded-lg text-xs font-semibold text-[#1B3B6F] dark:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800">Switch to Creator Studio →</a>
                    </div>`
                  : ''
              }
              ${
                store.user.role === 'admin'
                  ? `<a href="#/admin" class="hidden lg:block px-3 py-2 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800">Open Admin Console →</a>`
                  : ''
              }
            </div>
          </aside>
          <div class="flex-1 min-w-0">${tabBody}</div>
        </div>
      </div>
    `;

    // Wire events
    document.getElementById('dash-resend-verify')?.addEventListener('click', async () => {
      try {
        const res = await apiFetch('/api/auth/resend-verification', { method: 'POST' });
        showToast(res.message, 'success');
        if (res.verificationTokenPreview) {
          window.location.hash = `#/verify-email?token=${encodeURIComponent(res.verificationTokenPreview)}`;
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('dash-bootstrap-admin')?.addEventListener('click', async () => {
      try {
        const res = await apiFetch('/api/auth/bootstrap-admin', { method: 'POST' });
        store.user = res.user;
        notifyStore();
        showToast(res.message, 'success');
        window.location.hash = '#/admin';
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    container.querySelectorAll('.unfollow-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch(`/api/community/follow/${btn.dataset.unfollow}`, { method: 'POST' });
          showToast('Unfollowed creator.', 'success');
          renderUserDashboardPage(container, activeTab);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.view-receipt-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const { receipt } = await apiFetch(`/api/payments/receipt/${btn.dataset.receiptId}`);
          openModal({
            title: `Transaction Receipt · ${receipt.receiptNumber}`,
            bodyHtml: `
              <div class="space-y-4 text-sm">
                <div class="p-4 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 space-y-2">
                  <div class="flex justify-between"><span class="text-slate-500">Receipt No.</span><span class="font-mono font-semibold">${esc(receipt.receiptNumber)}</span></div>
                  <div class="flex justify-between"><span class="text-slate-500">Order ID</span><span class="font-mono text-xs">${esc(receipt.orderId)}</span></div>
                  <div class="flex justify-between"><span class="text-slate-500">Payment ID</span><span class="font-mono text-xs">${esc(receipt.providerPaymentId || '—')}</span></div>
                  <div class="flex justify-between"><span class="text-slate-500">Mode</span><span class="capitalize">${esc(receipt.mode)}</span></div>
                  <div class="flex justify-between"><span class="text-slate-500">Status</span><span>${renderStatusLabel(receipt.status)}</span></div>
                  <div class="flex justify-between"><span class="text-slate-500">Issued On</span><span>${formatDate(receipt.issuedAt)}</span></div>
                  <div class="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between">
                    <span class="text-slate-500">Publication</span>
                    <span class="font-semibold text-right">${esc(receipt.contentTitle)}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-slate-500">Buyer</span>
                    <span>${esc(receipt.buyerName)} (${esc(receipt.buyerEmail)})</span>
                  </div>
                  <div class="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between text-base font-semibold">
                    <span>Amount Paid</span>
                    <span class="font-mono">${formatInr(receipt.amountInr)}</span>
                  </div>
                </div>
                ${receipt.refundReason ? `<p class="text-xs text-red-600">Refund note: ${esc(receipt.refundReason)}</p>` : ''}
                <div class="flex justify-end">
                  <button type="button" onclick="window.print()" class="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700">Print Receipt</button>
                </div>
              </div>
            `,
          });
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    document.getElementById('mark-all-read-btn')?.addEventListener('click', async () => {
      try {
        await apiFetch('/api/community/notifications/read', { method: 'POST', body: {} });
        await refreshCurrentUser();
        renderUserDashboardPage(container, activeTab);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    container.querySelectorAll('.mark-notif-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch('/api/community/notifications/read', {
            method: 'POST',
            body: { id: Number(btn.dataset.notifId) },
          });
          await refreshCurrentUser();
          renderUserDashboardPage(container, activeTab);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    document.getElementById('user-profile-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await apiFetch('/api/auth/profile', {
          method: 'PUT',
          body: Object.fromEntries(fd.entries()),
        });
        store.user = res.user;
        notifyStore();
        showToast(res.message, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('user-password-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await apiFetch('/api/auth/change-password', {
          method: 'POST',
          body: {
            currentPassword: fd.get('currentPassword'),
            newPassword: fd.get('newPassword'),
          },
        });
        showToast(res.message, 'success');
        e.target.reset();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="max-w-3xl mx-auto p-12 text-red-600">${esc(err.message)}</div>`;
  }
}
