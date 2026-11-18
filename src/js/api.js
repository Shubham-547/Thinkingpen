import { getActiveFirebaseIdToken, signOutFirebase } from './firebase.js';

export const CONTENT_TYPES = [
  'Notes',
  'PDF / Documents',
  'Articles',
  'E-books',
  'Video Lectures',
  'Online Tutorials',
  'Poems',
  'Stories',
  'Research Papers',
  'Other Educational Content',
];

export const LANGUAGES = ['English', 'Hindi', 'Bengali', 'Marathi', 'Tamil', 'Telugu', 'Kannada', 'Gujarati', 'Urdu', 'Bilingual'];

export const PRESET_COVERS = [
  { label: 'Computer Science Monograph', url: '/src/assets/images/cover_computer_science_1794993004538.jpg' },
  { label: 'Mathematics & Geometry', url: '/src/assets/images/cover_mathematics_1794993003788.jpg' },
  { label: 'Physics & Natural Sciences', url: '/src/assets/images/cover_science_physics_1794993004178.jpg' },
  { label: 'Literature, Poetry & Essays', url: '/src/assets/images/cover_literature_poetry_1794993004790.jpg' },
];

export const HERO_LIBRARY_IMAGE = '/src/assets/images/hero_scholar_library_1794993004508.jpg';

// In-memory state (Firebase ID tokens are NEVER stored in localStorage)
export const store = {
  user: null,
  sessionToken: null, // In-memory token for email/password login
  categories: [],
  subjects: [],
  settings: {},
  paymentConfig: { provider: 'razorpay', mode: 'sandbox', keyId: null, currency: 'INR' },
  authReady: false,
  listeners: new Set(),
};

export function subscribeStore(fn) {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}

export function notifyStore() {
  store.listeners.forEach((fn) => fn(store));
}

export function setSessionToken(token) {
  store.sessionToken = token || null;
  try {
    if (token) sessionStorage.setItem('sp_session_token', token);
    else sessionStorage.removeItem('sp_session_token');
  } catch {}
}

export function loadStoredSessionToken() {
  try {
    const saved = sessionStorage.getItem('sp_session_token');
    if (saved) store.sessionToken = saved;
  } catch {}
}

export async function getAuthToken() {
  if (store.sessionToken) return store.sessionToken;
  return await getActiveFirebaseIdToken();
}

export async function logoutAll() {
  setSessionToken(null);
  await signOutFirebase();
  store.user = null;
  notifyStore();
}

export async function apiFetch(url, options = {}) {
  const token = await getAuthToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const isFormData = options.body instanceof FormData;
  if (!isFormData && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    body: !isFormData && options.body && typeof options.body !== 'string'
      ? JSON.stringify(options.body)
      : options.body,
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function refreshCurrentUser() {
  try {
    const token = await getAuthToken();
    if (!token) {
      store.user = null;
      notifyStore();
      return null;
    }
    const data = await apiFetch('/api/auth/me');
    store.user = data.user || null;
    notifyStore();
    return store.user;
  } catch {
    store.user = null;
    setSessionToken(null);
    notifyStore();
    return null;
  }
}

export async function loadGlobalCatalogMeta() {
  try {
    const [catData, payCfg] = await Promise.all([
      apiFetch('/api/catalog/categories'),
      apiFetch('/api/payments/config'),
    ]);
    store.categories = catData.categories || [];
    store.subjects = catData.subjects || [];
    store.paymentConfig = payCfg || store.paymentConfig;
  } catch (err) {
    console.warn('Could not load global catalog metadata:', err);
  }
}

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatInr(amount) {
  const num = Number(amount || 0);
  return `₹${num.toLocaleString('en-IN', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatBytes(bytes) {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function showToast(message, type = 'info') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  const tone =
    type === 'error'
      ? 'bg-red-950 text-red-50 border-red-800'
      : type === 'success'
      ? 'bg-emerald-950 text-emerald-50 border-emerald-800'
      : 'bg-[#0F2547] text-white border-slate-700';

  el.className = `pointer-events-auto px-4 py-3 rounded-lg border shadow-lg text-sm font-medium transition-all duration-200 ${tone}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 220);
  }, 3600);
}

export function openModal({ title, bodyHtml, widthClass = 'max-w-xl', onMount }) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = `
    <div id="sp-modal-backdrop" role="dialog" aria-modal="true" class="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div class="bg-white dark:bg-[#111A2E] border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-xl w-full ${widthClass} shadow-2xl overflow-hidden sm:my-8 max-h-[92vh] flex flex-col">
        <div class="flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <h3 class="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">${esc(title)}</h3>
          <button type="button" id="sp-modal-close" aria-label="Close dialog" class="p-2 rounded-md text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div id="sp-modal-body" class="p-4 sm:p-6 overflow-y-auto flex-1">${bodyHtml}</div>
      </div>
    </div>
  `;
  const onKeyDown = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    root.innerHTML = '';
  };
  document.addEventListener('keydown', onKeyDown);
  document.getElementById('sp-modal-close')?.addEventListener('click', close);
  document.getElementById('sp-modal-backdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'sp-modal-backdrop') close();
  });
  if (onMount) onMount(close, document.getElementById('sp-modal-body'));
  return close;
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

