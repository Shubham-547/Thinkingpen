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
import {
  formatFirebaseAuthError,
  signInWithFacebook,
  signInWithGoogle,
  signInWithTwitter,
  signOutFirebase,
} from './firebase.js';

function formatRemainingDuration(untilIso) {
  if (!untilIso) return null;
  const diffMs = new Date(untilIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Unlocking momentarily — please try again';
  const totalMins = Math.ceil(diffMs / 60000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 && days === 0) parts.push(`${mins}m`);
  return `${parts.join(' ') || '< 1m'} remaining`;
}

function renderAccountRestrictionBanner(bannerEl, data) {
  if (!bannerEl || !data) return;

  if (data.accountBlocked) {
    const isSuspended = data.status === 'suspended';
    const untilDate = data.blockedUntil
      ? new Date(data.blockedUntil).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : null;
    const remaining = formatRemainingDuration(data.blockedUntil);

    bannerEl.innerHTML = `
      <div class="rounded-xl border border-red-200 dark:border-red-900/80 bg-red-50/90 dark:bg-red-950/35 p-4 space-y-2.5 text-left">
        <div class="flex items-center justify-between gap-2">
          <div class="text-xs font-bold uppercase tracking-wider text-red-800 dark:text-red-300">
            Account ${isSuspended ? 'Suspended' : 'Blocked'} by Administrator
          </div>
          <span class="font-mono text-[11px] font-semibold text-red-700 dark:text-red-400">
            ${untilDate ? esc(remaining || 'Timed') : 'Permanent'}
          </span>
        </div>
        <div class="text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-red-700/80 dark:text-red-400/90 mb-0.5">Reason</div>
          <p class="font-medium">${esc(data.blockedReason || 'Policy violation or administrative restriction.')}</p>
        </div>
        <div class="pt-2 border-t border-red-200/80 dark:border-red-900/60 text-[11px] text-red-900/80 dark:text-red-200/80 space-y-0.5">
          ${
            untilDate
              ? `<div><strong>Scheduled Unlock:</strong> <span class="font-mono">${esc(untilDate)}</span></div>
                 <div>Your account will unlock automatically once this period ends.</div>`
              : `<div><strong>Duration:</strong> Permanent restriction until reviewed by the administration.</div>`
          }
        </div>
      </div>
    `;
    bannerEl.classList.remove('hidden');
    return;
  }

  if (data.accountDeleted) {
    const deletedDate = data.deletedAt
      ? new Date(data.deletedAt).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : null;

    bannerEl.innerHTML = `
      <div class="rounded-xl border border-red-200 dark:border-red-900/80 bg-red-50/90 dark:bg-red-950/35 p-4 space-y-2.5 text-left">
        <div class="text-xs font-bold uppercase tracking-wider text-red-800 dark:text-red-300">
          Account Permanently Deleted
        </div>
        <p class="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
          This account and all of its stored data have been permanently erased from the database by an administrator.
        </p>
        <div class="text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-red-700/80 dark:text-red-400/90 mb-0.5">Deletion Reason</div>
          <p class="font-medium">${esc(data.deletedReason || 'Administrative removal.')}</p>
        </div>
        <div class="pt-2 border-t border-red-200/80 dark:border-red-900/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-red-900/80 dark:text-red-200/80">
          <span>${deletedDate ? `Deleted on <span class="font-mono">${esc(deletedDate)}</span>` : 'Removed from database'}</span>
          <a href="#/signup" class="font-semibold text-[#0F2547] dark:text-sky-400 underline">Create New Account →</a>
        </div>
      </div>
    `;
    bannerEl.classList.remove('hidden');
  }
}

const OCCUPATION_ROLES = [
  'School Student',
  'College Student',
  'Competitive Exam Aspirant',
  'Teacher / Educator',
  'Engineer',
  'Doctor',
  'Artist',
  'Businessman / Entrepreneur',
  'Researcher',
  'Working Professional',
  'Other',
];

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];

function wireUsernameAvailabilityCheck(inputEl, feedbackEl) {
  if (!inputEl || !feedbackEl) return;
  let timer = null;
  const runCheck = async () => {
    const raw = inputEl.value.trim().replace(/^@+/, '');
    if (!raw) {
      feedbackEl.textContent = 'Choose a unique ID (3–30 chars: letters, numbers, . _ -).';
      feedbackEl.className = 'text-[11px] text-slate-500 mt-1';
      return;
    }
    feedbackEl.textContent = 'Checking availability...';
    feedbackEl.className = 'text-[11px] text-slate-500 mt-1';
    try {
      const res = await apiFetch(`/api/auth/check-username?username=${encodeURIComponent(raw)}`);
      if (res.valid && res.available) {
        feedbackEl.textContent = `✓ ${res.message}`;
        feedbackEl.className = 'text-[11px] font-medium text-emerald-700 dark:text-emerald-400 mt-1';
      } else {
        feedbackEl.textContent = `✕ ${res.message || 'Not available'}`;
        feedbackEl.className = 'text-[11px] font-medium text-red-600 dark:text-red-400 mt-1';
      }
    } catch {
      feedbackEl.textContent = '';
    }
  };
  inputEl.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(runCheck, 350);
  });
}

function renderScholarPressBookNibLogo(sizeCls = 'w-14 h-12', gid = 'Desk') {
  return `
    <svg class="${sizeCls} shrink-0" viewBox="0 0 84 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="spNibBookL${gid}" x1="8" y1="30" x2="40" y2="62" gradientUnits="userSpaceOnUse">
          <stop stop-color="#60A5FA"/>
          <stop offset="1" stop-color="#1D4ED8"/>
        </linearGradient>
        <linearGradient id="spNibBookR${gid}" x1="44" y1="30" x2="76" y2="62" gradientUnits="userSpaceOnUse">
          <stop stop-color="#3B82F6"/>
          <stop offset="1" stop-color="#1E40AF"/>
        </linearGradient>
      </defs>
      <!-- Fountain pen nib rising from open book -->
      <path d="M42 6L33 26L42 40L51 26L42 6Z" fill="#FFFFFF"/>
      <path d="M42 6V24" stroke="#0B2252" stroke-width="2" stroke-linecap="round"/>
      <circle cx="42" cy="25.5" r="2.6" fill="#0B2252"/>
      <!-- Open hardcover book pages -->
      <path d="M8 29C20 26 32 30 42 41V61C31 53 19 50 8 53V29Z" fill="url(#spNibBookL${gid})" stroke="#FFFFFF" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M76 29C64 26 52 30 42 41V61C53 53 65 50 76 53V29Z" fill="url(#spNibBookR${gid})" stroke="#FFFFFF" stroke-width="2.2" stroke-linejoin="round"/>
      <!-- Crisp page lines -->
      <path d="M14 36C22 34.5 30 37 37 44" stroke="#E0F2FE" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M14 43C22 41.5 30 44 37 50.5" stroke="#BAE6FD" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M70 36C62 34.5 54 37 47 44" stroke="#E0F2FE" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M70 43C62 41.5 54 44 47 50.5" stroke="#BAE6FD" stroke-width="1.6" stroke-linecap="round"/>
      <!-- Base curved book spine shadow -->
      <path d="M6 56C20 52 33 55 42 63C51 55 64 52 78 56" stroke="#FFFFFF" stroke-opacity="0.9" stroke-width="2.2" stroke-linecap="round"/>
    </svg>
  `;
}

function renderDesktopBooksPenCupSvg() {
  return `
    <svg class="w-[186px] xl:w-[205px] h-auto select-none pointer-events-none drop-shadow-[0_14px_24px_rgba(3,12,34,0.45)]" viewBox="0 0 220 190" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="spCupBody" x1="65" y1="74" x2="150" y2="140" gradientUnits="userSpaceOnUse">
          <stop stop-color="#FFFFFF"/>
          <stop offset="0.65" stop-color="#E6EEF9"/>
          <stop offset="1" stop-color="#C6D6EE"/>
        </linearGradient>
        <linearGradient id="spBookTop" x1="20" y1="132" x2="195" y2="154" gradientUnits="userSpaceOnUse">
          <stop stop-color="#2563EB"/>
          <stop offset="1" stop-color="#1E3A8A"/>
        </linearGradient>
        <linearGradient id="spBookBot" x1="12" y1="154" x2="205" y2="180" gradientUnits="userSpaceOnUse">
          <stop stop-color="#1D4ED8"/>
          <stop offset="1" stop-color="#0F2557"/>
        </linearGradient>
      </defs>
      <!-- Pencils & fountain pen inside cup -->
      <g transform="rotate(-15 86 74)">
        <rect x="78" y="24" width="9" height="58" rx="3" fill="#2563EB"/>
        <polygon points="78,24 82.5,11 87,24" fill="#FDE68A"/>
        <polygon points="81,15 82.5,11 84,15" fill="#1E3A8A"/>
      </g>
      <g transform="rotate(-4 102 72)">
        <rect x="97" y="18" width="10" height="62" rx="3" fill="#60A5FA"/>
        <rect x="97" y="18" width="10" height="8" rx="2" fill="#E0F2FE"/>
      </g>
      <g transform="rotate(9 120 72)">
        <rect x="115" y="15" width="11" height="66" rx="4" fill="#1E3A8A"/>
        <rect x="115" y="34" width="11" height="3.5" fill="#F59E0B"/>
        <polygon points="116,15 120.5,4 125,15" fill="#FBBF24"/>
      </g>
      <g transform="rotate(20 135 76)">
        <rect x="131" y="24" width="9" height="56" rx="3" fill="#3B82F6"/>
        <polygon points="131,24 135.5,13 140,24" fill="#FEF3C7"/>
        <polygon points="134,17 135.5,13 137,17" fill="#1D4ED8"/>
      </g>
      <!-- Ceramic white pen cup -->
      <ellipse cx="110" cy="76" rx="40" ry="8" fill="#1E3A8A"/>
      <path d="M70 76H150L145 137C144.5 142 129 146 110 146C91 146 75.5 142 75 137L70 76Z" fill="url(#spCupBody)"/>
      <ellipse cx="110" cy="76" rx="40" ry="7" stroke="#FFFFFF" stroke-width="2" fill="#DBEAFE" fill-opacity="0.35"/>
      <!-- Mini ScholarPress emblem on cup -->
      <path d="M110 92L106 102L110 109L114 102L110 92Z" fill="#0F2557"/>
      <path d="M92 104C99 102 105 104 110 110V122C104 117 98 116 92 118V104Z" fill="#1D4ED8"/>
      <path d="M128 104C121 102 115 104 110 110V122C116 117 122 116 128 118V104Z" fill="#2563EB"/>
      <path d="M96 108C101 107 105 108 108 112M124 108C119 107 115 108 112 112" stroke="#FFFFFF" stroke-width="1.3" stroke-linecap="round"/>
      <!-- Top stacked hardcover book -->
      <path d="M24 137L120 128L198 140L106 154L24 137Z" fill="url(#spBookTop)"/>
      <path d="M24 137L106 154V166L24 148V137Z" fill="#1E40AF"/>
      <path d="M106 154L196 141V151L106 165V154Z" fill="#F8FAFC"/>
      <path d="M108 158L193 145.5M108 161.5L193 149" stroke="#CBD5E1" stroke-width="1.1"/>
      <!-- Bottom stacked hardcover book -->
      <path d="M14 156L112 149L206 162L104 177L14 156Z" fill="url(#spBookBot)"/>
      <path d="M14 156L104 177V187L14 166V156Z" fill="#0D2454"/>
      <path d="M104 177L204 163V173L104 187V177Z" fill="#F1F5F9"/>
      <path d="M106 181L201 167.5M106 184L201 170.5" stroke="#CBD5E1" stroke-width="1.1"/>
    </svg>
  `;
}

function renderMobileBooksCapPenSvg() {
  return `
    <svg class="w-[152px] sm:w-[196px] h-auto shrink-0 select-none pointer-events-none drop-shadow-[0_10px_18px_rgba(15,43,102,0.16)]" viewBox="0 0 220 175" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="spMobCapTop" x1="56" y1="16" x2="184" y2="62" gradientUnits="userSpaceOnUse">
          <stop stop-color="#1E4DB7"/>
          <stop offset="1" stop-color="#0A235A"/>
        </linearGradient>
        <linearGradient id="spMobBook1" x1="34" y1="74" x2="188" y2="106" gradientUnits="userSpaceOnUse">
          <stop stop-color="#2563EB"/>
          <stop offset="1" stop-color="#0E2D6E"/>
        </linearGradient>
        <linearGradient id="spMobBook2" x1="20" y1="106" x2="196" y2="148" gradientUnits="userSpaceOnUse">
          <stop stop-color="#1D4ED8"/>
          <stop offset="1" stop-color="#0A2254"/>
        </linearGradient>
        <linearGradient id="spMobPen" x1="148" y1="18" x2="196" y2="148" gradientUnits="userSpaceOnUse">
          <stop stop-color="#1E40AF"/>
          <stop offset="0.5" stop-color="#091D48"/>
          <stop offset="1" stop-color="#2563EB"/>
        </linearGradient>
      </defs>
      <!-- Soft translucent blue botanical leaves behind stack -->
      <path d="M40 132C24 114 14 96 14 78C28 84 42 98 48 122Z" fill="#93C5FD" fill-opacity="0.45"/>
      <path d="M36 138C18 130 6 118 4 104C20 106 34 116 44 130Z" fill="#60A5FA" fill-opacity="0.35"/>
      <path d="M182 128C198 112 210 92 212 74C196 82 184 96 176 118Z" fill="#93C5FD" fill-opacity="0.42"/>
      <!-- Soft surface shadow -->
      <ellipse cx="108" cy="154" rx="86" ry="12" fill="#1E3A8A" fill-opacity="0.16"/>
      <!-- Bottom book -->
      <path d="M24 114L122 100L192 115L94 131L24 114Z" fill="url(#spMobBook2)"/>
      <path d="M24 114L94 131V153L24 135V114Z" fill="#F8FAFC"/>
      <path d="M28 121L90 136M28 127L90 142M28 132L90 147" stroke="#CBD5E1" stroke-width="1.3"/>
      <path d="M24 114L94 131M24 135L94 153" stroke="#1E3A8A" stroke-width="3" stroke-linecap="round"/>
      <path d="M94 131L192 115V137L94 153V131Z" fill="#123886"/>
      <path d="M98 138L188 123" stroke="#60A5FA" stroke-opacity="0.45" stroke-width="2" stroke-linecap="round"/>
      <!-- Top book -->
      <path d="M38 86L132 74L188 87L96 101L38 86Z" fill="url(#spMobBook1)"/>
      <path d="M38 86L96 101V120L38 104V86Z" fill="#FFFFFF"/>
      <path d="M42 92L92 105M42 98L92 111" stroke="#CBD5E1" stroke-width="1.2"/>
      <path d="M38 86L96 101M38 104L96 120" stroke="#1D4ED8" stroke-width="2.8" stroke-linecap="round"/>
      <path d="M96 101L188 87V106L96 120V101Z" fill="#1A449E"/>
      <!-- Graduation Cap sitting on top book -->
      <path d="M80 54V74C80 81 97 86 116 86C135 86 152 81 152 74V54L116 66L80 54Z" fill="#153B8A"/>
      <path d="M116 20L52 44L116 66L180 44L116 20Z" fill="url(#spMobCapTop)"/>
      <path d="M116 22L174 44L116 63" stroke="#93C5FD" stroke-opacity="0.35" stroke-width="1.5"/>
      <!-- Gold tassel -->
      <circle cx="116" cy="43" r="3.5" fill="#FBBF24"/>
      <path d="M116 43C134 45 148 53 151 64V83" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M146 83H156L158 97C154 99 148 99 144 97L146 83Z" fill="#FBBF24"/>
      <path d="M148 86V96M151 86V97M154 86V96" stroke="#B45309" stroke-width="1"/>
      <!-- Classic Navy & Gold Fountain Pen leaning on right -->
      <g transform="rotate(14 176 86)">
        <rect x="169" y="22" width="15" height="96" rx="7.5" fill="url(#spMobPen)"/>
        <rect x="169" y="68" width="15" height="4.5" fill="#F59E0B"/>
        <rect x="174.5" y="28" width="4" height="32" rx="2" fill="#FBBF24"/>
        <path d="M170 116H183L179.5 130H173.5L170 116Z" fill="#0B2252"/>
        <path d="M172.5 130H180.5L176.5 151L172.5 130Z" fill="#FBBF24"/>
        <path d="M176.5 138V151" stroke="#78350F" stroke-width="1.2"/>
        <circle cx="176.5" cy="138" r="1.4" fill="#78350F"/>
      </g>
    </svg>
  `;
}

