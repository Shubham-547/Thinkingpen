import { getActiveFirebaseIdToken, signOutFirebase } from './firebase.js';

export async function openImageLightbox(opts) {
  const mod = await import('./image-viewer.js');
  return mod.openImageLightbox(opts);
}

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
export const HOME_HERO_BANNER = '/assets/aistudio/file_00000000e70c82119d34732233aebda4_28236e72.png';

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
  clientGetCache.clear();
  notifyStore();
}

// Fast in-memory client GET cache for instant repeat navigation (auto-invalidated on mutations)
const clientGetCache = new Map();
const inflightGetRequests = new Map();
const HOME_SNAP_KEY = 'sp_home_snap_v2';

export function getCachedHomeSnapshot() {
  try {
    const raw = sessionStorage.getItem(HOME_SNAP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data || parsed.expiresAt <= Date.now()) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function saveHomeSnapshot(data) {
  try {
    sessionStorage.setItem(HOME_SNAP_KEY, JSON.stringify({ data, expiresAt: Date.now() + 120_000 }));
  } catch {}
}

function getClientCacheTtlMs(url) {
  if (url === '/api/catalog/home') return 35_000;
  if (url === '/api/catalog/categories' || url === '/api/payments/config') return 90_000;
  if (url.startsWith('/api/catalog/contents?')) return 20_000;
  if (url === '/api/catalog/creators') return 45_000;
  return 0;
}

export function invalidateClientCache() {
  clientGetCache.clear();
  try {
    sessionStorage.removeItem(HOME_SNAP_KEY);
  } catch {}
}

export async function apiFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const ttlMs = method === 'GET' && !options.noCache ? getClientCacheTtlMs(url) : 0;

  if (ttlMs > 0) {
    const cached = clientGetCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    if (inflightGetRequests.has(url)) {
      return inflightGetRequests.get(url);
    }
  }

  const runFetch = async () => {
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
      body:
        !isFormData && options.body && typeof options.body !== 'string'
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

    if (ttlMs > 0) {
      clientGetCache.set(url, { data, expiresAt: Date.now() + ttlMs });
    } else if (method !== 'GET' && !url.startsWith('/api/auth/activity/')) {
      clientGetCache.clear();
    }
    return data;
  };

  if (ttlMs > 0) {
    const promise = runFetch().finally(() => inflightGetRequests.delete(url));
    inflightGetRequests.set(url, promise);
    return promise;
  }
  return runFetch();
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

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeAge(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.max(0, Math.floor(diffMs / 60_000));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return `Just now · ${timeStr}`;
  if (diffMins < 60) return `${diffMins} min ago · ${timeStr}`;
  if (diffHours < 24) return `${diffHours} hr ago · ${timeStr}`;
  if (diffDays === 1) return `1 day ago · ${timeStr}`;
  return `${diffDays} days ago · ${timeStr}`;
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

/**
 * Resolves responsive AVIF/WebP thumbnail sources for static assets and uploaded `/api/catalog/files/:id` media.
 * Feed cards download compact 480w WebP/AVIF previews (~8–35 KB); full-resolution loads only in the Full-Screen Viewer.
 */
export function getResponsiveImageSources(url, preferredWidth = 480) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return { fallbackSrc: trimmed, fullSrc: trimmed, avifSrcSet: '', webpSrcSet: '' };
  }

  // 1) Local preset covers under /src/assets/images/*.jpg (pre-generated 480w & 960w AVIF/WebP)
  const srcMatch = trimmed.match(/^(\/src\/assets\/images\/.+)\.(jpe?g|png)$/i);
  if (srcMatch) {
    const stem = srcMatch[1];
    const w = preferredWidth > 640 ? 960 : 480;
    return {
      avifSrcSet: `${stem}-480w.avif 480w, ${stem}-960w.avif 960w`,
      webpSrcSet: `${stem}-480w.webp 480w, ${stem}-960w.webp 960w`,
      fallbackSrc: `${stem}-${w}w.webp`,
      fullSrc: `${stem}.webp`,
    };
  }

  // 2) Public hero/artwork assets under /assets/aistudio/*.png (pre-generated 768w & 1280w AVIF/WebP)
  const pubMatch = trimmed.match(/^(\/assets\/aistudio\/.+)\.(png|jpe?g)$/i);
  if (pubMatch) {
    const stem = pubMatch[1];
    const w = preferredWidth > 800 ? 1280 : 768;
    return {
      avifSrcSet: `${stem}-768w.avif 768w, ${stem}-1280w.avif 1280w`,
      webpSrcSet: `${stem}-768w.webp 768w, ${stem}-1280w.webp 1280w`,
      fallbackSrc: `${stem}-${w}w.webp`,
      fullSrc: trimmed,
    };
  }

  // 3) Dynamic uploaded files served by /api/catalog/files/:id (on-the-fly cached sharp WebP/AVIF variants)
  if (/^\/api\/catalog\/files\/\d+/i.test(trimmed)) {
    const sep = trimmed.includes('?') ? '&' : '?';
    const wSmall = Math.min(480, preferredWidth);
    const wMed = Math.max(768, preferredWidth);
    return {
      avifSrcSet: `${trimmed}${sep}w=${wSmall}&fmt=avif ${wSmall}w, ${trimmed}${sep}w=${wMed}&fmt=avif ${wMed}w`,
      webpSrcSet: `${trimmed}${sep}w=${wSmall}&fmt=webp ${wSmall}w, ${trimmed}${sep}w=${wMed}&fmt=webp ${wMed}w`,
      fallbackSrc: `${trimmed}${sep}w=${preferredWidth}&fmt=webp`,
      fullSrc: trimmed,
    };
  }

  return { fallbackSrc: trimmed, fullSrc: trimmed, avifSrcSet: '', webpSrcSet: '' };
}

export function renderCoverImage(urlOrItem, titleArg, aspectClass = 'aspect-[4/3]', opts = {}) {
  const isObj = urlOrItem && typeof urlOrItem === 'object';
  const url = isObj ? urlOrItem.coverImageUrl || urlOrItem.coverUrl : urlOrItem;
  const title = isObj ? urlOrItem.title : titleArg;
  const finalAspect = isObj && typeof titleArg === 'string' ? titleArg : aspectClass;
  const thumbWidth = opts.width || 480;
  const sizes = opts.sizes || '(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 380px';
  const fetchPriorityAttr = opts.priority ? 'fetchpriority="high"' : 'loading="lazy"';

  const fallbackBg = 'bg-gradient-to-br from-[#23196e] via-[#4125b8] to-[#1e1b4b]';
  if (!url) {
    return `
      <div class="${finalAspect} ${fallbackBg} w-full flex flex-col justify-between p-4 text-white">
        <span class="text-[11px] tracking-wide text-indigo-200">ScholarPress</span>
        <span class="font-display text-sm sm:text-base font-semibold leading-snug line-clamp-3">${esc(title)}</span>
      </div>
    `;
  }

  const sources = getResponsiveImageSources(url, thumbWidth);
  const imgSrc = sources?.fallbackSrc || url;
  const fullSrc = sources?.fullSrc || url;

  return `
    <div class="${finalAspect} w-full overflow-hidden bg-slate-100 dark:bg-slate-900 relative">
      <picture class="block w-full h-full">
        ${sources?.avifSrcSet ? `<source type="image/avif" srcset="${esc(sources.avifSrcSet)}" sizes="${esc(sizes)}" />` : ''}
        ${sources?.webpSrcSet ? `<source type="image/webp" srcset="${esc(sources.webpSrcSet)}" sizes="${esc(sizes)}" />` : ''}
        <img
          src="${esc(imgSrc)}"
          data-full-src="${esc(fullSrc)}"
          alt="${esc(title)}"
          data-zoom-title="${esc(title)}"
          referrerpolicy="no-referrer"
          ${fetchPriorityAttr}
          decoding="async"
          class="sp-zoom-img cursor-zoom-in w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          onerror="if(!this.dataset.retried && this.dataset.fullSrc && this.src !== this.dataset.fullSrc){this.dataset.retried='1';this.src=this.dataset.fullSrc;return;}this.closest('picture').style.display='none';this.closest('picture').nextElementSibling.style.display='flex';"
        />
      </picture>
      <div style="display:none" class="absolute inset-0 ${fallbackBg} p-4 flex-col justify-between text-white">
        <span class="text-[11px] text-indigo-200">ScholarPress</span>
        <span class="font-display text-sm sm:text-base font-semibold leading-snug line-clamp-3">${esc(title)}</span>
      </div>
    </div>
  `;
}

async function computeClientSha256(file) {
  try {
    if (!window.crypto?.subtle || file.size > 35 * 1024 * 1024) return '';
    const buf = await file.arrayBuffer();
    const hashBuf = await window.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}

function xhrSend({ method, url, body, headers = {}, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(ev.loaded, ev.total);
      }
    };
    xhr.onload = () => {
      const text = xhr.responseText || '';
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        const err = new Error(data.error || `Upload failed (${xhr.status})`);
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error('Network error during file upload.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out.'));
    xhr.timeout = 120_000;
    xhr.send(body);
  });
}