export function renderCoverImage(url, title, aspectClass = 'aspect-[4/3]') {
  const fallbackBg = 'bg-gradient-to-br from-[#0F2547] via-[#1B3B6F] to-[#1E293B]';
  if (!url) {
    return `
      <div class="${aspectClass} ${fallbackBg} w-full flex flex-col justify-between p-5 text-white">
        <span class="text-xs tracking-wide text-slate-300">ScholarPress Edition</span>
        <span class="font-display text-base font-semibold leading-snug line-clamp-3">${esc(title)}</span>
      </div>
    `;
  }
  return `
    <div class="${aspectClass} w-full overflow-hidden bg-slate-100 dark:bg-slate-900 relative">
      <img
        src="${esc(url)}"
        alt="${esc(title)}"
        referrerpolicy="no-referrer"
        loading="lazy"
        class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />
      <div style="display:none" class="absolute inset-0 ${fallbackBg} p-5 flex-col justify-between text-white">
        <span class="text-xs text-slate-300">ScholarPress Edition</span>
        <span class="font-display text-base font-semibold leading-snug">${esc(title)}</span>
      </div>
    </div>
  `;
}

/**
 * Renders a clean, editorial publication card following strict zero-pill metadata rules.
 */
export function renderContentCard(item) {
  const priceLabel = item.isFree || Number(item.priceInr) <= 0
    ? `<span class="font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400">Free</span>`
    : `<span class="font-mono text-sm font-semibold text-[#0F2547] dark:text-sky-300">${formatInr(item.priceInr)}</span>`;

  const ratingText =
    Number(item.avgRating || 0) > 0
      ? `<span>★ ${Number(item.avgRating).toFixed(1)}</span>`
      : `<span>New</span>`;

  return `
    <article class="group bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col transition-colors hover:border-slate-300 dark:hover:border-slate-700">
      <a href="#/content/${esc(item.slug)}" class="block overflow-hidden">
        ${renderCoverImage(item.coverImageUrl, item.title)}
      </a>
      <div class="p-5 flex-1 flex flex-col">
        <div class="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 mb-2">
          <span>${esc(item.categoryName || 'General')}</span>
          <span aria-hidden="true">·</span>
          <span>${esc(item.contentType)}</span>
          <span aria-hidden="true">·</span>
          <span>${esc(item.language || 'English')}</span>
        </div>
        <a href="#/content/${esc(item.slug)}" class="font-display text-lg font-semibold text-slate-900 dark:text-slate-100 leading-snug hover:text-[#1B3B6F] dark:hover:text-sky-300 transition-colors line-clamp-2 mb-2">
          ${esc(item.title)}
        </a>
        <p class="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mb-4 flex-1">
          ${esc(item.shortDescription)}
        </p>
        <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 text-xs">
          <div class="min-w-0 truncate text-slate-600 dark:text-slate-400">
            <a href="#/creator-profile/${esc(item.creatorId)}" class="hover:text-slate-900 dark:hover:text-white font-medium">${esc(item.creatorName)}</a>
            <span class="mx-1.5 text-slate-300 dark:text-slate-700">·</span>
            <span class="tabular-nums">${ratingText}</span>
          </div>
          <div class="shrink-0">${priceLabel}</div>
        </div>
      </div>
    </article>
  `;
}

export function renderStatusLabel(status) {
  const map = {
    approved: 'text-emerald-700 dark:text-emerald-400',
    active: 'text-emerald-700 dark:text-emerald-400',
    captured: 'text-emerald-700 dark:text-emerald-400',
    paid: 'text-emerald-700 dark:text-emerald-400',
    completed: 'text-emerald-700 dark:text-emerald-400',
    credited: 'text-emerald-700 dark:text-emerald-400',
    resolved: 'text-emerald-700 dark:text-emerald-400',
    pending: 'text-amber-700 dark:text-amber-400',
    reviewing: 'text-amber-700 dark:text-amber-400',
    open: 'text-amber-700 dark:text-amber-400',
    created: 'text-amber-700 dark:text-amber-400',
    draft: 'text-slate-500 dark:text-slate-400',
    dismissed: 'text-slate-500 dark:text-slate-400',
    rejected: 'text-red-700 dark:text-red-400',
    removed: 'text-red-700 dark:text-red-400',
    failed: 'text-red-700 dark:text-red-400',
    refunded: 'text-red-700 dark:text-red-400',
    reversed: 'text-red-700 dark:text-red-400',
    suspended: 'text-amber-700 dark:text-amber-400',
    blocked: 'text-red-700 dark:text-red-400',
  };
  const cls = map[status] || 'text-slate-600 dark:text-slate-300';
  const label = String(status || '').replace(/_/g, ' ');
  return `<span class="text-xs font-semibold capitalize ${cls}">${esc(label)}</span>`;
}