function consumePostLoginRedirect(fallbackHash) {
  try {
    const target = sessionStorage.getItem('sp_post_login_redirect');
    if (target) {
      sessionStorage.removeItem('sp_post_login_redirect');
      if (target.startsWith('#/')) return target;
    }
  } catch {}
  return fallbackHash;
}

const SOCIAL_PROVIDER_ICONS = {
  google: `<svg class="w-[18px] h-[18px] shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/>
    <path fill="#34A853" d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"/>
    <path fill="#FBBC05" d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"/>
    <path fill="#EA4335" d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/>
  </svg>`,
  facebook: `<svg class="w-[18px] h-[18px] shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.514c-1.491 0-1.956.93-1.956 1.886v2.268h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
  </svg>`,
  twitter: `<svg class="w-[18px] h-[18px] shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#1DA1F2" d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
  </svg>`,
};

async function handleFirebaseSocialAuth({
  providerFn,
  providerLabel,
  buttonEl,
  allButtons = [],
  restrictionBanner = null,
  showStatus = null,
}) {
  if (!buttonEl || buttonEl.disabled) return;
  const originalHtml = buttonEl.innerHTML;
  const group = allButtons.filter(Boolean);
  group.forEach((btn) => {
    btn.disabled = true;
  });
  buttonEl.innerHTML = `<span class="inline-block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" aria-hidden="true"></span><span>Connecting to ${esc(providerLabel)}...</span>`;
  restrictionBanner?.classList.add('hidden');

  try {
    const { idToken } = await providerFn();
    setSessionToken(null); // Use verified Firebase ID token
    const res = await apiFetch('/api/auth/firebase-sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    store.user = res.user;
    notifyStore();
    showToast(`Signed in as ${res.user.name}.`, 'success');
    const needsProfileSetup = !res.user.username || !res.user.profile?.profileCompleted;
    if (needsProfileSetup && !res.user.isSuperAdmin) {
      window.location.hash = '#/complete-profile';
      return;
    }
    const defaultDest = res.user.role === 'admin' ? '#/admin' : '#/dashboard';
    window.location.hash = consumePostLoginRedirect(defaultDest);
  } catch (err) {
    if (err?.data?.accountBlocked || err?.data?.accountDeleted) {
      await signOutFirebase();
      renderAccountRestrictionBanner(restrictionBanner, err.data);
      showToast(err.message || `${providerLabel} sign-in blocked.`, 'error');
    } else {
      const friendlyMsg = formatFirebaseAuthError(err, providerLabel);
      showStatus?.('error', friendlyMsg);
      showToast(friendlyMsg, 'error');
    }
  } finally {
    buttonEl.innerHTML = originalHtml;
    group.forEach((btn) => {
      btn.disabled = false;
    });
  }
}

const OFFICIAL_SCHOLARPRESS_LOGO =
  '/assets/aistudio/file_00000000c1548211a47526d83420f44b_784076a2.png';
const SIGNUP_DRAFT_STORAGE_KEY = 'sp_signup_draft';
const PENDING_OTP_STORAGE_KEY = 'sp_otp_pending';
let activeOtpCountdownTimer = null;

export function cleanupOtpVerificationTimer() {
  if (activeOtpCountdownTimer !== null) {
    window.clearInterval(activeOtpCountdownTimer);
    activeOtpCountdownTimer = null;
  }
}

function saveSignupDraft(name, email) {
  try {
    // Store ONLY non-sensitive signup fields for Back navigation — NEVER store passwords.
    sessionStorage.setItem(
      SIGNUP_DRAFT_STORAGE_KEY,
      JSON.stringify({ name: String(name || ''), email: String(email || '') })
    );
  } catch {}
}

function loadSignupDraft() {
  try {
    const raw = sessionStorage.getItem(SIGNUP_DRAFT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSignupDraft() {
  try {
    sessionStorage.removeItem(SIGNUP_DRAFT_STORAGE_KEY);
  } catch {}
}

function savePendingOtpState(data) {
  try {
    sessionStorage.setItem(
      PENDING_OTP_STORAGE_KEY,
      JSON.stringify({
        pendingToken: data.pendingToken,
        maskedEmail: data.maskedEmail,
        email: data.email || '',
        name: data.name || '',
        expiresAt: data.expiresAt,
        serverTime: data.serverTime,
      })
    );
  } catch {}
}

function loadPendingOtpState() {
  try {
    const raw = sessionStorage.getItem(PENDING_OTP_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearPendingOtpState() {
  try {
    sessionStorage.removeItem(PENDING_OTP_STORAGE_KEY);
  } catch {}
}

function renderSignupPage(container) {
  const highlights = [
    {
      title: 'Publish & Share Content',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"/>',
    },
    {
      title: 'Learn from Experts',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5"/>',
    },
    {
      title: 'Be a Part of Our Community',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/>',
    },
  ];

  const eyeOpenSvg =
    '<svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
  const eyeClosedSvg =
    '<svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/></svg>';

  container.innerHTML = `
    <section class="relative min-h-[calc(100vh-4.5rem)] w-full overflow-hidden bg-gradient-to-br from-[#EAF2FF] via-[#F2F7FF] to-[#E6F0FF] text-[#0A1E44] flex flex-col justify-between lg:justify-center lg:py-10 lg:px-6">
      <!-- Subtle soft blue sweeping background accents (desktop & tablet) -->
      <div class="pointer-events-none hidden lg:block absolute -top-24 -left-24 w-[420px] h-[420px] rounded-full bg-[#CFE0FF]/45 blur-3xl"></div>
      <div class="pointer-events-none hidden lg:block absolute -bottom-28 -right-20 w-[460px] h-[460px] rounded-full bg-[#C7DCFF]/50 blur-3xl"></div>

      <!-- Mobile & Tablet Dedicated Light-Blue Academic Hero Banner (< lg, inspired by mobile reference) -->
      <div class="lg:hidden relative w-full bg-gradient-to-br from-[#EAF3FF] via-[#DAE9FF] to-[#C6DEFF] pt-6 pb-10 px-4 sm:px-8 overflow-hidden">
        <div class="pointer-events-none absolute -top-12 right-0 w-56 h-56 rounded-full bg-white/45 blur-2xl"></div>
        <div class="max-w-[560px] mx-auto relative z-10 flex items-center justify-between gap-2 sm:gap-5">
          <div class="min-w-0 flex-1 pr-1">
            <h1 class="text-[26px] sm:text-[32px] font-extrabold tracking-tight leading-[1.14] text-[#0A1E44]">
              Join <span class="text-[#1646A8]">ScholarPress</span>
            </h1>
            <p class="text-[13.5px] sm:text-[15px] text-[#1E355E] leading-[1.45] mt-2.5">
              <strong class="font-bold text-[#0A1E44]">Create your</strong> account and be a part of our growing knowledge community.
            </p>
            <svg class="w-32 sm:w-40 h-3 mt-1.5" viewBox="0 0 160 12" fill="none" aria-hidden="true">
              <path d="M2 9C48 3 108 2 156 6" stroke="#1646A8" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="shrink-0 -mr-2 sm:mr-0">
            ${renderMobileBooksCapPenSvg()}
          </div>
        </div>
        <!-- Soft curved bottom wave on mobile banner -->
        <svg class="pointer-events-none absolute bottom-0 left-0 w-full h-7 text-[#F2F7FF]" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,24 C360,64 1080,0 1440,34 L1440,60 L0,60 Z" fill="currentColor"/>
        </svg>
      </div>

      <!-- Main Responsive Container: Desktop 2-Column Split Card / Mobile Elevated White Card -->
      <div class="relative z-10 w-full max-w-[540px] lg:max-w-[1040px] mx-auto px-3.5 sm:px-6 lg:px-0 -mt-5 lg:mt-0 pb-8 lg:pb-0">
        <div class="grid grid-cols-1 lg:grid-cols-12 items-stretch bg-white rounded-[24px] border border-[#DCE6F7] shadow-[0_22px_56px_-22px_rgba(10,30,68,0.24)] overflow-hidden">

          <!-- DESKTOP LEFT COLUMN: Deep Navy Academic Panel with Library Depth + Books & Pen Cup -->
          <aside class="hidden lg:flex lg:col-span-6 flex-col justify-between bg-[#06183D] text-white p-9 xl:p-11 relative overflow-hidden">
            <!-- Subtle blurred academic library backdrop blended into deep navy -->
            <img
              src="/src/assets/images/hero_scholar_library_1794993004508-960w.webp"
              alt=""
              aria-hidden="true"
              referrerpolicy="no-referrer"
              class="pointer-events-none absolute inset-0 w-full h-full object-cover object-right opacity-30 mix-blend-luminosity scale-105 blur-[1.5px]"
              onerror="this.style.display='none'"
            />
            <!-- Rich multi-stop navy scrim preserving 100% crisp text legibility on the left -->
            <div class="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#051538] via-[#071D4B]/92 to-[#0E3173]/68"></div>
            <!-- Translucent curved blue sweep at top-right (matching desktop reference) -->
            <div class="pointer-events-none absolute -top-20 right-[-80px] w-[320px] h-[260px] rounded-full bg-gradient-to-bl from-[#3B82F6]/45 via-[#1D4ED8]/25 to-transparent blur-xl"></div>
            <svg class="pointer-events-none absolute top-0 right-0 w-[300px] h-[220px] opacity-25" viewBox="0 0 300 220" fill="none" aria-hidden="true">
              <path d="M120 0H300V180C220 155 155 95 120 0Z" fill="url(#spTopSweep)"/>
              <defs>
                <linearGradient id="spTopSweep" x1="120" y1="0" x2="300" y2="180" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#60A5FA"/>
                  <stop offset="1" stop-color="#1D4ED8" stop-opacity="0"/>
                </linearGradient>
              </defs>
            </svg>

            <!-- Top Branding + Welcome Copy + Highlights -->
            <div class="relative z-10">
              <a href="#/" class="inline-flex items-center gap-3.5 group focus-visible:outline-2 focus-visible:outline-sky-300 rounded-xl">
                ${renderScholarPressBookNibLogo('w-[62px] h-[54px]', 'Desk')}
                <div class="leading-none">
                  <span class="block text-[30px] xl:text-[32px] font-bold tracking-tight text-white">
                    ScholarPress
                  </span>
                  <span class="flex items-center gap-2 text-[12px] font-medium text-blue-200/90 mt-1.5 tracking-wide">
                    <span class="w-4 h-px bg-blue-300/60"></span>
                    <span>Learn · Create · Share</span>
                    <span class="w-4 h-px bg-blue-300/60"></span>
                  </span>
                </div>
              </a>

              <div class="mt-8">
                <h1 class="text-[32px] xl:text-[36px] font-extrabold tracking-tight text-white leading-[1.15]">
                  Join Our <span class="text-[#5CA4FF]">Knowledge</span><br />Community!
                </h1>
                <p class="text-[14.5px] text-blue-100/90 leading-relaxed mt-3.5 max-w-[36ch]">
                  Create your account and unlock a world of educational content, expert insights and endless learning opportunities.
                </p>
              </div>

              <ul class="mt-7 space-y-3.5">
                ${highlights
                  .map(
                    (item) => `
                  <li class="flex items-center gap-3.5">
                    <span class="w-9 h-9 rounded-full bg-[#194391]/85 border border-blue-300/25 text-white flex items-center justify-center shrink-0 shadow-sm">
                      <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg>
                    </span>
                    <span class="text-[14.5px] font-medium text-white/95 leading-snug">${item.title}</span>
                  </li>
                `
                  )
                  .join('')}
              </ul>
            </div>

            <!-- Bottom Row: Script Motto (Left) + Stacked Books & Pen Cup Artwork (Right) -->
            <div class="relative z-10 mt-8 flex items-end justify-between gap-4">
              <div class="pb-1">
                <div class="font-script text-[26px] xl:text-[28px] font-bold text-white/95 leading-none tracking-wide">
                  Learn &middot; Share &middot; Grow
                </div>
                <svg class="w-40 h-4 mt-1" viewBox="0 0 180 16" fill="none" aria-hidden="true">
                  <path d="M4 12C54 4 118 2 174 7" stroke="url(#spScriptLine)" stroke-width="2.6" stroke-linecap="round"/>
                  <defs>
                    <linearGradient id="spScriptLine" x1="4" y1="12" x2="174" y2="7" gradientUnits="userSpaceOnUse">
                      <stop stop-color="#8B5CF6"/>
                      <stop offset="0.55" stop-color="#38BDF8"/>
                      <stop offset="1" stop-color="#60A5FA" stop-opacity="0.25"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              <div class="-mr-5 -mb-7 xl:-mr-6 xl:-mb-8 shrink-0">
                ${renderDesktopBooksPenCupSvg()}
              </div>
            </div>
          </aside>

          <!-- RIGHT COLUMN (Desktop) / MAIN WHITE CARD (Mobile) -->
          <div class="lg:col-span-6 bg-white p-5 sm:p-8 lg:px-11 lg:py-10 flex flex-col justify-center">
            <div class="w-full max-w-[420px] mx-auto">

              <!-- Mobile Card Header (Circular User-Plus Badge + Title, matching mobile reference) -->
              <div class="flex lg:hidden items-center gap-3.5 mb-5">
                <div class="w-14 h-14 rounded-full bg-[#E1ECFF] text-[#0B2A63] flex items-center justify-center shrink-0">
                  <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z"/>
                  </svg>
                </div>
                <div class="min-w-0">
                  <h2 class="text-[22px] sm:text-[24px] font-extrabold tracking-tight text-[#0A1E44] leading-tight">
                    Create Account
                  </h2>
                  <p class="text-[13.5px] text-[#3B5278] mt-0.5">
                    Start your journey with ScholarPress
                  </p>
                </div>
              </div>

              <!-- Desktop Centered Form Header (matching desktop reference) -->
              <div class="hidden lg:block text-center mb-7">
                <h2 class="text-[30px] xl:text-[32px] font-extrabold tracking-tight text-[#0A1E44] leading-tight">
                  Create Your Account
                </h2>
                <p class="text-[14.5px] text-[#3B5278] mt-1.5">
                  Start your journey with ScholarPress
                </p>
              </div>

              <!-- Account Restriction & Inline Status Feedback Banners -->
              <div id="sp-signup-restriction-banner" class="hidden mb-4"></div>
              <div id="sp-signup-status" class="hidden mb-4 rounded-xl px-4 py-3 text-[13px] leading-relaxed border" role="status" aria-live="polite"></div>

              <form id="sp-signup-ui-form" class="space-y-3.5 sm:space-y-4" novalidate>
                <!-- 1. Full Name -->
                <div>
                  <label for="sp-signup-fullname" class="sr-only">Full Name</label>
                  <div class="relative">
                    <span class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#3B5278]">
                      <svg class="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill-rule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clip-rule="evenodd"/>
                      </svg>
                    </span>
                    <input
                      id="sp-signup-fullname"
                      name="fullName"
                      type="text"
                      autocomplete="name"
                      required
                      placeholder="Full Name"
                      class="w-full h-12 pl-11 pr-4 rounded-xl border border-[#C6D4E8] bg-white text-[#0A1E44] placeholder:text-[#5B7091] text-[15px] sm:text-[14.5px] transition-colors focus:border-[#1D4ED8] focus:ring-4 focus:ring-[#1D4ED8]/12 outline-none"
                    />
                  </div>
                  <p id="sp-err-fullname" class="hidden mt-1 text-[12px] font-medium text-[#B91C1C]"></p>
                </div>

                <!-- 2. Email Address -->
                <div>
                  <label for="sp-signup-email" class="sr-only">Email Address</label>
                  <div class="relative">
                    <span class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#3B5278]">
                      <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm0 0c0 1.657 1.007 3 2.25 3S21 13.657 21 12a9 9 0 10-2.636 6.364M16.5 12V8.25"/>
                      </svg>
                    </span>
                    <input
                      id="sp-signup-email"
                      name="email"
                      type="email"
                      autocomplete="email"
                      required
                      placeholder="Email Address"
                      class="w-full h-12 pl-11 pr-4 rounded-xl border border-[#C6D4E8] bg-white text-[#0A1E44] placeholder:text-[#5B7091] text-[15px] sm:text-[14.5px] transition-colors focus:border-[#1D4ED8] focus:ring-4 focus:ring-[#1D4ED8]/12 outline-none"
                    />
                  </div>
                  <p id="sp-err-email" class="hidden mt-1 text-[12px] font-medium text-[#B91C1C]"></p>
                </div>

                <!-- 3. Password -->
                <div>
                  <label for="sp-signup-password" class="sr-only">Password</label>
                  <div class="relative">
                    <span class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#3B5278]">
                      <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
                      </svg>
                    </span>
                    <input
                      id="sp-signup-password"
                      name="password"
                      type="password"
                      autocomplete="new-password"
                      minlength="8"
                      required
                      placeholder="Password"
                      class="w-full h-12 pl-11 pr-12 rounded-xl border border-[#C6D4E8] bg-white text-[#0A1E44] placeholder:text-[#5B7091] text-[15px] sm:text-[14.5px] transition-colors focus:border-[#1D4ED8] focus:ring-4 focus:ring-[#1D4ED8]/12 outline-none"
                    />
                    <button
                      type="button"
                      id="sp-toggle-password"
                      aria-label="Show password"
                      class="absolute inset-y-0 right-1 w-11 flex items-center justify-center rounded-lg text-[#5B7091] hover:text-[#0A1E44] transition-colors"
                    >
                      ${eyeClosedSvg}
                    </button>
                  </div>
                  <div id="sp-password-strength" class="hidden mt-1.5 flex items-center gap-2.5">
                    <div class="flex-1 h-1.5 rounded-full bg-[#E6EEF9] overflow-hidden">
                      <div id="sp-password-strength-bar" class="h-full w-0 rounded-full transition-all duration-200"></div>
                    </div>
                    <span id="sp-password-strength-label" class="text-[11px] font-medium text-[#3B5278] shrink-0"></span>
                  </div>
                  <p id="sp-err-password" class="hidden mt-1 text-[12px] font-medium text-[#B91C1C]"></p>
                </div>

                <!-- 4. Confirm Password -->
                <div>
                  <label for="sp-signup-confirm" class="sr-only">Confirm Password</label>
                  <div class="relative">
                    <span class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#3B5278]">
                      <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
                      </svg>
                    </span>
                    <input
                      id="sp-signup-confirm"
                      name="confirmPassword"
                      type="password"
                      autocomplete="new-password"
                      minlength="8"
                      required
                      placeholder="Confirm Password"
                      class="w-full h-12 pl-11 pr-12 rounded-xl border border-[#C6D4E8] bg-white text-[#0A1E44] placeholder:text-[#5B7091] text-[15px] sm:text-[14.5px] transition-colors focus:border-[#1D4ED8] focus:ring-4 focus:ring-[#1D4ED8]/12 outline-none"
                    />
                    <button
                      type="button"
                      id="sp-toggle-confirm"
                      aria-label="Show confirm password"
                      class="absolute inset-y-0 right-1 w-11 flex items-center justify-center rounded-lg text-[#5B7091] hover:text-[#0A1E44] transition-colors"
                    >
                      ${eyeClosedSvg}
                    </button>
                  </div>
                  <p id="sp-err-confirm" class="hidden mt-1 text-[12px] font-medium text-[#B91C1C]"></p>
                </div>

                <!-- Terms & Conditions + Privacy Policy -->
                <div class="pt-0.5">
                  <label for="sp-signup-terms" class="flex items-center gap-2.5 min-h-[42px] cursor-pointer select-none">
                    <input
                      id="sp-signup-terms"
                      name="terms"
                      type="checkbox"
                      required
                      class="w-[18px] h-[18px] rounded border-[#9FB5D6] text-[#1D4ED8] accent-[#1646A8] shrink-0 cursor-pointer"
                    />
                    <span class="text-[13px] text-[#283E61] leading-snug">
                      I agree to the
                      <a href="#/terms" class="font-semibold text-[#1D4ED8] hover:text-[#1E40AF] hover:underline underline-offset-2">Terms &amp; Conditions</a>
                      and
                      <a href="#/privacy" class="font-semibold text-[#1D4ED8] hover:text-[#1E40AF] hover:underline underline-offset-2">Privacy Policy</a>
                    </span>
                  </label>
                  <p id="sp-err-terms" class="hidden mt-0.5 text-[12px] font-medium text-[#B91C1C]"></p>
                </div>

                <!-- Primary Sign Up Button (Pill on Mobile, Rounded-XL on Desktop) -->
                <button
                  type="submit"
                  id="sp-signup-submit-btn"
                  class="w-full h-12 px-5 rounded-full lg:rounded-xl bg-gradient-to-r from-[#082661] via-[#0E3580] to-[#134296] hover:from-[#0A2E73] hover:to-[#184DB0] active:scale-[0.99] disabled:opacity-65 disabled:cursor-not-allowed text-white text-[15px] font-semibold flex items-center justify-center gap-2.5 shadow-[0_10px_22px_-8px_rgba(8,38,97,0.5)] transition-all duration-150 whitespace-nowrap"
                >
                  <svg class="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6.25 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM3.25 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM19.75 7.5a.75.75 0 00-1.5 0v2.25H16a.75.75 0 000 1.5h2.25v2.25a.75.75 0 001.5 0v-2.25H22a.75.75 0 000-1.5h-2.25V7.5z"/>
                  </svg>
                  <span>Sign Up</span>
                  <svg class="w-4 h-4 lg:hidden shrink-0" fill="none" stroke="currentColor" stroke-width="2.3" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/>
                  </svg>
                </button>
              </form>

              <!-- Subtle Divider -->
              <div class="relative my-4.5">
                <div class="absolute inset-0 flex items-center" aria-hidden="true">
                  <div class="w-full border-t border-[#DCE6F5]"></div>
                </div>
                <div class="relative flex justify-center">
                  <span class="px-3.5 bg-white text-[12.5px] font-medium text-[#4B607F]">or continue with</span>
                </div>
              </div>

              <!-- Social Sign-In Buttons (Firebase Authentication) -->
              <div class="space-y-2.5">
                <button
                  type="button"
                  id="sp-signup-google-btn"
                  class="w-full h-11 px-4 rounded-full lg:rounded-xl border border-[#B8CAE4] bg-white hover:bg-[#F5F9FF] hover:border-[#8FAED8] disabled:opacity-60 disabled:cursor-not-allowed text-[#0A1E44] text-[14px] font-semibold flex items-center justify-center gap-2.5 transition-colors duration-150 whitespace-nowrap"
                >
                  ${SOCIAL_PROVIDER_ICONS.google}
                  <span>Continue with Google</span>
                </button>
                <button
                  type="button"
                  id="sp-signup-facebook-btn"
                  class="w-full h-11 px-4 rounded-full lg:rounded-xl border border-[#B8CAE4] bg-white hover:bg-[#F5F9FF] hover:border-[#8FAED8] disabled:opacity-60 disabled:cursor-not-allowed text-[#0A1E44] text-[14px] font-semibold flex items-center justify-center gap-2.5 transition-colors duration-150 whitespace-nowrap"
                >
                  ${SOCIAL_PROVIDER_ICONS.facebook}
                  <span>Continue with Facebook</span>
                </button>
                <button
                  type="button"
                  id="sp-signup-twitter-btn"
                  class="w-full h-11 px-4 rounded-full lg:rounded-xl border border-[#B8CAE4] bg-white hover:bg-[#F5F9FF] hover:border-[#8FAED8] disabled:opacity-60 disabled:cursor-not-allowed text-[#0A1E44] text-[14px] font-semibold flex items-center justify-center gap-2.5 transition-colors duration-150 whitespace-nowrap"
                >
                  ${SOCIAL_PROVIDER_ICONS.twitter}
                  <span>Continue with Twitter</span>
                </button>
              </div>

              <!-- Sign In Link -->
              <p class="mt-5 text-center text-[13.5px] text-[#283E61]">
                Already have an account?
                <a href="#/login" class="inline-flex items-center gap-0.5 font-bold text-[#1646A8] hover:text-[#0E317A] hover:underline underline-offset-2 ml-1">
                  <span>Sign In</span>
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/>
                  </svg>
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Subtle Royal-Blue Curved Footer Accent on Mobile (< lg, matching mobile reference) -->
      <div class="lg:hidden pointer-events-none w-full overflow-hidden leading-none mt-auto">
        <svg class="w-full h-9 sm:h-11 block" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,18 C340,78 1060,72 1440,10 L1440,80 L0,80 Z" fill="#93C5FD" fill-opacity="0.45"/>
          <path d="M0,38 C420,82 1080,68 1440,22 L1440,80 L0,80 Z" fill="#1646A8" fill-opacity="0.88"/>
        </svg>
      </div>
    </section>
  `;

  const form = document.getElementById('sp-signup-ui-form');
  const submitBtn = document.getElementById('sp-signup-submit-btn');
  const statusBox = document.getElementById('sp-signup-status');
  const signupRestrictionBanner = document.getElementById('sp-signup-restriction-banner');
  const fullNameInput = document.getElementById('sp-signup-fullname');
  const emailInput = document.getElementById('sp-signup-email');
  const passInput = document.getElementById('sp-signup-password');
  const confirmInput = document.getElementById('sp-signup-confirm');
  const termsInput = document.getElementById('sp-signup-terms');

  const strengthWrap = document.getElementById('sp-password-strength');
  const strengthBar = document.getElementById('sp-password-strength-bar');
  const strengthLabel = document.getElementById('sp-password-strength-label');

  const signupDraft = loadSignupDraft();
  if (signupDraft) {
    if (fullNameInput && !fullNameInput.value && signupDraft.name) {
      fullNameInput.value = signupDraft.name;
    }
    if (emailInput && !emailInput.value && signupDraft.email) {
      emailInput.value = signupDraft.email;
    }
  }

  const setFieldError = (inputEl, errId, msg) => {
    const errEl = document.getElementById(errId);
    if (!errEl) return;
    if (msg) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
      if (inputEl && inputEl.type !== 'checkbox') {
        inputEl.setAttribute('aria-invalid', 'true');
        inputEl.classList.add('border-[#DC2626]');
      }
    } else {
      errEl.textContent = '';
      errEl.classList.add('hidden');
      if (inputEl && inputEl.type !== 'checkbox') {
        inputEl.removeAttribute('aria-invalid');
        inputEl.classList.remove('border-[#DC2626]');
      }
    }
  };

  const showStatus = (tone, message) => {
    if (!statusBox) return;
    const toneClasses =
      tone === 'success'
        ? 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1E3A8A]'
        : tone === 'info'
        ? 'bg-[#F8FAFF] border-[#CBD8EC] text-[#1E3557]'
        : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]';
    statusBox.className = `mb-4 rounded-xl px-4 py-3 text-[13px] leading-relaxed border ${toneClasses}`;
    statusBox.textContent = message;
  };

  const wirePasswordToggle = (btnId, inputEl, fieldLabel) => {
    const btn = document.getElementById(btnId);
    if (!btn || !inputEl) return;
    btn.addEventListener('click', () => {
      const revealing = inputEl.type === 'password';
      inputEl.type = revealing ? 'text' : 'password';
      btn.setAttribute('aria-label', `${revealing ? 'Hide' : 'Show'} ${fieldLabel}`);
      btn.innerHTML = revealing ? eyeOpenSvg : eyeClosedSvg;
    });
  };

  wirePasswordToggle('sp-toggle-password', passInput, 'password');
  wirePasswordToggle('sp-toggle-confirm', confirmInput, 'confirm password');

  passInput?.addEventListener('input', () => {
    const val = passInput.value;
    setFieldError(passInput, 'sp-err-password', '');
    if (!val) {
      strengthWrap?.classList.add('hidden');
      return;
    }
    strengthWrap?.classList.remove('hidden');
    let score = 0;
    if (val.length >= 8) score++;
    if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
    if (/\d/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;
    const levels = [
      { w: '25%', bg: 'bg-[#DC2626]', label: 'Weak' },
      { w: '50%', bg: 'bg-[#D97706]', label: 'Fair' },
      { w: '75%', bg: 'bg-[#2563EB]', label: 'Good' },
      { w: '100%', bg: 'bg-[#059669]', label: 'Strong' },
    ];
    const lvl = levels[Math.max(0, Math.min(score - 1, 3))];
    if (strengthBar) {
      strengthBar.className = `h-full rounded-full transition-all duration-200 ${lvl.bg}`;
      strengthBar.style.width = lvl.w;
    }
    if (strengthLabel) strengthLabel.textContent = lvl.label;
    if (confirmInput?.value) {
      setFieldError(
        confirmInput,
        'sp-err-confirm',
        confirmInput.value === val ? '' : 'Passwords do not match.'
      );
    }
  });

  confirmInput?.addEventListener('input', () => {
    if (!confirmInput.value) {
      setFieldError(confirmInput, 'sp-err-confirm', '');
      return;
    }
    setFieldError(
      confirmInput,
      'sp-err-confirm',
      confirmInput.value === passInput?.value ? '' : 'Passwords do not match.'
    );
  });

  fullNameInput?.addEventListener('input', () => setFieldError(fullNameInput, 'sp-err-fullname', ''));
  emailInput?.addEventListener('input', () => setFieldError(emailInput, 'sp-err-email', ''));
  termsInput?.addEventListener('change', () => setFieldError(termsInput, 'sp-err-terms', ''));

  const signupGoogleBtn = document.getElementById('sp-signup-google-btn');
  const signupFacebookBtn = document.getElementById('sp-signup-facebook-btn');
  const signupTwitterBtn = document.getElementById('sp-signup-twitter-btn');
  const signupSocialBtns = [signupGoogleBtn, signupFacebookBtn, signupTwitterBtn];

  signupGoogleBtn?.addEventListener('click', () =>
    handleFirebaseSocialAuth({
      providerFn: signInWithGoogle,
      providerLabel: 'Google',
      buttonEl: signupGoogleBtn,
      allButtons: signupSocialBtns,
      restrictionBanner: signupRestrictionBanner,
      showStatus,
    })
  );
  signupFacebookBtn?.addEventListener('click', () =>
    handleFirebaseSocialAuth({
      providerFn: signInWithFacebook,
      providerLabel: 'Facebook',
      buttonEl: signupFacebookBtn,
      allButtons: signupSocialBtns,
      restrictionBanner: signupRestrictionBanner,
      showStatus,
    })
  );
  signupTwitterBtn?.addEventListener('click', () =>
    handleFirebaseSocialAuth({
      providerFn: signInWithTwitter,
      providerLabel: 'Twitter',
      buttonEl: signupTwitterBtn,
      allButtons: signupSocialBtns,
      restrictionBanner: signupRestrictionBanner,
      showStatus,
    })
  );

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    signupRestrictionBanner?.classList.add('hidden');
    let valid = true;

    const fullName = fullNameInput?.value.trim() || '';
    const email = emailInput?.value.trim() || '';
    const password = passInput?.value || '';
    const confirmPassword = confirmInput?.value || '';
    const acceptedTerms = Boolean(termsInput?.checked);

    if (fullName.length < 2) {
      setFieldError(fullNameInput, 'sp-err-fullname', 'Please enter your full name.');
      valid = false;
    } else {
      setFieldError(fullNameInput, 'sp-err-fullname', '');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError(emailInput, 'sp-err-email', 'Please enter a valid email address.');
      valid = false;
    } else {
      setFieldError(emailInput, 'sp-err-email', '');
    }

    if (password.length < 8) {
      setFieldError(passInput, 'sp-err-password', 'Password must be at least 8 characters long.');
      valid = false;
    } else {
      setFieldError(passInput, 'sp-err-password', '');
    }

    if (!confirmPassword || confirmPassword !== password) {
      setFieldError(confirmInput, 'sp-err-confirm', 'Passwords do not match.');
      valid = false;
    } else {
      setFieldError(confirmInput, 'sp-err-confirm', '');
    }

    if (!acceptedTerms) {
      setFieldError(termsInput, 'sp-err-terms', 'Please agree to the Terms & Conditions and Privacy Policy.');
      valid = false;
    } else {
      setFieldError(termsInput, 'sp-err-terms', '');
    }

    if (!valid) {
      showStatus('error', 'Please review the highlighted fields before continuing.');
      return;
    }

    const originalBtnHtml = submitBtn?.innerHTML || '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML =
        '<span class="inline-block w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin shrink-0" aria-hidden="true"></span><span>Sending verification OTP...</span>';
    }
    statusBox?.classList.add('hidden');

    try {
      const res = await apiFetch('/api/auth/signup/initiate', {
        method: 'POST',
        body: {
          name: fullName,
          email,
          password,
          confirmPassword,
          acceptedTerms,
        },
      });
      saveSignupDraft(fullName, email);
      savePendingOtpState(res);
      showToast('A 4-digit verification OTP has been sent to your email.', 'success');
      window.location.hash = '#/verify-otp';
    } catch (err) {
      if (err?.data?.accountBlocked || err?.data?.accountDeleted) {
        renderAccountRestrictionBanner(signupRestrictionBanner, err.data);
      }
      const msg = err?.message || 'Could not start verification. Please try again.';
      showStatus('error', msg);
      showToast(msg, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  });
}

function renderShieldLockIllustration(sizeCls = 'w-20 h-20', showSparks = false) {
  return `
    <div class="relative inline-flex items-center justify-center select-none">
      ${
        showSparks
          ? `
        <svg class="w-48 h-24 text-[#3B82F6]/35 pointer-events-none" viewBox="0 0 220 110" fill="none" aria-hidden="true">
          <ellipse cx="110" cy="54" rx="82" ry="30" transform="rotate(-14 110 54)" stroke="#60A5FA" stroke-opacity="0.45" stroke-width="1.8"/>
          <ellipse cx="110" cy="54" rx="82" ry="30" transform="rotate(14 110 54)" stroke="#60A5FA" stroke-opacity="0.45" stroke-width="1.8"/>
          <circle cx="34" cy="40" r="2.5" fill="#93C5FD"/>
          <circle cx="188" cy="68" r="2.5" fill="#93C5FD"/>
          <path d="M10 42L21 47M8 54H20M11 66L22 61" stroke="#1D4ED8" stroke-width="2.6" stroke-linecap="round"/>
          <path d="M210 42L199 47M212 54H200M209 66L198 61" stroke="#1D4ED8" stroke-width="2.6" stroke-linecap="round"/>
        </svg>
      `
          : ''
      }
      <svg class="${sizeCls} ${showSparks ? 'absolute' : ''} drop-shadow-[0_10px_22px_rgba(0,66,226,0.28)]" viewBox="0 0 84 92" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="spOtpShieldGrad" x1="12" y1="8" x2="72" y2="84" gradientUnits="userSpaceOnUse">
            <stop stop-color="#38B6FF"/>
            <stop offset="0.45" stop-color="#0F52FC"/>
            <stop offset="1" stop-color="#002CC7"/>
          </linearGradient>
        </defs>
        <path d="M42 4L74 17V44.5C74 64.5 60.2 81.2 42 88C23.8 81.2 10 64.5 10 44.5V17L42 4Z" fill="url(#spOtpShieldGrad)"/>
        <path d="M42 7L70 18.6V44.5C70 62.2 58 77.1 42 83.6V7Z" fill="#FFFFFF" fill-opacity="0.08"/>
        <!-- White padlock -->
        <path d="M33 39V33.5C33 28.5 37 24.5 42 24.5C47 24.5 51 28.5 51 33.5V39" stroke="#FFFFFF" stroke-width="4.4" stroke-linecap="round"/>
        <rect x="27.5" y="38" width="29" height="23" rx="5.5" fill="#FFFFFF"/>
        <circle cx="42" cy="48" r="2.8" fill="#0A43E8"/>
        <path d="M42 49.5V54.5" stroke="#0A43E8" stroke-width="2.8" stroke-linecap="round"/>
      </svg>
    </div>
  `;
}

export async function renderVerifyOtpPage(container) {
  cleanupOtpVerificationTimer();

  let pending = loadPendingOtpState();
  if (!pending || !pending.pendingToken) {
    container.innerHTML = `
      <section class="relative min-h-[calc(100vh-4.5rem)] w-full overflow-hidden bg-gradient-to-br from-[#F4F8FF] via-[#EAF2FF] to-[#DBE9FF] flex items-center justify-center px-4 py-12">
        <div class="w-full max-w-md bg-white rounded-[28px] border border-[#DCE6F7] shadow-[0_24px_60px_-15px_rgba(15,43,102,0.16)] p-7 sm:p-9 text-center">
          <img src="${OFFICIAL_SCHOLARPRESS_LOGO}" alt="ScholarPress Logo" class="h-16 w-auto mx-auto mb-4 object-contain" />
          <h1 class="text-2xl font-extrabold text-[#0A1647]">No Active Verification Session</h1>
          <p class="text-sm text-[#3B5278] mt-2 leading-relaxed">
            Start signing up with your details so we can send a 4-digit OTP to verify your email address.
          </p>
          <div class="mt-6 flex flex-col gap-2.5">
            <a href="#/signup" class="w-full h-12 rounded-2xl bg-gradient-to-r from-[#0F76FF] via-[#004AE2] to-[#002EC4] text-white font-semibold text-sm inline-flex items-center justify-center shadow-[0_10px_24px_-6px_rgba(0,62,216,0.45)]">
              Go to Sign Up
            </a>
            <a href="#/login" class="text-xs font-semibold text-[#004AE2] hover:underline py-2">Already verified? Sign In</a>
          </div>
        </div>
      </section>
    `;
    return;
  }

  // Sync remaining time and status with the backend server clock
  let serverOffsetMs = pending.serverTime
    ? new Date(pending.serverTime).getTime() - Date.now()
    : 0;
  let expiresAtMs = pending.expiresAt ? new Date(pending.expiresAt).getTime() : Date.now();
  let initialStatus = null;

  try {
    const statusRes = await apiFetch(
      `/api/auth/otp/status?pendingToken=${encodeURIComponent(pending.pendingToken)}`
    );
    initialStatus = statusRes;
    if (statusRes.maskedEmail) {
      pending.maskedEmail = statusRes.maskedEmail;
    }
    if (statusRes.serverTime) {
      serverOffsetMs = new Date(statusRes.serverTime).getTime() - Date.now();
    }
    if (statusRes.expiresAt) {
      expiresAtMs = new Date(statusRes.expiresAt).getTime();
      pending.expiresAt = statusRes.expiresAt;
    }
    savePendingOtpState(pending);
  } catch {
    // Keep stored pending metadata if transient offline/status issue; verify/resend will enforce server truth
  }

  const maskedEmailText = pending.maskedEmail || pending.email || 'your email';

  container.innerHTML = `
    <section class="relative min-h-[calc(100vh-4.5rem)] w-full overflow-hidden bg-gradient-to-br from-[#F7FAFF] via-[#EBF2FF] to-[#DCEBFF] text-[#0A1647] flex flex-col justify-between lg:justify-center py-6 sm:py-10 px-4 sm:px-6 lg:px-8">
      <!-- Subtle soft wave & dot-matrix background accents matching Reference 1 & Reference 2 -->
      <div class="pointer-events-none absolute -top-24 -left-24 w-[420px] h-[340px] rounded-full bg-white/70 blur-2xl"></div>
      <div class="pointer-events-none absolute -bottom-24 -right-20 w-[440px] h-[360px] rounded-full bg-[#B9D5FF]/55 blur-2xl"></div>
      <svg class="pointer-events-none hidden lg:block absolute right-0 bottom-0 w-[420px] h-[280px] opacity-55" viewBox="0 0 420 280" fill="none" aria-hidden="true">
        <path d="M420 40C310 110 210 180 70 280H420V40Z" fill="#C7DEFF"/>
        <path d="M420 120C330 175 245 225 160 280H420V120Z" fill="#9EC3FF" fill-opacity="0.6"/>
      </svg>

      <!-- Mobile dot-matrix corner accents (Reference Image 1) -->
      <div class="pointer-events-none lg:hidden absolute top-5 right-4 grid grid-cols-5 gap-2 opacity-35" aria-hidden="true">
        ${Array.from({ length: 20 })
          .map(() => '<span class="w-1.5 h-1.5 rounded-full bg-[#6095F9]"></span>')
          .join('')}
      </div>
      <div class="pointer-events-none lg:hidden absolute bottom-14 left-4 grid grid-cols-5 gap-2 opacity-35" aria-hidden="true">
        ${Array.from({ length: 15 })
          .map(() => '<span class="w-1.5 h-1.5 rounded-full bg-[#6095F9]"></span>')
          .join('')}
      </div>
      <svg class="pointer-events-none lg:hidden absolute bottom-0 inset-x-0 w-full h-24" viewBox="0 0 400 96" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 96C110 92 210 56 400 18V96H0Z" fill="#68A4FF" fill-opacity="0.35"/>
        <path d="M130 96C230 82 310 56 400 32V96H130Z" fill="#2B72FB" fill-opacity="0.55"/>
      </svg>

      <!-- MAIN CONTAINER -->
      <div class="relative z-10 w-full max-w-[440px] lg:max-w-[980px] mx-auto my-auto">

        <!-- MOBILE TOP BRANDING + SHIELD ILLUSTRATION (< lg, Reference Image 1) -->
        <div class="lg:hidden flex flex-col items-center text-center mb-1">
          <a href="#/" class="inline-flex items-center justify-center gap-2.5 mb-3">
            <img
              src="${OFFICIAL_SCHOLARPRESS_LOGO}"
              alt="ScholarPress Official Logo"
              class="h-11 w-auto object-contain shrink-0"
            />
            <span class="text-[24px] font-extrabold tracking-tight leading-none">
              <span class="text-[#0A1647]">Scholar</span><span class="text-[#0F52FC]">Press</span>
            </span>
          </a>

          <div class="-mb-6 z-20">
            ${renderShieldLockIllustration('w-[76px] h-[84px]', true)}
          </div>
        </div>

        <!-- DESKTOP 2-COLUMN SPLIT / MOBILE SINGLE CARD -->
        <div class="grid grid-cols-1 lg:grid-cols-12 items-center gap-8 lg:gap-10">

          <!-- DESKTOP LEFT COLUMN: Official ScholarPress Illustration & Tagline (Reference Image 2) -->
          <div class="hidden lg:flex lg:col-span-5 flex-col items-center text-center px-3">
            <div class="relative w-[320px] h-[230px] flex items-center justify-center mb-3">
              <!-- Soft radial glow + orbital arcs -->
              <div class="absolute inset-6 rounded-full bg-white/75 blur-2xl"></div>
              <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 320 230" fill="none" aria-hidden="true">
                <ellipse cx="160" cy="118" rx="128" ry="44" transform="rotate(-11 160 118)" stroke="#3B82F6" stroke-opacity="0.32" stroke-width="1.6"/>
                <ellipse cx="160" cy="118" rx="126" ry="46" transform="rotate(11 160 118)" stroke="#60A5FA" stroke-opacity="0.3" stroke-width="1.5"/>
                <circle cx="118" cy="24" r="4" fill="#93C5FD"/>
                <circle cx="208" cy="34" r="3" fill="#BFDBFE"/>
                <circle cx="48" cy="176" r="3.5" fill="#93C5FD"/>
              </svg>

              <!-- Floating Educational Circular Icons (matching Reference Image 2) -->
              <span class="absolute top-3 left-4 w-13 h-13 rounded-full bg-white/75 border border-white shadow-[0_8px_20px_rgba(37,99,235,0.1)] flex items-center justify-center text-[#1D5BFF]">
                <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 6.25C10.2 5.2 7.8 4.8 5.2 5.2C4.5 5.3 4 5.9 4 6.6V17.4C4 18.2 4.7 18.8 5.5 18.7C7.9 18.4 10.1 18.8 11.7 19.7C11.9 19.8 12.1 19.8 12.3 19.7C13.9 18.8 16.1 18.4 18.5 18.7C19.3 18.8 20 18.2 20 17.4V6.6C20 5.9 19.5 5.3 18.8 5.2C16.2 4.8 13.8 5.2 12 6.25Z"/>
                </svg>
              </span>
              <span class="absolute bottom-3 left-2 w-12 h-12 rounded-full bg-white/80 border border-white shadow-[0_8px_20px_rgba(37,99,235,0.1)] flex items-center justify-center text-[#1D5BFF]">
                <svg class="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5.14v14l11-7-11-7z"/>
                </svg>
              </span>
              <span class="absolute top-2 right-4 w-13 h-13 rounded-full bg-white/75 border border-white shadow-[0_8px_20px_rgba(37,99,235,0.1)] flex items-center justify-center text-[#1D5BFF]">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9"/>
                  <path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>
                </svg>
              </span>
              <span class="absolute top-[94px] -right-1 w-11 h-11 rounded-full bg-white/65 border border-white/80 shadow-sm flex items-center justify-center text-[#1D5BFF]">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24" aria-hidden="true">
                  <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(35 12 12)"/>
                  <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(-35 12 12)"/>
                  <ellipse cx="12" cy="12" rx="3.8" ry="9"/>
                  <circle cx="12" cy="12" r="1.6" fill="currentColor"/>
                </svg>
              </span>
              <span class="absolute bottom-2 right-5 w-12 h-12 rounded-full bg-white/80 border border-white shadow-[0_8px_20px_rgba(37,99,235,0.1)] flex items-center justify-center text-[#1D5BFF]">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="4" y="13" width="3.5" height="7" rx="1"/>
                  <rect x="10.25" y="9" width="3.5" height="11" rx="1"/>
                  <rect x="16.5" y="5" width="3.5" height="15" rx="1"/>
                </svg>
              </span>

              <!-- Official ScholarPress Logo Image (Reference Image 3) -->
              <img
                src="${OFFICIAL_SCHOLARPRESS_LOGO}"
                alt="ScholarPress Official Logo"
                class="relative z-10 w-[230px] h-auto object-contain drop-shadow-[0_12px_20px_rgba(10,30,68,0.16)]"
              />
            </div>

            <h2 class="text-[36px] font-extrabold tracking-tight leading-none">
              <span class="text-[#0A1647]">Scholar</span><span class="text-[#0F52FC]">Press</span>
            </h2>
            <p class="text-[18px] font-semibold text-[#0F52FC] mt-2">
              Your Knowledge, Our Mission
            </p>
            <div class="w-56 h-px bg-[#6095F9]/60 my-5"></div>
            <h3 class="text-[20px] font-bold text-[#0A1647]">
              Verify Your Account
            </h3>
            <p class="text-[14.5px] text-[#1E3A8A] leading-relaxed mt-1.5 max-w-[30ch]">
              Enter the 4-digit OTP sent to your email or user ID.
            </p>
          </div>

          <!-- RIGHT COLUMN (Desktop) / MAIN CARD (Mobile) -->
          <div class="lg:col-span-7">
            <div class="bg-white rounded-[28px] border border-[#DCE6F7]/90 shadow-[0_24px_60px_-15px_rgba(15,43,102,0.18)] px-5 pt-9 pb-6 sm:p-8 lg:px-10 lg:py-9">

              <!-- Desktop Card Header (Shield Icon Left + Title/Email Right, Reference Image 2) -->
              <div class="hidden lg:flex items-center gap-5 mb-7">
                <div class="shrink-0">
                  ${renderShieldLockIllustration('w-[76px] h-[84px]', false)}
                </div>
                <div class="min-w-0">
                  <h1 class="text-[30px] font-extrabold tracking-tight text-[#0A1647] leading-tight">
                    OTP Verification
                  </h1>
                  <p class="text-[15px] text-[#111827] mt-1">
                    We have sent a 4-digit OTP to
                  </p>
                  <div class="mt-2 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#E3EEFF] text-[#0039D7] font-semibold text-[14px] max-w-full">
                    <svg class="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M1.5 8.67v8.58a3 3 0 003 3h15a3 3 0 003-3V8.67l-8.928 5.493a3 3 0 01-3.144 0L1.5 8.67z"/>
                      <path d="M22.5 6.908V6.75a3 3 0 00-3-3h-15a3 3 0 00-3 3v.158l9.714 5.978a1.5 1.5 0 001.572 0L22.5 6.908z"/>
                    </svg>
                    <span id="otp-masked-email-desk" class="truncate">${esc(maskedEmailText)}</span>
                  </div>
                </div>
              </div>

              <!-- Mobile Card Header (Centered, Reference Image 1) -->
              <div class="lg:hidden text-center mb-6">
                <h1 class="text-[26px] font-extrabold tracking-tight text-[#0A1647] leading-tight">
                  OTP Verification
                </h1>
                <p class="text-[14px] text-[#1E293B] leading-relaxed mt-2 max-w-[30ch] mx-auto">
                  We have sent a 4-digit OTP to your email or registered ID
                </p>
                <div class="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E3EEFF] text-[#0039D7] font-semibold text-[12.5px] max-w-full">
                  <svg class="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M1.5 8.67v8.58a3 3 0 003 3h15a3 3 0 003-3V8.67l-8.928 5.493a3 3 0 01-3.144 0L1.5 8.67z"/>
                    <path d="M22.5 6.908V6.75a3 3 0 00-3-3h-15a3 3 0 00-3 3v.158l9.714 5.978a1.5 1.5 0 001.572 0L22.5 6.908z"/>
                  </svg>
                  <span id="otp-masked-email-mob" class="truncate">${esc(maskedEmailText)}</span>
                </div>
              </div>

              <!-- Status / Error / Success Feedback Banner -->
              <div id="otp-feedback-banner" class="hidden mb-4 rounded-xl px-4 py-3 text-[13px] leading-relaxed border text-center" role="alert" aria-live="polite"></div>

              <form id="sp-otp-verify-form" novalidate>
                <!-- 4 Single-Digit OTP Input Boxes -->
                <div class="flex items-center justify-center gap-3 sm:gap-4" role="group" aria-label="4-digit verification OTP">
                  ${[0, 1, 2, 3]
                    .map(
                      (idx) => `
                    <input
                      id="otp-digit-${idx}"
                      data-otp-index="${idx}"
                      type="text"
                      inputmode="numeric"
                      pattern="[0-9]*"
                      maxlength="1"
                      ${idx === 0 ? 'autocomplete="one-time-code"' : 'autocomplete="off"'}
                      placeholder="—"
                      aria-label="OTP digit ${idx + 1}"
                      class="otp-digit-input w-[62px] h-[56px] sm:w-[76px] sm:h-[64px] rounded-[14px] border-2 border-[#DCE5F2] bg-white text-center text-[24px] sm:text-[26px] font-bold text-[#0A1647] placeholder:text-[#94A3B8] placeholder:font-medium focus:border-[#0F52FC] focus:ring-4 focus:ring-[#0F52FC]/12 outline-none transition-all caret-[#0F52FC]"
                    />
                  `
                    )
                    .join('')}
                </div>

                <!-- Countdown Timer Row -->
                <div class="mt-5 flex items-center justify-center gap-2 text-[15px]">
                  <svg class="w-6 h-6 text-[#0F52FC] shrink-0" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9"/>
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 7v5l3 2"/>
                  </svg>
                  <span id="otp-timer-value" class="text-[22px] font-extrabold tracking-tight text-[#0F52FC] tabular-nums">1:59</span>
                  <span class="text-[14.5px] font-medium text-[#1E293B]">Time Left</span>
                </div>

                <!-- Expiry Notice Pill -->
                <div id="otp-expiry-pill" class="mt-3.5 rounded-xl bg-[#E5EFFD] px-4 py-2.5 flex items-center justify-center gap-2.5 text-[13.5px] font-medium text-[#0F172A]">
                  <span class="w-5 h-5 rounded-full bg-[#0F52FC] text-white text-[12px] font-bold inline-flex items-center justify-center shrink-0" aria-hidden="true">i</span>
                  <span id="otp-expiry-text">OTP will expire in 2 minutes.</span>
                </div>

                <!-- Primary Blue Gradient Confirm OTP Button -->
                <button
                  type="submit"
                  id="otp-confirm-btn"
                  disabled
                  class="mt-5 w-full h-[52px] px-5 rounded-2xl lg:rounded-xl bg-gradient-to-r from-[#0F76FF] via-[#004AE2] to-[#002EC4] hover:from-[#0E6AE8] hover:to-[#0026A8] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed text-white text-[16px] font-semibold flex items-center justify-center gap-2.5 shadow-[0_12px_26px_-8px_rgba(0,62,216,0.52)] transition-all duration-150"
                >
                  <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.8" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
                  </svg>
                  <span>Confirm OTP</span>
                </button>
              </form>

              <!-- Mobile OR Divider -->
              <div class="lg:hidden relative my-4">
                <div class="absolute inset-0 flex items-center" aria-hidden="true">
                  <div class="w-full border-t border-[#E2E8F0]"></div>
                </div>
                <div class="relative flex justify-center">
                  <span class="px-3 bg-white text-[12.5px] font-medium text-[#64748B]">OR</span>
                </div>
              </div>

              <!-- Resend OTP & Back Action Row (Mobile: stacked outlined pill + link; Desktop: inline with divider) -->
              <div class="mt-3 lg:mt-6 flex flex-col lg:flex-row items-center justify-center gap-3 lg:gap-5">
                <button
                  type="button"
                  id="otp-resend-btn"
                  disabled
                  class="w-full lg:w-auto h-[48px] lg:h-auto px-4 lg:px-2 rounded-2xl lg:rounded-lg border border-[#3B82F6] lg:border-0 bg-white lg:bg-transparent text-[#004AE2] hover:bg-[#F4F8FF] lg:hover:bg-transparent lg:hover:underline disabled:border-[#CBD5E1] disabled:text-[#94A3B8] disabled:cursor-not-allowed text-[15px] font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
                  </svg>
                  <span id="otp-resend-label">Resend OTP</span>
                </button>

                <span class="hidden lg:inline-block w-px h-5 bg-[#CBD5E1]" aria-hidden="true"></span>

                <button
                  type="button"
                  id="otp-back-btn"
                  class="py-1.5 px-3 text-[15px] font-semibold text-[#004AE2] lg:text-[#0A1647] hover:text-[#0039D7] inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.3" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
                  </svg>
                  <span class="lg:hidden">Back to Sign Up</span>
                  <span class="hidden lg:inline">Back</span>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  `;

  const digitInputs = Array.from(container.querySelectorAll('.otp-digit-input'));
  const verifyForm = document.getElementById('sp-otp-verify-form');
  const confirmBtn = document.getElementById('otp-confirm-btn');
  const resendBtn = document.getElementById('otp-resend-btn');
  const resendLabel = document.getElementById('otp-resend-label');
  const backBtn = document.getElementById('otp-back-btn');
  const timerEl = document.getElementById('otp-timer-value');
  const expiryTextEl = document.getElementById('otp-expiry-text');
  const feedbackEl = document.getElementById('otp-feedback-banner');

  const confirmBtnDefaultHtml = confirmBtn?.innerHTML || '';
  let isVerifying = false;
  let isResending = false;
  let isLocked = Boolean(initialStatus && initialStatus.attemptsRemaining <= 0);

  const showOtpFeedback = (tone, msg) => {
    if (!feedbackEl) return;
    if (!msg) {
      feedbackEl.classList.add('hidden');
      feedbackEl.textContent = '';
      return;
    }
    const toneClasses =
      tone === 'success'
        ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
        : tone === 'info'
        ? 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1E3A8A]'
        : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]';
    feedbackEl.className = `mb-4 rounded-xl px-4 py-3 text-[13px] leading-relaxed border text-center ${toneClasses}`;
    feedbackEl.textContent = msg;
  };

  const getEnteredOtp = () => digitInputs.map((el) => el.value.trim()).join('');

  const syncConfirmButtonState = () => {
    const code = getEnteredOtp();
    const expired = getRemainingSeconds() <= 0;
    if (confirmBtn) {
      confirmBtn.disabled = isVerifying || expired || isLocked || !/^\d{4}$/.test(code);
    }
  };

  function getRemainingSeconds() {
    const syncedNow = Date.now() + serverOffsetMs;
    const diffMs = expiresAtMs - syncedNow;
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / 1000);
  }

  function formatMmSs(totalSeconds) {
    const clamped = Math.max(0, totalSeconds);
    // Start display at 1:59 immediately after 120s OTP is sent (matching Reference 1 & 2)
    const displaySec = clamped >= 120 ? 119 : clamped;
    const mins = Math.floor(displaySec / 60);
    const secs = displaySec % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function updateCountdownUi() {
    const remaining = getRemainingSeconds();
    if (timerEl) {
      timerEl.textContent = formatMmSs(remaining);
    }
    if (remaining <= 0) {
      if (expiryTextEl) {
        expiryTextEl.textContent = 'OTP expired. Please click Resend OTP to get a new code.';
      }
      if (resendBtn && !isResending) {
        resendBtn.disabled = false;
      }
      if (resendLabel) {
        resendLabel.textContent = 'Resend OTP';
      }
      syncConfirmButtonState();
    } else {
      if (expiryTextEl) {
        expiryTextEl.textContent = 'OTP will expire in 2 minutes.';
      }
      if (resendBtn) {
        resendBtn.disabled = true;
      }
      if (resendLabel) {
        resendLabel.textContent = 'Resend OTP';
      }
      syncConfirmButtonState();
    }
  }

  updateCountdownUi();
  activeOtpCountdownTimer = window.setInterval(updateCountdownUi, 500);

  if (initialStatus?.status === 'verified') {
    showOtpFeedback('info', 'This signup has already been verified. Please sign in.');
  } else if (isLocked) {
    showOtpFeedback(
      'error',
      'Maximum incorrect attempts reached (5/5). Please wait for the timer to expire and request a new OTP.'
    );
  } else if (getRemainingSeconds() <= 0) {
    showOtpFeedback('info', 'Your previous OTP has expired. Click Resend OTP to receive a new code.');
  }

  // Wire 4 single-digit numeric boxes (auto-advance, backspace back, paste 4 digits)
  digitInputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      const cleaned = String(e.target.value || '').replace(/\D/g, '');
      if (cleaned.length > 1) {
        // Handle mobile autofill / quick paste into single box
        const chars = cleaned.slice(0, 4).split('');
        chars.forEach((ch, offset) => {
          if (digitInputs[offset]) digitInputs[offset].value = ch;
        });
        const nextFocus = digitInputs[Math.min(chars.length, 3)];
        nextFocus?.focus();
      } else {
        input.value = cleaned;
        if (cleaned && index < digitInputs.length - 1) {
          digitInputs[index + 1].focus();
        }
      }
      syncConfirmButtonState();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!input.value && index > 0) {
          e.preventDefault();
          digitInputs[index - 1].value = '';
          digitInputs[index - 1].focus();
          syncConfirmButtonState();
        }
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        digitInputs[index - 1].focus();
      } else if (e.key === 'ArrowRight' && index < digitInputs.length - 1) {
        e.preventDefault();
        digitInputs[index + 1].focus();
      }
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 4);
      if (!pasted) return;
      pasted.split('').forEach((ch, idx) => {
        if (digitInputs[idx]) digitInputs[idx].value = ch;
      });
      const focusIdx = Math.min(pasted.length - 1, 3);
      digitInputs[focusIdx]?.focus();
      syncConfirmButtonState();
    });

    input.addEventListener('focus', () => {
      input.select();
    });
  });

  // Auto-focus first input box on load
  requestAnimationFrame(() => {
    digitInputs[0]?.focus();
  });

  verifyForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isVerifying) return;

    const otp = getEnteredOtp();
    if (!/^\d{4}$/.test(otp)) {
      showOtpFeedback('error', 'Please enter all 4 digits of your verification OTP.');
      return;
    }
    if (getRemainingSeconds() <= 0) {
      showOtpFeedback('error', 'OTP has expired. Please click Resend OTP for a new code.');
      syncConfirmButtonState();
      return;
    }

    isVerifying = true;
    syncConfirmButtonState();
    if (confirmBtn) {
      confirmBtn.innerHTML =
        '<span class="inline-block w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin shrink-0" aria-hidden="true"></span><span>Verifying OTP...</span>';
    }
    showOtpFeedback(null, '');

    try {
      const res = await apiFetch('/api/auth/otp/verify', {
        method: 'POST',
        body: { pendingToken: pending.pendingToken, otp },
      });

      cleanupOtpVerificationTimer();
      clearPendingOtpState();
      clearSignupDraft();

      setSessionToken(res.token);
      store.user = res.user;
      notifyStore();

      const successMsg = res.message || 'Email verified successfully. Your account has been created.';
      showOtpFeedback('success', successMsg);
      showToast(successMsg, 'success');

      const needsProfileSetup = !res.user?.username || !res.user?.profile?.profileCompleted;
      const defaultDest =
        res.user?.role === 'admin'
          ? '#/admin'
          : res.user?.role === 'creator'
          ? '#/creator'
          : '#/dashboard/settings';
      const targetHash =
        needsProfileSetup && !res.user?.isSuperAdmin
          ? '#/complete-profile'
          : consumePostLoginRedirect(defaultDest);

      window.setTimeout(() => {
        window.location.hash = targetHash;
      }, 650);
    } catch (err) {
      if (err?.data?.locked) {
        isLocked = true;
      }
      if (err?.data?.expired) {
        expiresAtMs = Date.now() - 1000;
        updateCountdownUi();
      }
      const msg = err?.message || 'Verification failed. Please check your OTP and try again.';
      showOtpFeedback('error', msg);
      showToast(msg, 'error');
    } finally {
      isVerifying = false;
      if (confirmBtn) {
        confirmBtn.innerHTML = confirmBtnDefaultHtml;
      }
      syncConfirmButtonState();
    }
  });

  resendBtn?.addEventListener('click', async () => {
    if (isResending || getRemainingSeconds() > 0) return;

    isResending = true;
    resendBtn.disabled = true;
    if (resendLabel) resendLabel.textContent = 'Sending...';
    showOtpFeedback(null, '');

    try {
      const res = await apiFetch('/api/auth/otp/resend', {
        method: 'POST',
        body: { pendingToken: pending.pendingToken },
      });

      isLocked = false;
      if (res.serverTime) {
        serverOffsetMs = new Date(res.serverTime).getTime() - Date.now();
      }
      if (res.expiresAt) {
        expiresAtMs = new Date(res.expiresAt).getTime();
      }
      pending = {
        ...pending,
        maskedEmail: res.maskedEmail || pending.maskedEmail,
        expiresAt: res.expiresAt || pending.expiresAt,
        serverTime: res.serverTime || pending.serverTime,
      };
      savePendingOtpState(pending);

      digitInputs.forEach((input) => {
        input.value = '';
      });
      digitInputs[0]?.focus();
      updateCountdownUi();

      const msg = res.message || 'A new 4-digit OTP has been sent to your email.';
      showOtpFeedback('info', msg);
      showToast(msg, 'success');
    } catch (err) {
      const msg = err?.message || 'Could not resend OTP right now.';
      showOtpFeedback('error', msg);
      showToast(msg, 'error');
      if (getRemainingSeconds() <= 0) {
        resendBtn.disabled = false;
      }
    } finally {
      isResending = false;
      if (resendLabel) resendLabel.textContent = 'Resend OTP';
      updateCountdownUi();
    }
  });

  backBtn?.addEventListener('click', () => {
    cleanupOtpVerificationTimer();
    window.location.hash = '#/signup';
  });
}