async function withUploadRetry(fn, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      // Do not retry 4xx validation or permission errors
      if (err?.status && err.status >= 400 && err.status < 500) {
        throw err;
      }
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

/**
 * Resilient file uploader supporting:
 * 1) SHA-256 duplicate upload prevention
 * 2) Direct-to-S3/R2/GCS presigned PUT uploads when object storage is configured
 * 3) Resumable 2 MB chunked uploads for large files (> 4 MB) on local/persistent storage
 * 4) Real-time % progress tracking + automatic exponential-backoff retry
 */
export async function uploadFileResilient({
  contentId,
  file,
  isPreview = false,
  setAsCover = false,
  onProgress,
}) {
  const token = await getAuthToken();
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  const sha256Hash = await computeClientSha256(file);

  // Initialize upload (checks duplicate hash + determines direct presigned S3 vs chunked local)
  const init = await apiFetch('/api/creator/uploads/presign', {
    method: 'POST',
    body: {
      contentId,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      sha256Hash,
      setAsCover,
    },
  });

  if (init.mode === 'duplicate') {
    onProgress?.(100);
    return init;
  }

  // Path A: Direct-to-Object-Storage Presigned PUT (bypasses application server bandwidth)
  if (init.mode === 'presigned' && init.uploadUrl) {
    await withUploadRetry(() =>
      xhrSend({
        method: 'PUT',
        url: init.uploadUrl,
        body: file,
        headers: { 'Content-Type': init.contentType || file.type },
        onProgress: (loaded, total) => {
          onProgress?.(Math.min(96, Math.round((loaded / Math.max(1, total)) * 96)));
        },
      })
    );
    const completed = await apiFetch('/api/creator/uploads/complete', {
      method: 'POST',
      body: {
        contentId,
        objectKey: init.objectKey,
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        sha256Hash,
        isPreview,
        setAsCover,
      },
    });
    onProgress?.(100);
    return completed;
  }

  // Path B: Resumable Chunked Upload for large files (> 4 MB) so flaky mobile connections auto-retry individual chunks
  const chunkSize = init.chunkSizeBytes || 2 * 1024 * 1024;
  if (file.size > 4 * 1024 * 1024) {
    const totalChunks = Math.ceil(file.size / chunkSize);
    for (let idx = 0; idx < totalChunks; idx += 1) {
      const start = idx * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const blob = file.slice(start, end);
      await withUploadRetry(() => {
        const fd = new FormData();
        fd.append('uploadId', init.uploadId);
        fd.append('chunkIndex', String(idx));
        fd.append('chunk', blob, `chunk-${idx}.part`);
        return xhrSend({
          method: 'POST',
          url: '/api/creator/uploads/chunk',
          body: fd,
          headers: authHeaders,
          onProgress: (loaded) => {
            const overall = Math.min(95, Math.round(((start + loaded) / Math.max(1, file.size)) * 95));
            onProgress?.(overall);
          },
        });
      });
    }
    const assembled = await apiFetch('/api/creator/uploads/chunk/complete', {
      method: 'POST',
      body: {
        contentId,
        uploadId: init.uploadId,
        totalChunks,
        originalName: file.name,
        mimeType: file.type,
        isPreview,
        setAsCover,
      },
    });
    onProgress?.(100);
    return assembled;
  }

  // Path C: Single-request XHR upload with real-time progress + automatic retry for smaller files
  const res = await withUploadRetry(() => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('isPreview', isPreview ? 'true' : 'false');
    if (setAsCover) fd.append('setAsCover', 'true');
    return xhrSend({
      method: 'POST',
      url: `/api/creator/contents/${contentId}/files`,
      body: fd,
      headers: authHeaders,
      onProgress: (loaded, total) => {
        onProgress?.(Math.min(99, Math.round((loaded / Math.max(1, total)) * 99)));
      },
    });
  });
  onProgress?.(100);
  return res;
}

