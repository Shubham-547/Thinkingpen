import { apiFetch, store } from './api.js';

let trackerStarted = false;
let currentPath = '/';
let currentTitle = 'ScholarPress';
let currentContentId = null;
let activeSessionId = null;
let lastTickMs = Date.now();
let inFlight = false;

function isTrackableUser() {
  return Boolean(store.user && !store.user.isSuperAdmin);
}

async function sendHeartbeat({ isNewPage = false, forceZeroDelta = false } = {}) {
  if (!isTrackableUser()) return;
  if (inFlight && !isNewPage) return;

  const now = Date.now();
  let deltaSeconds = forceZeroDelta ? 0 : Math.round((now - lastTickMs) / 1000);
  if (deltaSeconds < 0) deltaSeconds = 0;
  if (deltaSeconds > 60) deltaSeconds = 60;
  lastTickMs = now;

  if (!isNewPage && deltaSeconds === 0 && activeSessionId) return;

  inFlight = true;
  try {
    const res = await apiFetch('/api/auth/activity/heartbeat', {
      method: 'POST',
      body: {
        sessionId: isNewPage ? null : activeSessionId,
        pagePath: currentPath,
        pageTitle: currentTitle,
        contentId: currentContentId,
        deltaSeconds,
        isNewPage,
      },
    });
    if (res && res.sessionId) {
      activeSessionId = res.sessionId;
    }
  } catch {
    // Ignore transient network errors during background heartbeat
  } finally {
    inFlight = false;
  }
}

export function notifyRouteChange(path, title) {
  // Flush elapsed seconds on previous page before switching
  if (isTrackableUser() && activeSessionId) {
    sendHeartbeat({ isNewPage: false });
  }
  currentPath = path || '/';
  currentTitle = title || path || 'ScholarPress';
  currentContentId = null;
  activeSessionId = null;
  lastTickMs = Date.now();

  if (isTrackableUser()) {
    sendHeartbeat({ isNewPage: true, forceZeroDelta: true });
  }
}

export function setTrackedContent(contentId, title) {
  if (!contentId) return;
  currentContentId = Number(contentId);
  if (title) currentTitle = title;
  activeSessionId = null;
  lastTickMs = Date.now();
  if (isTrackableUser()) {
    sendHeartbeat({ isNewPage: true, forceZeroDelta: true });
  }
}

export function clearTrackedContent() {
  if (currentContentId !== null && isTrackableUser() && activeSessionId) {
    sendHeartbeat({ isNewPage: false });
  }
  currentContentId = null;
}

export function startActivityTracker() {
  if (trackerStarted) return;
  trackerStarted = true;
  lastTickMs = Date.now();

  window.setInterval(() => {
    if (document.visibilityState === 'visible' && isTrackableUser()) {
      sendHeartbeat({ isNewPage: false });
    } else {
      lastTickMs = Date.now();
    }
  }, 10_000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (isTrackableUser()) sendHeartbeat({ isNewPage: false });
    } else {
      lastTickMs = Date.now();
    }
  });

  window.addEventListener('pagehide', () => {
    if (isTrackableUser()) sendHeartbeat({ isNewPage: false });
  });
}