function renderForgotPasswordPage(container) {
  container.innerHTML = `
    <section class="relative min-h-[calc(100vh-4.5rem)] w-full overflow-hidden bg-gradient-to-br from-[#F7FAFF] via-[#EBF2FF] to-[#DCEBFF] text-[#0A1647] flex items-center justify-center py-8 sm:py-12 px-4 sm:px-6">
      <div class="pointer-events-none absolute -top-24 -left-24 w-[380px] h-[320px] rounded-full bg-white/70 blur-2xl"></div>
      <div class="pointer-events-none absolute -bottom-24 -right-20 w-[400px] h-[340px] rounded-full bg-[#B9D5FF]/55 blur-2xl"></div>

      <div class="relative z-10 w-full max-w-[460px] mx-auto">
        <div class="flex flex-col items-center text-center mb-5">
          <a href="#/" class="inline-flex items-center justify-center gap-2.5 mb-3">
            <img
              src="${OFFICIAL_SCHOLARPRESS_LOGO}"
              alt="ScholarPress Official Logo"
              class="h-11 w-auto object-contain shrink-0"
            />
            <span class="text-[24px] font-extrabold tracking-tight leading-none">
              <span class="text-[#0A1647]">Scholar</span><span class="text-[#0F52FC]">Press</span>
            </span>
          </a>
        </div>

        <div class="bg-white rounded-[28px] border border-[#DCE6F7]/90 shadow-[0_24px_60px_-15px_rgba(15,43,102,0.18)] px-5 py-7 sm:p-9">
          <div class="flex flex-col items-center text-center mb-6">
            <div class="w-16 h-16 rounded-2xl bg-[#EBF2FF] border border-[#C7DCFF] flex items-center justify-center text-[#0F52FC] mb-4 shadow-sm">
              <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/>
              </svg>
            </div>
            <h1 class="text-[26px] sm:text-[28px] font-extrabold tracking-tight text-[#0A1647] leading-tight">
              Forgot Password
            </h1>
            <p class="text-[14px] text-[#3B5278] leading-relaxed mt-2 max-w-[36ch]">
              Enter your registered email address and we will send you a secure link to reset your password.
            </p>
          </div>

          <div id="forgot-status-box" class="hidden mb-4 rounded-xl px-4 py-3 text-[13px] leading-relaxed border" role="status" aria-live="polite"></div>

          <form id="forgot-form" class="space-y-4" novalidate>
            <div>
              <label for="forgot-email-input" class="block text-xs font-bold uppercase tracking-wider text-[#1E3A8A] mb-1.5">
                Registered Email Address
              </label>
              <div class="relative">
                <span class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#3B5278]">
                  <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm0 0c0 1.657 1.007 3 2.25 3S21 13.657 21 12a9 9 0 10-2.636 6.364M16.5 12V8.25"/>
                  </svg>
                </span>
                <input
                  id="forgot-email-input"
                  name="email"
                  type="email"
                  autocomplete="email"
                  required
                  placeholder="you@example.com"
                  class="w-full h-12 pl-11 pr-4 rounded-xl border border-[#C6D4E8] bg-white text-[#0A1E44] placeholder:text-[#5B7091] text-[15px] transition-colors focus:border-[#1D4ED8] focus:ring-4 focus:ring-[#1D4ED8]/12 outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              id="forgot-submit-btn"
              class="w-full h-12 px-5 rounded-2xl bg-gradient-to-r from-[#0F76FF] via-[#004AE2] to-[#002EC4] hover:from-[#0E69EB] hover:to-[#0026A8] active:scale-[0.99] disabled:opacity-65 disabled:cursor-not-allowed text-white text-[15px] font-semibold flex items-center justify-center gap-2.5 shadow-[0_10px_24px_-6px_rgba(0,62,216,0.45)] transition-all duration-150"
            >
              <svg class="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/>
              </svg>
              <span>Send Reset Link</span>
            </button>
          </form>

          <div class="mt-6 pt-5 border-t border-[#E6EEF9] flex items-center justify-between text-xs font-semibold">
            <a href="#/login" class="inline-flex items-center gap-1.5 text-[#004AE2] hover:text-[#002EC4] hover:underline">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
              </svg>
              <span>Back to Sign In</span>
            </a>
            <a href="#/signup" class="text-[#3B5278] hover:text-[#0A1647] hover:underline">Create Account</a>
          </div>
        </div>
      </div>
    </section>
  `;

  const form = document.getElementById('forgot-form');
  const emailInput = document.getElementById('forgot-email-input');
  const submitBtn = document.getElementById('forgot-submit-btn');
  const statusBox = document.getElementById('forgot-status-box');
  const defaultBtnHtml = submitBtn?.innerHTML || '';

  const showForgotStatus = (tone, message) => {
    if (!statusBox) return;
    const toneClasses =
      tone === 'success'
        ? 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1E3A8A]'
        : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]';
    statusBox.className = `mb-4 rounded-xl px-4 py-3 text-[13px] leading-relaxed border ${toneClasses}`;
    statusBox.textContent = message;
  };

  requestAnimationFrame(() => emailInput?.focus());

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput?.value.trim() || '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showForgotStatus('error', 'Please enter a valid email address.');
      emailInput?.focus();
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML =
        '<span class="inline-block w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin shrink-0" aria-hidden="true"></span><span>Sending Reset Link...</span>';
    }
    statusBox?.classList.add('hidden');

    try {
      const res = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
      const msg =
        res.message ||
        'If an account matches this email address, we have sent a password reset link. Please check your inbox and spam folder (valid for 15 minutes).';
      showForgotStatus('success', msg);
      showToast('Password reset email instructions processed.', 'success');
    } catch (err) {
      const msg = err?.message || 'Unable to process password reset request right now.';
      showForgotStatus('error', msg);
      showToast(msg, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = defaultBtnHtml;
      }
    }
  });
}