export function formatDurationShort(seconds) {
  const s = Number(seconds || 0);
  if (!Number.isFinite(s) || s <= 0) return '';
  const mins = Math.max(1, Math.round(s / 60));
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  }
  return `${mins} min`;
}

/**
 * Renders a clean, editorial publication card following strict zero-pill metadata rules.
 */
export function renderContentCard(item) {
  const isUnlockedForUser =
    Boolean(item.hasPurchased) ||
    (Array.isArray(store.user?.purchasedContentIds) &&
      store.user.purchasedContentIds.includes(Number(item.id)));
  const priceLabel =
    item.isFree || Number(item.priceInr) <= 0
      ? `<span class="font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400">Free</span>`
      : isUnlockedForUser
      ? `<span class="inline-flex items-center gap-1 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">Unlocked · Free</span>`
      : `<span class="font-mono text-sm font-semibold text-[#0F2547] dark:text-sky-300">${formatInr(item.priceInr)}</span>`;

  const ratingText =
    Number(item.avgRating || 0) > 0
      ? `<span>★ ${Number(item.avgRating).toFixed(1)}</span>`
      : `<span>New</span>`;

  const durationText = formatDurationShort(item.durationSeconds);
  const progressPct = Number(item.watchProgress?.progressPercent || 0);
  const metaParts = [
    item.classLevel,
    item.subjectName || item.categoryName || 'General',
    item.contentType,
    item.studyLabel,
    durationText,
  ].filter(Boolean);

  return `
    <article data-content-id="${esc(item.id)}" style="content-visibility:auto;contain-intrinsic-size:0 370px;" class="group bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col transition-colors hover:border-slate-300 dark:hover:border-slate-700">
      <a href="#/content/${esc(item.slug)}" class="block relative overflow-hidden">
        ${renderCoverImage(item.coverImageUrl, item.title)}
        ${
          progressPct > 0
            ? `<div class="absolute inset-x-0 bottom-0 h-1 bg-slate-900/35">
                 <div class="h-full bg-[#5a1fd8] dark:bg-sky-400" style="width:${Math.min(100, progressPct)}%"></div>
               </div>`
            : ''
        }
      </a>
      <div class="p-5 flex-1 flex flex-col">
        <div class="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 mb-2">
          ${metaParts.map((m) => `<span>${esc(m)}</span>`).join('<span aria-hidden="true">·</span>')}
        </div>
        <a href="#/content/${esc(item.slug)}" class="font-display text-lg font-semibold text-slate-900 dark:text-slate-100 leading-snug hover:text-[#1B3B6F] dark:hover:text-sky-300 transition-colors line-clamp-2 mb-2">
          ${esc(item.title)}
        </a>
        <p class="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mb-4 flex-1">
          ${esc(item.shortDescription)}
        </p>
        ${
          progressPct > 0
            ? `<div class="text-[11px] font-medium text-[#5a1fd8] dark:text-sky-400 mb-2 tabular-nums">${
                item.watchProgress?.completed ? 'Completed' : `Resume · ${progressPct}% watched`
              }</div>`
            : ''
        }
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
    deleted: 'text-red-700 dark:text-red-400',
    recovered: 'text-emerald-700 dark:text-emerald-400',
  };
  const cls = map[status] || 'text-slate-600 dark:text-slate-300';
  const label = String(status || '').replace(/_/g, ' ');
  return `<span class="text-xs font-semibold capitalize ${cls}">${esc(label)}</span>`;
}

function parseStartSeconds(raw) {
  if (!raw) return 0;
  const s = String(raw).trim().toLowerCase();
  if (/^\d+$/.test(s)) return Math.min(86400, Number(s));
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!m) return 0;
  return Math.min(86400, Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0));
}

export function resolveVideoEmbed(raw) {
  let text = String(raw || '').trim();
  if (!text) return null;

  const iframeMatch = text.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframeMatch?.[1]) {
    text = iframeMatch[1].trim();
  } else {
    const urlMatch = text.match(/https?:\/\/[^\s<>"']+/i);
    if (urlMatch?.[0]) {
      text = urlMatch[0].trim();
    } else if (/^(?:www\.)?(?:youtu\.be|youtube\.com|m\.youtube\.com|vimeo\.com|player\.vimeo\.com|drive\.google\.com)\//i.test(text)) {
      text = `https://${text}`;
    }
  }
  text = text.replace(/[),.;]+$/, '');

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const parts = parsed.pathname.split('/').filter(Boolean);

  if (
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com'
  ) {
    let videoId = null;
    if (host === 'youtu.be' && parts[0]) {
      videoId = parts[0];
    } else if (parsed.pathname === '/watch' || parsed.pathname === '/watch/') {
      videoId = parsed.searchParams.get('v');
    } else if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0].toLowerCase())) {
      videoId = parts[1];
    }
    if (videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
      const startSec = parseStartSeconds(parsed.searchParams.get('start') || parsed.searchParams.get('t'));
      const embed = new URL(`https://www.youtube.com/embed/${videoId}`);
      embed.searchParams.set('rel', '0');
      embed.searchParams.set('enablejsapi', '1');
      if (startSec > 0) embed.searchParams.set('start', String(startSec));
      return {
        embedUrl: embed.toString(),
        watchUrl: `https://www.youtube.com/watch?v=${videoId}${startSec > 0 ? `&t=${startSec}s` : ''}`,
        provider: 'YouTube',
        videoId,
      };
    }
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const idMatch = parsed.pathname.match(/\/(?:video\/)?(\d{5,15})/);
    if (idMatch?.[1]) {
      return {
        embedUrl: `https://player.vimeo.com/video/${idMatch[1]}`,
        watchUrl: `https://vimeo.com/${idMatch[1]}`,
        provider: 'Vimeo',
        videoId: idMatch[1],
      };
    }
  }

  if (host === 'drive.google.com') {
    const fileMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    const driveId = fileMatch?.[1] || parsed.searchParams.get('id');
    if (driveId) {
      return {
        embedUrl: `https://drive.google.com/file/d/${driveId}/preview`,
        watchUrl: `https://drive.google.com/file/d/${driveId}/view`,
        provider: 'Google Drive',
        videoId: driveId,
      };
    }
  }

  return {
    embedUrl: parsed.toString(),
    watchUrl: parsed.toString(),
    provider: 'Video Stream',
    videoId: null,
  };
}