export async function renderResetPasswordPage(container, resetToken = '', onResetSuccess = null) {
  const token = String(resetToken || '').trim();
  const eyeOpenSvg =
    '<svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
  const eyeClosedSvg =
    '<svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/></svg>';

  const renderShellCard = (innerHtml) => {
    container.innerHTML = `
      <section class="relative min-h-[calc(100vh-4.5rem)] w-full overflow-hidden bg-gradient-to-br from-[#F7FAFF] via-[#EBF2FF] to-[#DCEBFF] text-[#0A1647] flex items-center justify-center py-8 sm:py-12 px-4 sm:px-6">
        <div class="pointer-events-none absolute -top-24 -left-24 w-[380px] h-[320px] rounded-full bg-white/70 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-24 -right-20 w-[400px] h-[340px] rounded-full bg-[#B9D5FF]/55 blur-2xl"></div>
        <div class="relative z-10 w-full max-w-[470px] mx-auto">
          <div class="flex flex-col items-center text-center mb-5">
            <a href="#/" class="inline-flex items-center justify-center gap-2.5">
              <img
                src="${OFFICIAL_SCHOLARPRESS_LOGO}"
                alt="ScholarPress Official Logo"
                class="h-11 w-auto object-contain shrink-0"
              />
              <span class="text-[24px] font-extrabold tracking-tight leading-none">
                <span class="text-[#0A1647]">Scholar</span><span class="text-[#0F52FC]">Press</span>
              </span>
            </a>
          </div>
          <div class="bg-white rounded-[28px] border border-[#DCE6F7]/90 shadow-[0_24px_60px_-15px_rgba(15,43,102,0.18)] px-5 py-7 sm:p-9">
            ${innerHtml}
          </div>
        </div>
      </section>
    `;
  };

  const renderInvalidState = (title, message) => {
    renderShellCard(`
      <div class="text-center">
        <div class="w-16 h-16 rounded-2xl bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626] flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
          </svg>
        </div>
        <h1 class="text-[24px] font-extrabold text-[#0A1647] leading-tight">
          ${esc(title)}
        </h1>
        <p class="text-[14px] text-[#3B5278] leading-relaxed mt-2.5">
          ${esc(message)}
        </p>
        <div class="mt-6 flex flex-col gap-2.5">
          <a href="#/forgot-password" class="w-full h-12 rounded-2xl bg-gradient-to-r from-[#0F76FF] via-[#004AE2] to-[#002EC4] text-white font-semibold text-sm inline-flex items-center justify-center shadow-[0_10px_24px_-6px_rgba(0,62,216,0.45)]">
            Request a New Reset Link
          </a>
          <a href="#/login" class="w-full h-11 rounded-2xl border border-[#C6D4E8] text-[#0A1647] hover:bg-[#F5F9FF] font-semibold text-sm inline-flex items-center justify-center">
            Back to Login
          </a>
        </div>
      </div>
    `);
  };

  if (!token) {
    renderInvalidState(
      'Invalid Password Reset Link',
      'This password reset link is missing or incomplete. Please request a fresh password reset email.'
    );
    return;
  }

  renderShellCard(`
    <div class="py-6 text-center">
      <div class="w-12 h-12 rounded-full border-4 border-[#DCE6F7] border-t-[#0F52FC] animate-spin mx-auto mb-4" aria-hidden="true"></div>
      <h1 class="text-xl font-bold text-[#0A1647]">
        Verifying Reset Link...
      </h1>
      <p class="text-xs text-[#3B5278] mt-1.5">
        Checking security token validity with ScholarPress.
      </p>
    </div>
  `);

  let validation;
  try {
    validation = await apiFetch('/api/auth/reset-password/validate', {
      method: 'POST',
      body: { token },
    });
  } catch (err) {
    const reason = err?.data?.reason;
    const title =
      reason === 'expired'
        ? 'Reset Link Expired'
        : reason === 'used'
        ? 'Reset Link Already Used'
        : 'Invalid Reset Link';
    renderInvalidState(
      title,
      err?.message || 'This password reset link is invalid or has expired. Please request a new reset link.'
    );
    return;
  }

  if (!validation?.valid) {
    renderInvalidState(
      'Invalid Reset Link',
      validation?.error || 'This password reset link is invalid or has expired.'
    );
    return;
  }

  renderShellCard(`
    <div class="flex flex-col items-center text-center mb-6">
      <div class="mb-3">
        ${renderShieldLockIllustration('w-14 h-16', false)}
      </div>
      <h1 class="text-[26px] font-extrabold tracking-tight text-[#0A1647] leading-tight">
        Create New Password
      </h1>
      <p class="text-[13.5px] text-[#3B5278] mt-1.5">
        Choose a strong new password for your ScholarPress account
      </p>
      ${
        validation.maskedEmail
          ? `<div class="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E3EEFF] text-[#0039D7] font-semibold text-xs">
              <span>Account:</span>
              <span>${esc(validation.maskedEmail)}</span>
            </div>`
          : ''
      }
    </div>

    <div id="reset-status-box" class="hidden mb-4 rounded-xl px-4 py-3 text-[13px] leading-relaxed border" role="status" aria-live="polite"></div>

    <form id="reset-password-form" class="space-y-4" novalidate>
      <div>
        <label for="reset-new-password" class="block text-xs font-bold uppercase tracking-wider text-[#1E3A8A] mb-1.5">
          New Password
        </label>
        <div class="relative">
          <span class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#3B5278]">
            <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
            </svg>
          </span>
          <input
            id="reset-new-password"
            name="password"
            type="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            required
            placeholder="Minimum 8 characters"
            class="w-full h-12 pl-11 pr-12 rounded-xl border border-[#C6D4E8] bg-white text-[#0A1E44] placeholder:text-[#5B7091] text-[15px] transition-colors focus:border-[#1D4ED8] focus:ring-4 focus:ring-[#1D4ED8]/12 outline-none"
          />
          <button
            type="button"
            id="reset-toggle-password"
            aria-label="Show new password"
            class="absolute inset-y-0 right-1 w-11 flex items-center justify-center rounded-lg text-[#5B7091] hover:text-[#0A1E44] transition-colors"
          >
            ${eyeClosedSvg}
          </button>
        </div>
        <div id="reset-strength-wrap" class="mt-2">
          <div class="flex items-center justify-between gap-2 mb-1">
            <span class="text-[11px] font-semibold text-[#4B607F]">Password strength</span>
            <span id="reset-strength-label" class="text-[11px] font-bold text-[#3B5278]">Enter at least 8 characters</span>
          </div>
          <div class="w-full h-1.5 rounded-full bg-[#E6EEF9] overflow-hidden">
            <div id="reset-strength-bar" class="h-full w-0 rounded-full transition-all duration-200"></div>
          </div>
        </div>
        <p id="reset-err-password" class="hidden mt-1 text-[12px] font-medium text-[#B91C1C]"></p>
      </div>

      <div>
        <label for="reset-confirm-password" class="block text-xs font-bold uppercase tracking-wider text-[#1E3A8A] mb-1.5">
          Confirm New Password
        </label>
        <div class="relative">
          <span class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#3B5278]">
            <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
            </svg>
          </span>
          <input
            id="reset-confirm-password"
            name="confirmPassword"
            type="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            required
            placeholder="Re-enter your new password"
            class="w-full h-12 pl-11 pr-12 rounded-xl border border-[#C6D4E8] bg-white text-[#0A1E44] placeholder:text-[#5B7091] text-[15px] transition-colors focus:border-[#1D4ED8] focus:ring-4 focus:ring-[#1D4ED8]/12 outline-none"
          />
          <button
            type="button"
            id="reset-toggle-confirm"
            aria-label="Show confirm new password"
            class="absolute inset-y-0 right-1 w-11 flex items-center justify-center rounded-lg text-[#5B7091] hover:text-[#0A1E44] transition-colors"
          >
            ${eyeClosedSvg}
          </button>
        </div>
        <p id="reset-err-confirm" class="hidden mt-1 text-[12px] font-medium text-[#B91C1C]"></p>
      </div>

      <button
        type="submit"
        id="reset-submit-btn"
        class="w-full h-12 px-5 rounded-2xl bg-gradient-to-r from-[#0F76FF] via-[#004AE2] to-[#002EC4] hover:from-[#0E69EB] hover:to-[#0026A8] active:scale-[0.99] disabled:opacity-65 disabled:cursor-not-allowed text-white text-[15px] font-semibold flex items-center justify-center gap-2 shadow-[0_10px_24px_-6px_rgba(0,62,216,0.45)] transition-all duration-150"
      >
        <svg class="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/>
        </svg>
        <span>Reset Password</span>
      </button>
    </form>
  `);

  const form = document.getElementById('reset-password-form');
  const passInput = document.getElementById('reset-new-password');
  const confirmInput = document.getElementById('reset-confirm-password');
  const submitBtn = document.getElementById('reset-submit-btn');
  const statusBox = document.getElementById('reset-status-box');
  const strengthBar = document.getElementById('reset-strength-bar');
  const strengthLabel = document.getElementById('reset-strength-label');
  const defaultBtnHtml = submitBtn?.innerHTML || '';

  const wireToggle = (btnId, inputEl, labelText) => {
    const btn = document.getElementById(btnId);
    if (!btn || !inputEl) return;
    btn.addEventListener('click', () => {
      const revealing = inputEl.type === 'password';
      inputEl.type = revealing ? 'text' : 'password';
      btn.setAttribute('aria-label', `${revealing ? 'Hide' : 'Show'} ${labelText}`);
      btn.innerHTML = revealing ? eyeOpenSvg : eyeClosedSvg;
    });
  };
  wireToggle('reset-toggle-password', passInput, 'new password');
  wireToggle('reset-toggle-confirm', confirmInput, 'confirm new password');

  const setErr = (inputEl, errId, msg) => {
    const errEl = document.getElementById(errId);
    if (!errEl) return;
    if (msg) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
      inputEl?.classList.add('border-[#DC2626]');
    } else {
      errEl.textContent = '';
      errEl.classList.add('hidden');
      inputEl?.classList.remove('border-[#DC2626]');
    }
  };

  passInput?.addEventListener('input', () => {
    const val = passInput.value;
    setErr(passInput, 'reset-err-password', '');
    if (!val) {
      if (strengthBar) {
        strengthBar.className = 'h-full w-0 rounded-full transition-all duration-200';
        strengthBar.style.width = '0%';
      }
      if (strengthLabel) {
        strengthLabel.textContent = 'Enter at least 8 characters';
        strengthLabel.className = 'text-[11px] font-bold text-[#3B5278]';
      }
      return;
    }
    let score = 0;
    if (val.length >= 8) score++;
    if (val.length >= 12) score++;
    if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
    if (/\d/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;
    const idx = val.length < 8 ? 0 : Math.min(3, Math.max(0, score - 1));
    const levels = [
      { w: '25%', bg: 'bg-[#DC2626]', text: 'text-[#DC2626]', label: 'Weak' },
      { w: '50%', bg: 'bg-[#D97706]', text: 'text-[#D97706]', label: 'Fair' },
      { w: '75%', bg: 'bg-[#2563EB]', text: 'text-[#2563EB]', label: 'Good' },
      { w: '100%', bg: 'bg-[#059669]', text: 'text-[#059669]', label: 'Strong' },
    ];
    const lvl = levels[idx];
    if (strengthBar) {
      strengthBar.className = `h-full rounded-full transition-all duration-200 ${lvl.bg}`;
      strengthBar.style.width = lvl.w;
    }
    if (strengthLabel) {
      strengthLabel.textContent = lvl.label;
      strengthLabel.className = `text-[11px] font-bold ${lvl.text}`;
    }
    if (confirmInput?.value) {
      setErr(
        confirmInput,
        'reset-err-confirm',
        confirmInput.value === val ? '' : 'Passwords do not match.'
      );
    }
  });

  confirmInput?.addEventListener('input', () => {
    if (!confirmInput.value) {
      setErr(confirmInput, 'reset-err-confirm', '');
      return;
    }
    setErr(
      confirmInput,
      'reset-err-confirm',
      confirmInput.value === passInput?.value ? '' : 'Passwords do not match.'
    );
  });

  requestAnimationFrame(() => passInput?.focus());

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = passInput?.value || '';
    const confirmPassword = confirmInput?.value || '';
    let valid = true;

    if (password.length < 8 || password.length > 128) {
      setErr(passInput, 'reset-err-password', 'Password must be between 8 and 128 characters.');
      valid = false;
    } else {
      setErr(passInput, 'reset-err-password', '');
    }

    if (!confirmPassword || confirmPassword !== password) {
      setErr(confirmInput, 'reset-err-confirm', 'Passwords do not match.');
      valid = false;
    } else {
      setErr(confirmInput, 'reset-err-confirm', '');
    }

    if (!valid) return;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML =
        '<span class="inline-block w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin shrink-0" aria-hidden="true"></span><span>Resetting Password...</span>';
    }
    statusBox?.classList.add('hidden');

    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: { token, password, confirmPassword },
      });

      onResetSuccess?.();
      if (store.sessionToken) {
        setSessionToken(null);
        store.user = null;
        notifyStore();
      }

      showToast('Your password has been successfully reset!', 'success');

      renderShellCard(`
        <div class="text-center py-2">
          <div class="w-16 h-16 rounded-full bg-[#ECFDF5] border border-[#A7F3D0] text-[#059669] flex items-center justify-center mx-auto mb-4 shadow-sm">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
            </svg>
          </div>
          <h1 class="text-[24px] sm:text-[26px] font-extrabold text-[#0A1647] leading-tight">
            Your password has been successfully reset!
          </h1>
          <p class="text-[14px] text-[#3B5278] leading-relaxed mt-2.5">
            Your ScholarPress account is now secured with your new password.
          </p>
          <div class="mt-7">
            <a href="#/login" class="w-full h-12 rounded-2xl bg-gradient-to-r from-[#0F76FF] via-[#004AE2] to-[#002EC4] hover:from-[#0E69EB] hover:to-[#0026A8] text-white font-semibold text-[15px] inline-flex items-center justify-center shadow-[0_10px_24px_-6px_rgba(0,62,216,0.45)] transition-all">
              Go to Login
            </a>
          </div>
        </div>
      `);
    } catch (err) {
      const reason = err?.data?.reason;
      if (reason === 'expired' || reason === 'used') {
        renderInvalidState(
          reason === 'expired' ? 'Reset Link Expired' : 'Reset Link Already Used',
          err?.message || 'This password reset link is no longer valid. Please request a new reset link.'
        );
        return;
      }
      if (statusBox) {
        statusBox.className =
          'mb-4 rounded-xl px-4 py-3 text-[13px] leading-relaxed border bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]';
        statusBox.textContent = err?.message || 'Unable to reset password right now.';
      }
      showToast(err?.message || 'Unable to reset password.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = defaultBtnHtml;
      }
    }
  });
}

export function renderAuthPage(container, mode = 'login', options = {}) {
  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';
  const isReset = mode === 'reset';
  const isVerify = mode === 'verify';

  if (isSignup) {
    renderSignupPage(container);
    return;
  }

  if (isForgot) {
    renderForgotPasswordPage(container);
    return;
  }

  if (isReset) {
    const qs = window.location.hash.includes('?')
      ? new URLSearchParams(window.location.hash.split('?')[1])
      : new URLSearchParams();
    const prefillToken = options?.resetToken || qs.get('token') || '';
    renderResetPasswordPage(container, prefillToken);
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
    <div class="${isSignup ? 'max-w-2xl' : 'max-w-md'} mx-auto px-4 py-8 sm:py-12">
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-8">
        <h1 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-1.5">
          ${isSignup ? 'Create your ScholarPress account' : 'Sign in to ScholarPress'}
        </h1>
        <p class="text-sm text-slate-600 dark:text-slate-400 mb-6">
          ${
            isSignup
              ? 'Fill in your unique ID and profile details. You will automatically receive a unique 10-digit UID upon registration.'
              : 'Access your library, profile, creator studio, and payouts.'
          }
        </p>

        <div id="auth-restriction-banner" class="hidden mb-5"></div>

        <!-- Social Sign-In Buttons (Firebase Auth) -->
        <div class="space-y-2.5 mb-5">
          <button type="button" id="google-signin-btn" class="w-full py-2.5 px-4 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1120] hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-60 disabled:cursor-not-allowed text-slate-900 dark:text-white flex items-center justify-center gap-2.5 transition-colors whitespace-nowrap">
            ${SOCIAL_PROVIDER_ICONS.google}
            <span>Continue with Google</span>
          </button>
          <button type="button" id="facebook-signin-btn" class="w-full py-2.5 px-4 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1120] hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-60 disabled:cursor-not-allowed text-slate-900 dark:text-white flex items-center justify-center gap-2.5 transition-colors whitespace-nowrap">
            ${SOCIAL_PROVIDER_ICONS.facebook}
            <span>Continue with Facebook</span>
          </button>
          <button type="button" id="twitter-signin-btn" class="w-full py-2.5 px-4 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1120] hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-60 disabled:cursor-not-allowed text-slate-900 dark:text-white flex items-center justify-center gap-2.5 transition-colors whitespace-nowrap">
            ${SOCIAL_PROVIDER_ICONS.twitter}
            <span>Continue with Twitter</span>
          </button>
        </div>

        <div class="relative my-5">
          <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-slate-200 dark:border-slate-800"></div></div>
          <div class="relative flex justify-center text-xs"><span class="px-3 bg-white dark:bg-[#111A2E] text-slate-400">or continue with email</span></div>
        </div>

        <form id="auth-email-form" class="space-y-4">
          ${
            isSignup
              ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Full Name *</label>
                    <input name="name" required placeholder="e.g. Aarav Sharma" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Unique User ID (Unique Name) *</label>
                    <div class="relative">
                      <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-mono">@</span>
                      <input id="signup-username-input" name="username" required minlength="3" maxlength="30" placeholder="aarav_sharma" autocomplete="username" class="w-full pl-7 pr-3.5 py-2.5 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
                    </div>
                    <div id="signup-username-feedback" class="text-[11px] text-slate-500 mt-1">Only one user can hold each Unique ID.</div>
                  </div>
                </div>`
              : ''
          }
          <div class="${isSignup ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : 'space-y-4'}">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Email Address ${isSignup ? '*' : ''}</label>
              <input name="email" type="email" required placeholder="you@university.edu" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">Password ${isSignup ? '*' : ''}</label>
                ${!isSignup ? `<a href="#/forgot-password" class="text-xs text-[#1B3B6F] dark:text-sky-400 hover:underline">Forgot password?</a>` : ''}
              </div>
              <input name="password" type="password" minlength="8" required placeholder="Minimum 8 characters" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
          </div>
          ${
            isSignup
              ? `<div class="pt-4 mt-2 border-t border-slate-100 dark:border-slate-800 space-y-4">
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wider text-[#0F2547] dark:text-sky-400">Your Profile Details</div>
                    <p class="text-[11px] text-slate-500 mt-0.5">Shown on your profile page. A unique 10-digit UID will be generated automatically.</p>
                  </div>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">State *</label>
                      <input name="state" required placeholder="e.g. Bihar, Maharashtra, Delhi" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
                    </div>
                    <div>
                      <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Country *</label>
                      <input name="country" required value="India" placeholder="e.g. India" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
                    </div>
                  </div>
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Your Role / Profession *</label>
                      <select name="occupationRole" required class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                        <option value="">Select Role</option>
                        ${OCCUPATION_ROLES.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
                      </select>
                    </div>
                    <div>
                      <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Gender *</label>
                      <select name="gender" required class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                        <option value="">Select Gender</option>
                        ${GENDER_OPTIONS.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}
                      </select>
                    </div>
                    <div>
                      <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Date of Birth *</label>
                      <input name="dateOfBirth" type="date" required class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
                    </div>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Description / About You</label>
                    <textarea name="bio" rows="2" placeholder="Tell us briefly about your studies, profession, or interests..." class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]"></textarea>
                  </div>
                </div>
                <label class="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer pt-1">
                  <input type="checkbox" name="registerAsCreator" class="mt-0.5 rounded" />
                  <span>Also enable <strong>Creator / Publisher</strong> tools so I can upload notes, PDFs, articles, and lectures (I agree to the <a href="#/terms" class="underline">Creator Agreement</a>).</span>
                </label>`
              : ''
          }
          <button type="submit" class="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors">
            ${isSignup ? 'Create Account & Generate 10-Digit UID' : 'Sign In'}
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

  if (isSignup) {
    wireUsernameAvailabilityCheck(
      document.getElementById('signup-username-input'),
      document.getElementById('signup-username-feedback')
    );
  }

  const restrictionBanner = document.getElementById('auth-restriction-banner');
  if (!isSignup && restrictionBanner) {
    try {
      const savedNotice = sessionStorage.getItem('sp_last_block_notice');
      if (savedNotice) {
        sessionStorage.removeItem('sp_last_block_notice');
        renderAccountRestrictionBanner(restrictionBanner, JSON.parse(savedNotice));
      }
    } catch {}
  }

  const loginGoogleBtn = document.getElementById('google-signin-btn');
  const loginFacebookBtn = document.getElementById('facebook-signin-btn');
  const loginTwitterBtn = document.getElementById('twitter-signin-btn');
  const loginSocialBtns = [loginGoogleBtn, loginFacebookBtn, loginTwitterBtn];

  loginGoogleBtn?.addEventListener('click', () =>
    handleFirebaseSocialAuth({
      providerFn: signInWithGoogle,
      providerLabel: 'Google',
      buttonEl: loginGoogleBtn,
      allButtons: loginSocialBtns,
      restrictionBanner,
    })
  );
  loginFacebookBtn?.addEventListener('click', () =>
    handleFirebaseSocialAuth({
      providerFn: signInWithFacebook,
      providerLabel: 'Facebook',
      buttonEl: loginFacebookBtn,
      allButtons: loginSocialBtns,
      restrictionBanner,
    })
  );
  loginTwitterBtn?.addEventListener('click', () =>
    handleFirebaseSocialAuth({
      providerFn: signInWithTwitter,
      providerLabel: 'Twitter',
      buttonEl: loginTwitterBtn,
      allButtons: loginSocialBtns,
      restrictionBanner,
    })
  );

  document.getElementById('auth-email-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    restrictionBanner?.classList.add('hidden');
    const fd = new FormData(e.target);
    try {
      const endpoint = isSignup ? '/api/auth/register' : '/api/auth/login';
      const payload = isSignup
        ? {
            name: fd.get('name'),
            username: fd.get('username'),
            email: fd.get('email'),
            password: fd.get('password'),
            state: fd.get('state'),
            country: fd.get('country'),
            occupationRole: fd.get('occupationRole'),
            gender: fd.get('gender'),
            dateOfBirth: fd.get('dateOfBirth'),
            bio: fd.get('bio'),
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
      showToast(
        isSignup
          ? `Account created! Your 10-digit UID is ${res.user.publicUid}.`
          : `Welcome back, ${res.user.name}.`,
        'success'
      );

      const defaultDest =
        res.user.role === 'admin'
          ? '#/admin'
          : res.user.role === 'creator'
          ? '#/creator'
          : '#/dashboard/settings';
      const redirectTarget = consumePostLoginRedirect(null);
      if (redirectTarget) {
        window.location.hash = redirectTarget;
      } else {
        window.location.hash = defaultDest;
      }
    } catch (err) {
      if (err?.data?.accountBlocked || err?.data?.accountDeleted) {
        renderAccountRestrictionBanner(restrictionBanner, err.data);
      }
      showToast(err.message, 'error');
    }
  });
}

export function renderCompleteProfilePage(container) {
  if (!store.user) {
    window.location.hash = '#/login';
    return;
  }
  const u = store.user;
  const prof = u.profile || {};

  container.innerHTML = `
    <div class="max-w-2xl mx-auto px-4 py-8 sm:py-12">
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-8 space-y-6">
        <div>
          <h1 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">Complete Your Profile</h1>
          <p class="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Welcome, <strong>${esc(u.name)}</strong>! Choose your permanent Unique User ID and fill in your profile details below.
          </p>
        </div>

        <div class="p-4 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Your Auto-Assigned 10-Digit Unique UID</div>
            <div class="font-mono text-2xl font-bold text-[#0F2547] dark:text-sky-400 tracking-widest mt-0.5">${esc(u.publicUid || '—')}</div>
          </div>
          <button type="button" id="cp-copy-uid" class="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">
            Copy UID
          </button>
        </div>

        <form id="complete-profile-form" class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Full Name *</label>
              <input name="name" value="${esc(u.name)}" required class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Unique User ID (Unique Name) *</label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-mono">@</span>
                <input id="cp-username-input" name="username" value="${esc(u.username || '')}" required minlength="3" maxlength="30" placeholder="your_unique_id" class="w-full pl-7 pr-3.5 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <div id="cp-username-feedback" class="text-[11px] text-slate-500 mt-1">Only one user can hold each Unique ID.</div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">State *</label>
              <input name="state" value="${esc(prof.state || '')}" required placeholder="e.g. Bihar, Uttar Pradesh, Karnataka" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Country *</label>
              <input name="country" value="${esc(prof.country || 'India')}" required placeholder="e.g. India" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Role / Profession *</label>
              <select name="occupationRole" required class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                <option value="">Select Role</option>
                ${OCCUPATION_ROLES.map((r) => `<option value="${esc(r)}" ${prof.occupationRole === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Gender *</label>
              <select name="gender" required class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                <option value="">Select Gender</option>
                ${GENDER_OPTIONS.map((g) => `<option value="${esc(g)}" ${prof.gender === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Date of Birth *</label>
              <input name="dateOfBirth" type="date" value="${esc(prof.dateOfBirth || '')}" required class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Description / About Me</label>
            <textarea name="bio" rows="3" placeholder="Write a short bio about your education, goals, or profession..." class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">${esc(u.bio || '')}</textarea>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button type="submit" class="px-6 py-2.5 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 text-white dark:text-slate-950">
              Save Profile &amp; Continue
            </button>
            <a href="#/dashboard/settings" class="text-xs text-slate-500 hover:underline">Skip for now</a>
          </div>
        </form>
      </div>
    </div>
  `;

  wireUsernameAvailabilityCheck(
    document.getElementById('cp-username-input'),
    document.getElementById('cp-username-feedback')
  );

  document.getElementById('cp-copy-uid')?.addEventListener('click', () => {
    if (u.publicUid && navigator.clipboard) {
      navigator.clipboard.writeText(u.publicUid);
      showToast(`UID ${u.publicUid} copied!`, 'success');
    }
  });

  document.getElementById('complete-profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await apiFetch('/api/auth/profile', {
        method: 'PUT',
        body: Object.fromEntries(fd.entries()),
      });
      store.user = res.user;
      notifyStore();
      showToast('Profile completed successfully!', 'success');
      let target = null;
      try {
        target = sessionStorage.getItem('sp_post_login_redirect');
        if (target) sessionStorage.removeItem('sp_post_login_redirect');
      } catch {}
      if (target && target.startsWith('#/')) {
        window.location.hash = target;
      } else {
        window.location.hash = res.user.role === 'admin' ? '#/admin' : '#/dashboard/settings';
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
      const u = store.user;
      const prof = u.profile || {};
      tabBody = `
        <div class="max-w-3xl space-y-6">
          <div>
            <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">My Profile &amp; Account Identity</h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Your permanent 10-digit UID, unique handle, and personal details.</p>
          </div>

          <!-- Profile Identity Overview Card -->
          <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
            <div class="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div class="flex items-center gap-3.5">
                <div class="w-12 h-12 rounded-full bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950 font-display text-lg font-bold flex items-center justify-center shrink-0">
                  ${esc(u.name.slice(0, 1).toUpperCase())}
                </div>
                <div>
                  <div class="font-display text-xl font-semibold text-slate-900 dark:text-white">${esc(u.name)}</div>
                  <div class="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    ${u.username ? `@${esc(u.username)}` : '<span class="text-amber-600 dark:text-amber-400">Unique ID not set yet</span>'} · ${esc(u.email)}
                  </div>
                </div>
              </div>
              <div class="p-3 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                <div>
                  <div class="text-[10px] uppercase tracking-wider font-semibold text-slate-400">10-Digit Unique UID</div>
                  <div class="font-mono text-base font-bold text-[#0F2547] dark:text-sky-400 tracking-wider">${esc(u.publicUid || '—')}</div>
                </div>
                <button type="button" id="profile-copy-uid" class="px-2.5 py-1.5 text-[11px] font-semibold rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">Copy</button>
              </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <div class="text-slate-400">Role / Profession</div>
                <div class="font-semibold text-slate-900 dark:text-white mt-0.5">${esc(prof.occupationRole || 'Not specified')}</div>
              </div>
              <div>
                <div class="text-slate-400">State</div>
                <div class="font-semibold text-slate-900 dark:text-white mt-0.5">${esc(prof.state || 'Not specified')}</div>
              </div>
              <div>
                <div class="text-slate-400">Country</div>
                <div class="font-semibold text-slate-900 dark:text-white mt-0.5">${esc(prof.country || 'Not specified')}</div>
              </div>
              <div>
                <div class="text-slate-400">Gender</div>
                <div class="font-semibold text-slate-900 dark:text-white mt-0.5">${esc(prof.gender || 'Not specified')}</div>
              </div>
              <div>
                <div class="text-slate-400">Date of Birth</div>
                <div class="font-semibold text-slate-900 dark:text-white mt-0.5 font-mono">${esc(prof.dateOfBirth || 'Not specified')}</div>
              </div>
              <div>
                <div class="text-slate-400">Member Since</div>
                <div class="font-semibold text-slate-900 dark:text-white mt-0.5">${formatDate(u.createdAt)}</div>
              </div>
            </div>

            ${
              u.bio
                ? `<div class="pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                    <div class="text-slate-400 mb-1">Description</div>
                    <p class="text-slate-700 dark:text-slate-300 leading-relaxed">${esc(u.bio)}</p>
                  </div>`
                : ''
            }
          </div>

          <form id="user-profile-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
            <h3 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Edit Profile Details</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Full Name *</label>
                <input name="name" value="${esc(u.name)}" required class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Unique User ID (Unique Name) *</label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-mono">@</span>
                  <input id="settings-username-input" name="username" value="${esc(u.username || '')}" required minlength="3" maxlength="30" placeholder="your_unique_id" class="w-full pl-7 pr-3.5 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
                </div>
                <div id="settings-username-feedback" class="text-[11px] text-slate-500 mt-1">Each Unique ID can be held by only one user.</div>
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">State</label>
                <input name="state" value="${esc(prof.state || '')}" placeholder="e.g. Bihar, Maharashtra, Delhi" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Country</label>
                <input name="country" value="${esc(prof.country || 'India')}" placeholder="e.g. India" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Role / Profession</label>
                <select name="occupationRole" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                  <option value="">Select Role</option>
                  ${OCCUPATION_ROLES.map((r) => `<option value="${esc(r)}" ${prof.occupationRole === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Gender</label>
                <select name="gender" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                  <option value="">Select Gender</option>
                  ${GENDER_OPTIONS.map((g) => `<option value="${esc(g)}" ${prof.gender === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Date of Birth</label>
                <input name="dateOfBirth" type="date" value="${esc(prof.dateOfBirth || '')}" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
              </div>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Description / Bio</label>
              <textarea name="bio" rows="3" placeholder="Tell others about your academic background, profession, or goals..." class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">${esc(u.bio || '')}</textarea>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Institution / Organization</label>
                <input name="institution" value="${esc(prof.institution || '')}" placeholder="e.g. Delhi University / AIIMS / Company" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
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

          <form id="user-password-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
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

          <section id="sp-privacy-section" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 class="font-display text-lg font-semibold text-slate-900 dark:text-white">Search History &amp; Recommendations Privacy</h3>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Control whether your search activity is saved to personalize study suggestions and recommendations.</p>
              </div>
              <button type="button" id="sp-clear-search-history-btn" class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
                Clear Search History
              </button>
            </div>

            <label class="flex items-start gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120] cursor-pointer">
              <input type="checkbox" id="sp-personalization-toggle" ${prof.personalizationEnabled !== false ? 'checked' : ''} class="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-[#0F2547] focus:ring-[#0F2547]" />
              <span class="text-xs">
                <span class="block font-semibold text-slate-900 dark:text-white">Personalized Smart Search &amp; Recommendations</span>
                <span class="block text-slate-500 dark:text-slate-400 mt-0.5">Remember my recent searches and watch history to rank relevant chapters and lectures higher.</span>
              </span>
            </label>

            <div>
              <div class="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Recent Searches</div>
              <div id="sp-search-history-list" class="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/40 dark:bg-[#0B1120]">
                <div class="p-3 text-xs text-slate-500">Loading recent searches...</div>
              </div>
            </div>
          </section>
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
                  <div class="text-xs text-slate-500 truncate">${store.user.username ? `@${esc(store.user.username)}` : `${esc(store.user.role)} Account`}</div>
                  ${store.user.publicUid ? `<div class="text-[11px] font-mono text-slate-400 mt-0.5">UID: ${esc(store.user.publicUid)}</div>` : ''}
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

    wireUsernameAvailabilityCheck(
      document.getElementById('settings-username-input'),
      document.getElementById('settings-username-feedback')
    );

    document.getElementById('profile-copy-uid')?.addEventListener('click', () => {
      if (store.user?.publicUid && navigator.clipboard) {
        navigator.clipboard.writeText(store.user.publicUid);
        showToast(`UID ${store.user.publicUid} copied!`, 'success');
      }
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
        renderUserDashboardPage(container, activeTab);
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

    if (activeTab === 'settings') {
      const historyListEl = document.getElementById('sp-search-history-list');
      const persToggleEl = document.getElementById('sp-personalization-toggle');
      const clearHistBtn = document.getElementById('sp-clear-search-history-btn');

      const loadSearchHistoryPanel = async () => {
        if (!historyListEl) return;
        try {
          const histRes = await apiFetch('/api/search/history');
          if (persToggleEl && typeof histRes.personalizationEnabled === 'boolean') {
            persToggleEl.checked = histRes.personalizationEnabled;
          }
          const rows = histRes.history || [];
          if (!rows.length) {
            historyListEl.innerHTML = `<div class="p-3.5 text-xs text-slate-500 dark:text-slate-400">No saved searches yet.</div>`;
            return;
          }
          historyListEl.innerHTML = rows
            .map(
              (row) => `
            <div class="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
              <a href="#/explore?q=${encodeURIComponent(row.query)}" class="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-200 hover:text-[#0F2547] dark:hover:text-sky-400">
                ${esc(row.query)}
              </a>
              <span class="text-[11px] text-slate-400 whitespace-nowrap shrink-0 tabular-nums">${Number(row.resultsCount || 0)} results</span>
              <button type="button" data-del-search-id="${row.id}" aria-label="Delete search query" class="sp-del-search-entry text-slate-400 hover:text-red-600 dark:hover:text-red-400 font-semibold px-1.5 py-0.5 shrink-0">Remove</button>
            </div>`
            )
            .join('');

          historyListEl.querySelectorAll('.sp-del-search-entry').forEach((btn) => {
            btn.addEventListener('click', async () => {
              try {
                await apiFetch(`/api/search/history?id=${encodeURIComponent(btn.dataset.delSearchId)}`, {
                  method: 'DELETE',
                });
                loadSearchHistoryPanel();
              } catch (err) {
                showToast(err.message, 'error');
              }
            });
          });
        } catch {
          if (historyListEl) {
            historyListEl.innerHTML = `<div class="p-3.5 text-xs text-slate-500">Unable to load search history right now.</div>`;
          }
        }
      };

      persToggleEl?.addEventListener('change', async () => {
        const enabled = Boolean(persToggleEl.checked);
        try {
          const res = await apiFetch('/api/search/preferences', {
            method: 'PATCH',
            body: { personalizationEnabled: enabled },
          });
          if (store.user) {
            store.user.profile = { ...(store.user.profile || {}), personalizationEnabled: enabled };
          }
          showToast(res.message, 'success');
        } catch (err) {
          persToggleEl.checked = !enabled;
          showToast(err.message, 'error');
        }
      });

      clearHistBtn?.addEventListener('click', async () => {
        try {
          const res = await apiFetch('/api/search/history', { method: 'DELETE' });
          showToast(res.message || 'Search history cleared.', 'success');
          loadSearchHistoryPanel();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });

      loadSearchHistoryPanel();
    }
  } catch (err) {
    container.innerHTML = `<div class="max-w-3xl mx-auto p-12 text-red-600">${esc(err.message)}</div>`;
  }
}
