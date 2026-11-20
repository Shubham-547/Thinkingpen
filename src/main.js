import './index.css';
import {
  apiFetch,
  esc,
  loadGlobalCatalogMeta,
  loadStoredSessionToken,
  logoutAll,
  notifyStore,
  openImageLightbox,
  refreshCurrentUser,
  showToast,
  store,
  subscribeStore,
} from './js/api.js';
import { signOutFirebase, subscribeFirebaseAuth } from './js/firebase.js';
import {
  renderCategoriesPage,
  renderCreatorPublicProfilePage,
  renderCreatorsDirectoryPage,
  renderExplorePage,
  renderHomePage,
  renderStaticPage,
} from './js/pages-public.js';
import { cleanupReaderProgress, renderContentDetailPage } from './js/pages-reader.js';
import {
  renderAuthPage,
  renderBecomeCreatorPage,
  renderCompleteProfilePage,
  renderUserDashboardPage,
} from './js/pages-auth-user.js';
import { renderCreatorDashboardPage } from './js/pages-creator.js';
import { renderAdminDashboardPage } from './js/pages-admin.js';
import { notifyRouteChange, startActivityTracker } from './js/tracker.js';

function getRoutePath() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [pathPart] = raw.split('?');
  return pathPart || '/';
}

// Strict access policy: ONLY Home, Content Summary Detail, Auth, and Legal pages are accessible without login.
// All Explore, Search, Upload, Categories, Creators, Dashboard, and Admin pages require verified authentication.
function isPublicRoute(path) {
  if (path === '/' || path === '') return true;
  if (path.startsWith('/content/')) return true;
  return [
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/about',
    '/contact',
    '/terms',
    '/privacy',
    '/copyright',
  ].includes(path);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  try {
    localStorage.setItem('sp_theme', isDark ? 'dark' : 'light');
  } catch {}
  renderHeaderAndFooter();
}

function renderBrandSvg(sizeCls = 'w-9 h-8 sm:w-11 sm:h-9') {
  return `
    <svg class="${sizeCls} shrink-0" viewBox="0 0 76 62" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="spCapGrad" x1="8" y1="6" x2="66" y2="30" gradientUnits="userSpaceOnUse">
          <stop stop-color="#3563E9"/>
          <stop offset="1" stop-color="#6B21E8"/>
        </linearGradient>
        <linearGradient id="spBookL" x1="12" y1="30" x2="38" y2="56" gradientUnits="userSpaceOnUse">
          <stop stop-color="#3B82F6"/>
          <stop offset="1" stop-color="#6366F1"/>
        </linearGradient>
        <linearGradient id="spBookR" x1="38" y1="30" x2="64" y2="56" gradientUnits="userSpaceOnUse">
          <stop stop-color="#7C3AED"/>
          <stop offset="1" stop-color="#A855F7"/>
        </linearGradient>
      </defs>
      <path d="M38 6L6 20L38 33L70 20L38 6Z" fill="url(#spCapGrad)"/>
      <path d="M18 27V38C18 42.5 27 46 38 46C49 46 58 42.5 58 38V27L38 35.5L18 27Z" fill="#2563EB" fill-opacity="0.9"/>
      <path d="M65 22V35" stroke="#F59E0B" stroke-width="3" stroke-linecap="round"/>
      <circle cx="65" cy="37" r="3" fill="#F59E0B"/>
      <path d="M10 39C20 35.5 30 37.5 38 43.5V56C30 50.5 20 49 10 52V39Z" fill="url(#spBookL)"/>
      <path d="M66 39C56 35.5 46 37.5 38 43.5V56C46 50.5 56 49 66 52V39Z" fill="url(#spBookR)"/>
      <path d="M15 43C22 40.8 29.5 42 35.5 46.2" stroke="white" stroke-opacity="0.7" stroke-width="2" stroke-linecap="round"/>
      <path d="M61 43C54 40.8 46.5 42 40.5 46.2" stroke="white" stroke-opacity="0.7" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
}

function renderHeaderHtml() {
  const user = store.user;
  const isDark = document.documentElement.classList.contains('dark');
  const route = getRoutePath();

  const navLinks = [
    {
      href: '#/',
      label: 'Home',
      active: route === '/',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>',
    },
    {
      href: '#/notes',
      label: 'Notes',
      active: route === '/notes',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>',
    },
    {
      href: '#/videos',
      label: 'Lectures',
      active: route === '/videos',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    },
    {
      href: '#/articles',
      label: 'Articles',
      active: route === '/articles',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>',
    },
    {
      href: '#/poems-stories',
      label: 'Stories',
      active: route === '/poems-stories',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>',
    },
    ...(user?.role === 'admin'
      ? [
          {
            href: '#/admin',
            label: 'Admin',
            active: route.startsWith('/admin'),
            icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>',
          },
        ]
      : user?.role === 'creator'
      ? [
          {
            href: '#/creator',
            label: 'Studio',
            active: route.startsWith('/creator'),
            icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>',
          },
        ]
      : [
          {
            href: '#/creators',
            label: 'Community',
            active: route.startsWith('/creators'),
            icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>',
          },
        ]),
  ];

  const themeIcon = isDark
    ? `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`
    : `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;

  const rightAction = user
    ? `
      <div class="relative flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button type="button" id="theme-toggle-btn" aria-label="Toggle light and dark theme" title="${isDark ? 'Switch to light mode' : 'Switch to dark mode'}"
          class="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-slate-800 transition-colors shrink-0">
          ${themeIcon}
        </button>
        <button type="button" id="user-menu-btn" class="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 min-h-[38px] rounded-full border border-indigo-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-indigo-50/70 dark:hover:bg-slate-800 text-xs font-semibold text-[#0f0f4d] dark:text-white transition-colors whitespace-nowrap shrink-0">
          <span class="w-6 h-6 rounded-full bg-[#5a1fd8] dark:bg-sky-500 text-white dark:text-slate-950 font-bold text-[11px] flex items-center justify-center shrink-0">${esc(user.name.slice(0, 1).toUpperCase())}</span>
          <span class="hidden sm:inline max-w-[110px] truncate">${esc(user.name)}</span>
          ${user.unreadNotifications > 0 ? `<span class="font-mono text-[10px] text-amber-600 dark:text-amber-400">(${user.unreadNotifications})</span>` : ''}
        </button>
        <div id="user-menu-dropdown" class="hidden absolute right-0 top-12 w-60 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 shadow-xl py-2 z-50 text-sm">
          <div class="px-4 py-2 border-b border-slate-100 dark:border-slate-800">
            <div class="font-semibold text-xs text-slate-900 dark:text-white truncate">${esc(user.name)}</div>
            <div class="text-[11px] text-slate-500 truncate">${user.username ? `@${esc(user.username)}` : esc(user.email)}</div>
            ${user.publicUid ? `<div class="text-[10px] font-mono text-slate-400 mt-0.5">UID: ${esc(user.publicUid)}</div>` : ''}
          </div>
          <a href="#/dashboard" class="block px-4 py-2.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">Reader Dashboard</a>
          <a href="#/dashboard/settings" class="block px-4 py-2.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">My Profile &amp; UID</a>
          <a href="#/dashboard/library" class="block px-4 py-2.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">My Library &amp; Purchases</a>
          <a href="#/dashboard/notifications" class="block px-4 py-2.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">Notifications ${user.unreadNotifications > 0 ? `(${user.unreadNotifications})` : ''}</a>
          ${
            user.role === 'creator' || user.role === 'admin'
              ? `<a href="#/creator" class="block px-4 py-2.5 text-xs font-medium text-[#5a1fd8] dark:text-sky-400 hover:bg-slate-50 dark:hover:bg-slate-800">Creator Studio</a>`
              : `<a href="#/become-creator" class="block px-4 py-2.5 text-xs font-medium text-[#5a1fd8] dark:text-sky-400 hover:bg-slate-50 dark:hover:bg-slate-800">Become a Creator</a>`
          }
          ${user.role === 'admin' ? `<a href="#/admin" class="block px-4 py-2.5 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-slate-50 dark:hover:bg-slate-800">Admin Console</a>` : ''}
          <div class="mt-1 pt-1 border-t border-slate-100 dark:border-slate-800">
            <button type="button" id="nav-logout-btn" class="w-full text-left px-4 py-2.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-slate-50 dark:hover:bg-slate-800">Sign Out</button>
          </div>
        </div>
      </div>
    `
    : `
      <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button type="button" id="mobile-search-trigger" aria-label="Search resources"
          class="lg:hidden w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white/90 dark:bg-slate-800 border border-indigo-100 dark:border-slate-700 text-[#0f0f4d] dark:text-slate-200 flex items-center justify-center shrink-0">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </button>
        <button type="button" id="theme-toggle-btn" aria-label="Toggle light and dark theme" title="${isDark ? 'Switch to light mode' : 'Switch to dark mode'}"
          class="hidden sm:flex p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-slate-800 transition-colors shrink-0">
          ${themeIcon}
        </button>
        <!-- Mobile matches Image 1 (Login filled purple, Sign Up outlined); Desktop matches Image 2 (Login outlined, Sign Up filled purple) -->
        <a href="#/login" class="px-3 sm:px-4 py-1.5 min-h-[34px] sm:min-h-[38px] inline-flex items-center justify-center text-xs font-semibold rounded-full bg-[#5a1fd8] text-white lg:bg-white lg:text-[#5a1fd8] lg:border lg:border-[#5a1fd8] dark:lg:bg-slate-900 dark:lg:text-violet-300 dark:lg:border-violet-400 hover:opacity-95 transition-all whitespace-nowrap shrink-0">
          Login
        </a>
        <a href="#/signup" class="px-3 sm:px-5 py-1.5 min-h-[34px] sm:min-h-[38px] inline-flex items-center justify-center text-xs font-semibold rounded-full bg-white text-[#0f0f4d] border border-[#5a1fd8] lg:bg-[#5a1fd8] lg:text-white lg:border-transparent lg:shadow-[0_6px_14px_rgba(90,31,216,0.3)] dark:bg-slate-900 dark:text-white dark:lg:bg-violet-600 hover:opacity-95 transition-all whitespace-nowrap shrink-0">
          Sign Up
        </a>
      </div>
    `;

  return `
    <header class="sticky top-0 z-40 bg-[#eaf1ff]/95 dark:bg-[#0B1120]/95 backdrop-blur border-b border-indigo-100/90 dark:border-slate-800">
      <div class="max-w-[1440px] mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-[68px] flex items-center justify-between gap-2 sm:gap-4">
        <!-- Left Zone: Mobile Hamburger + Brand Logo & Wordmark -->
        <div class="flex items-center gap-1.5 sm:gap-2.5 min-w-0 shrink-0">
          <button type="button" id="mobile-nav-btn" aria-label="Toggle navigation menu" aria-expanded="false" class="lg:hidden p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-[#0f0f4d] dark:text-slate-200 hover:bg-white/70 dark:hover:bg-slate-800 shrink-0">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <a href="#/" class="flex items-center gap-1.5 sm:gap-2.5 whitespace-nowrap shrink-0">
            ${renderBrandSvg('w-8 h-7 sm:w-11 sm:h-9')}
            <div class="leading-none">
              <div class="text-[17px] sm:text-[24px] font-extrabold tracking-tight leading-none">
                <span class="text-[#0f0f4d] dark:text-white lg:bg-gradient-to-r lg:from-[#3a1fc7] lg:to-[#7a2be2] lg:bg-clip-text lg:text-transparent dark:lg:from-sky-300 dark:lg:to-violet-400">Scholar</span><span class="text-[#5a1fd8] dark:text-violet-400 lg:bg-gradient-to-r lg:from-[#5a1fd8] lg:to-[#8b35e8] lg:bg-clip-text lg:text-transparent dark:lg:from-violet-400 dark:lg:to-fuchsia-400">Press</span>
              </div>
              <span class="block text-[9px] sm:text-[11px] font-semibold text-[#1b1b3a] dark:text-slate-300 mt-0.5 tracking-tight">Learn. Create. Share. Earn.</span>
            </div>
          </a>
        </div>

        <!-- Center Zone: Desktop Navigation (matches Image 2) -->
        <nav class="hidden lg:flex items-center gap-1 xl:gap-2 text-[13px] font-medium">
          ${navLinks
            .map(
              (l) => `
            <a href="${l.href}" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full whitespace-nowrap shrink-0 transition-all ${
              l.active
                ? 'bg-[#5a1fd8] text-white font-semibold shadow-[0_6px_14px_rgba(90,31,216,0.3)]'
                : 'text-[#1b1b3a] dark:text-slate-200 hover:bg-white/75 dark:hover:bg-slate-800/80'
            }">
              <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${l.icon}</svg>
              <span>${esc(l.label)}</span>
            </a>
          `
            )
            .join('')}
        </nav>

        <!-- Right Zone: Desktop Compact Search + Auth / User Controls -->
        <div class="flex items-center gap-2 xl:gap-3 shrink-0">
          <form id="header-search-form" class="hidden xl:flex items-center bg-white dark:bg-[#111A2E] rounded-full h-9 w-56 2xl:w-64 pl-4 pr-3 border border-indigo-100 dark:border-slate-700 shadow-[0_3px_10px_rgba(80,80,160,0.08)] dark:shadow-none">
            <input type="search" id="header-search-input" placeholder="Search notes, lectures..." class="flex-1 min-w-0 bg-transparent border-0 outline-none text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400" />
            <button type="submit" aria-label="Search" class="text-slate-700 dark:text-slate-300 hover:text-[#5a1fd8] pl-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            </button>
          </form>
          ${rightAction}
        </div>
      </div>

      <!-- Mobile Navigation Drawer -->
      <div id="mobile-nav-drawer" class="hidden lg:hidden border-t border-indigo-100 dark:border-slate-800 bg-white dark:bg-[#0B1120] px-4 py-3 space-y-1 text-sm max-h-[75vh] overflow-y-auto shadow-lg">
        ${navLinks
          .map(
            (l) =>
              `<a href="${l.href}" class="mobile-nav-link flex items-center gap-2.5 min-h-[44px] px-3 rounded-xl font-medium ${
                l.active
                  ? 'bg-[#efe8ff] dark:bg-violet-950/60 text-[#5a1fd8] dark:text-violet-300 font-semibold'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }">
                <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${l.icon}</svg>
                <span>${esc(l.label)}</span>
              </a>`
          )
          .join('')}
        <div class="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-1.5 text-xs">
          <a href="#/explore" class="mobile-nav-link flex items-center min-h-[40px] px-3 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium">Explore All</a>
          <a href="#/categories" class="mobile-nav-link flex items-center min-h-[40px] px-3 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium">Categories</a>
          <a href="#/pdf-library" class="mobile-nav-link flex items-center min-h-[40px] px-3 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium">PDF Library</a>
          <button type="button" id="mobile-drawer-theme-btn" class="flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium text-left">
            ${themeIcon}<span>${isDark ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
        </div>
        ${
          user
            ? `<div class="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
                <a href="#/dashboard" class="mobile-nav-link flex items-center min-h-[44px] px-3 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">Reader Dashboard</a>
                ${user.role === 'creator' || user.role === 'admin' ? `<a href="#/creator" class="mobile-nav-link flex items-center min-h-[44px] px-3 rounded-lg font-semibold text-[#5a1fd8] dark:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800">Creator Studio</a>` : `<a href="#/become-creator" class="mobile-nav-link flex items-center min-h-[44px] px-3 rounded-lg font-semibold text-[#5a1fd8] dark:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800">Become a Creator</a>`}
                ${user.role === 'admin' ? `<a href="#/admin" class="mobile-nav-link flex items-center min-h-[44px] px-3 rounded-lg font-semibold text-amber-700 dark:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800">Admin Console</a>` : ''}
              </div>`
            : `<div class="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800 flex gap-2">
                <a href="#/login" class="mobile-nav-link flex-1 flex items-center justify-center min-h-[44px] rounded-full bg-[#5a1fd8] text-white font-semibold text-xs">Login</a>
                <a href="#/signup" class="mobile-nav-link flex-1 flex items-center justify-center min-h-[44px] rounded-full border border-[#5a1fd8] text-[#5a1fd8] dark:text-violet-300 font-semibold text-xs">Sign Up</a>
              </div>`
        }
      </div>
    </header>
  `;
}

function renderMobileBottomNavHtml() {
  const user = store.user;
  const route = getRoutePath();
  const earnHref = user?.role === 'creator' || user?.role === 'admin' ? '#/creator' : '#/become-creator';
  const profileHref = user ? '#/dashboard/settings' : '#/signup';

  const items = [
    {
      href: '#/',
      label: 'Home',
      active: route === '/',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>',
    },
    {
      href: '#/explore',
      label: 'Explore',
      active: ['/explore', '/notes', '/videos', '/articles', '/poems-stories', '/pdf-library', '/categories'].includes(route),
      icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M14.828 9.172l-2.121 4.243-4.243 2.121 2.121-4.243 4.243-2.121z"/>',
    },
    {
      href: earnHref,
      label: 'Earn',
      active: route.startsWith('/creator') || route === '/become-creator',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M8 21h8m-4-4v4m-5-9a5 5 0 0010 0V5H7v7zm10-5h2a2 2 0 010 4h-2M7 7H5a2 2 0 000 4h2"/>',
    },
    {
      href: profileHref,
      label: 'Profile',
      active: route.startsWith('/dashboard') || route === '/login' || route === '/signup' || route.startsWith('/admin'),
      icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>',
    },
  ];

  return `
    <nav aria-label="Mobile Bottom Navigation" class="md:hidden fixed bottom-0 inset-x-0 z-40 h-14 bg-white/95 dark:bg-[#0B1120]/95 backdrop-blur border-t border-indigo-100 dark:border-slate-800 shadow-[0_-4px_18px_rgba(30,30,90,0.08)] grid grid-cols-4">
      ${items
        .map(
          (item) => `
        <a href="${item.href}" class="relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
          item.active
            ? 'text-[#5a1fd8] dark:text-violet-400'
            : 'text-slate-500 dark:text-slate-400 hover:text-[#0f0f4d] dark:hover:text-white'
        }">
          <svg class="w-5 h-5" fill="${item.active && item.label === 'Home' ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${item.active ? '2.2' : '1.9'}" viewBox="0 0 24 24">${item.icon}</svg>
          <span class="leading-none">${item.label}</span>
          ${item.active ? `<span class="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-[3px] rounded-t-full bg-[#5a1fd8] dark:bg-violet-400"></span>` : ''}
        </a>
      `
        )
        .join('')}
    </nav>
  `;
}

function renderFooterHtml() {
  return `
    <footer class="mt-auto bg-white dark:bg-[#0F172A] border-t border-slate-200 dark:border-slate-800 pb-16 md:pb-0">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 text-sm">
          <div class="col-span-2 md:col-span-1">
            <a href="#/" class="font-display text-xl font-bold text-[#0f0f4d] dark:text-white">ScholarPress</a>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-2.5 leading-relaxed">
              An open-access and monetized educational publishing marketplace for study notes, PDFs, research papers, lectures, poems, and stories.
            </p>
          </div>
          <div>
            <div class="text-xs font-semibold text-slate-900 dark:text-white mb-2.5">Library</div>
            <ul class="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
              <li><a href="#/explore" class="hover:text-[#5a1fd8] dark:hover:text-white">Explore All Content</a></li>
              <li><a href="#/notes" class="hover:text-[#5a1fd8] dark:hover:text-white">Educational Notes</a></li>
              <li><a href="#/pdf-library" class="hover:text-[#5a1fd8] dark:hover:text-white">PDF Library</a></li>
              <li><a href="#/articles" class="hover:text-[#5a1fd8] dark:hover:text-white">Articles &amp; Papers</a></li>
              <li><a href="#/videos" class="hover:text-[#5a1fd8] dark:hover:text-white">Video Lectures</a></li>
              <li><a href="#/poems-stories" class="hover:text-[#5a1fd8] dark:hover:text-white">Poems &amp; Stories</a></li>
            </ul>
          </div>
          <div>
            <div class="text-xs font-semibold text-slate-900 dark:text-white mb-2.5">Publishing</div>
            <ul class="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
              <li><a href="#/become-creator" class="hover:text-[#5a1fd8] dark:hover:text-white">Become a Creator</a></li>
              <li><a href="#/creators" class="hover:text-[#5a1fd8] dark:hover:text-white">Creator Directory</a></li>
              <li><a href="#/categories" class="hover:text-[#5a1fd8] dark:hover:text-white">Categories &amp; Subjects</a></li>
              <li><a href="#/about" class="hover:text-[#5a1fd8] dark:hover:text-white">About Us</a></li>
              <li><a href="#/contact" class="hover:text-[#5a1fd8] dark:hover:text-white">Contact Editorial Desk</a></li>
            </ul>
          </div>
          <div class="col-span-2 sm:col-span-1">
            <div class="text-xs font-semibold text-slate-900 dark:text-white mb-2.5">Policies &amp; Safeguards</div>
            <ul class="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
              <li><a href="#/terms" class="hover:text-[#5a1fd8] dark:hover:text-white">Terms &amp; Creator Agreement</a></li>
              <li><a href="#/privacy" class="hover:text-[#5a1fd8] dark:hover:text-white">Privacy Policy</a></li>
              <li><a href="#/copyright" class="hover:text-[#5a1fd8] dark:hover:text-white">Copyright &amp; Refund Policy</a></li>
            </ul>
          </div>
        </div>
        <div class="mt-7 pt-5 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 text-center sm:text-left">
          <span>© ${new Date().getFullYear()} ScholarPress Publishing Platform. All rights reserved.</span>
          <span>INR Payments powered by modular Razorpay architecture</span>
        </div>
      </div>
    </footer>
  `;
}

function renderShell() {
  const shell = document.getElementById('app-shell');
  if (!shell) return;
  shell.innerHTML = `
    <div id="site-header-slot">${renderHeaderHtml()}</div>
    <main id="page-root" class="flex-1"></main>
    <div id="site-footer-slot">${renderFooterHtml()}</div>
    <div id="mobile-bottom-nav-slot">${renderMobileBottomNavHtml()}</div>
  `;
  wireHeaderEvents();
}

function renderHeaderAndFooter() {
  const h = document.getElementById('site-header-slot');
  if (h) {
    h.innerHTML = renderHeaderHtml();
    wireHeaderEvents();
  }
  const b = document.getElementById('mobile-bottom-nav-slot');
  if (b) {
    b.innerHTML = renderMobileBottomNavHtml();
  }
}

function wireHeaderEvents() {
  document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme);
  document.getElementById('mobile-drawer-theme-btn')?.addEventListener('click', toggleTheme);

  document.getElementById('mobile-search-trigger')?.addEventListener('click', () => {
    const heroInput = document.getElementById('hero-search-input');
    if (heroInput) {
      heroInput.focus();
      heroInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      window.location.hash = '#/explore';
    }
  });

  document.getElementById('header-search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('header-search-input')?.value.trim() || '';
    window.location.hash = q ? `#/explore?q=${encodeURIComponent(q)}` : '#/explore';
  });

  const mobileBtn = document.getElementById('mobile-nav-btn');
  const mobileDrawer = document.getElementById('mobile-nav-drawer');
  mobileBtn?.addEventListener('click', () => {
    const isHidden = mobileDrawer?.classList.toggle('hidden');
    mobileBtn.setAttribute('aria-expanded', String(!isHidden));
  });
  mobileDrawer?.querySelectorAll('.mobile-nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      mobileDrawer.classList.add('hidden');
      mobileBtn?.setAttribute('aria-expanded', 'false');
    });
  });

  const menuBtn = document.getElementById('user-menu-btn');
  const menuDrop = document.getElementById('user-menu-dropdown');
  menuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    menuDrop?.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    menuDrop?.classList.add('hidden');
  });

  document.getElementById('nav-logout-btn')?.addEventListener('click', async () => {
    await logoutAll();
    showToast('Signed out.', 'info');
    window.location.hash = '#/';
    routeCurrentView();
  });
}

async function routeCurrentView() {
  cleanupReaderProgress();
  renderHeaderAndFooter();

  const main = document.getElementById('page-root');
  if (!main) return;
  const path = getRoutePath();

  // Strict frontend gate (backed by mandatory server-side HTTP 401 enforcement on every protected API)
  if (!isPublicRoute(path) && !store.user) {
    try {
      const intended = window.location.hash || `#${path}`;
      if (intended && !intended.startsWith('#/login') && !intended.startsWith('#/signup')) {
        sessionStorage.setItem('sp_post_login_redirect', intended);
      }
    } catch {}
    showToast('Please sign up or log in to explore, upload, and access full content.', 'info');
    window.location.hash = '#/signup';
    return;
  }

  window.scrollTo({ top: 0 });
  if (!path.startsWith('/content/')) {
    const labelMap = {
      '/': 'Home Page',
      '/explore': 'Explore Catalog',
      '/notes': 'Educational Notes',
      '/study-materials': 'Study Materials',
      '/pdf-library': 'PDF Library',
      '/articles': 'Articles & Essays',
      '/videos': 'Video Lectures',
      '/poems-stories': 'Poems & Stories',
      '/categories': 'Categories',
      '/creators': 'Creator Directory',
      '/dashboard': 'Reader Dashboard',
      '/dashboard/settings': 'Profile Settings',
      '/complete-profile': 'Complete Profile Setup',
      '/creator': 'Creator Studio',
      '/admin': 'Admin Console',
    };
    notifyRouteChange(path, labelMap[path] || path);
  }

  if (path === '/' || path === '') {
    await renderHomePage(main);
  } else if (path === '/explore') {
    await renderExplorePage(main);
  } else if (path === '/notes') {
    await renderExplorePage(main, {
      title: 'Educational Notes',
      subtitle: 'Annotated lecture notes, exam revision booklets, and chapter summaries.',
      contentType: 'Notes',
      lockType: true,
    });
  } else if (path === '/study-materials') {
    await renderExplorePage(main, {
      title: 'Study Materials',
      subtitle: 'Notes, PDF documents, e-books, tutorials, and research papers.',
      contentType: 'StudyMaterials',
      lockType: true,
    });
  } else if (path === '/pdf-library') {
    await renderExplorePage(main, {
      title: 'PDF Document Library',
      subtitle: 'Downloadable monographs, solved question sets, and academic handbooks.',
      contentType: 'PDF / Documents',
      lockType: true,
    });
  } else if (path === '/articles') {
    await renderExplorePage(main, {
      title: 'Articles & Essays',
      subtitle: 'Deep-dive explanatory articles and scholarly commentary.',
      contentType: 'Articles',
      lockType: true,
    });
  } else if (path === '/videos') {
    await renderExplorePage(main, {
      title: 'Video Lectures & Recorded Classes',
      subtitle: 'Recorded courses, conceptual walkthroughs, and tutorial sessions.',
      contentType: 'Video Lectures',
      lockType: true,
    });
  } else if (path === '/poems-stories') {
    await renderExplorePage(main, {
      title: 'Poems & Short Stories',
      subtitle: 'Original verse anthologies, short fiction, and literary craft essays.',
      contentType: 'PoemsAndStories',
      lockType: true,
    });
  } else if (path === '/categories') {
    await renderCategoriesPage(main);
  } else if (path === '/creators') {
    await renderCreatorsDirectoryPage(main);
  } else if (path.startsWith('/creator-profile/')) {
    const id = path.split('/')[2];
    await renderCreatorPublicProfilePage(main, id);
  } else if (path.startsWith('/content/')) {
    const slug = path.slice('/content/'.length);
    await renderContentDetailPage(main, slug);
  } else if (path === '/about') {
    renderStaticPage(main, 'about');
  } else if (path === '/contact') {
    renderStaticPage(main, 'contact');
  } else if (path === '/terms') {
    renderStaticPage(main, 'terms');
  } else if (path === '/privacy') {
    renderStaticPage(main, 'privacy');
  } else if (path === '/copyright') {
    renderStaticPage(main, 'copyright');
  } else if (path === '/login') {
    renderAuthPage(main, 'login');
  } else if (path === '/signup') {
    renderAuthPage(main, 'signup');
  } else if (path === '/forgot-password') {
    renderAuthPage(main, 'forgot');
  } else if (path === '/reset-password') {
    renderAuthPage(main, 'reset');
  } else if (path === '/verify-email') {
    renderAuthPage(main, 'verify');
  } else if (path === '/complete-profile') {
    renderCompleteProfilePage(main);
  } else if (path === '/become-creator') {
    renderBecomeCreatorPage(main);
  } else if (path === '/dashboard' || path.startsWith('/dashboard/')) {
    const tab = path.split('/')[2] || 'overview';
    await renderUserDashboardPage(main, tab);
  } else if (path.startsWith('/creator/edit/')) {
    const editId = path.split('/')[3];
    await renderCreatorDashboardPage(main, 'upload', editId);
  } else if (path === '/creator' || path.startsWith('/creator/')) {
    const tab = path.split('/')[2] || 'overview';
    await renderCreatorDashboardPage(main, tab);
  } else if (path === '/admin' || path.startsWith('/admin/')) {
    const parts = path.split('/');
    const tab = parts[2] || 'overview';
    const subParam = parts[3] ? decodeURIComponent(parts.slice(3).join('/')) : null;
    await renderAdminDashboardPage(main, tab, subParam);
  } else {
    window.location.hash = '#/';
    await renderHomePage(main);
  }
}

async function bootstrap() {
  renderShell();
  loadStoredSessionToken();
  startActivityTracker();

  let lastMetaUserId = null;
  subscribeStore(() => {
    renderHeaderAndFooter();
    if (store.user && store.user.id !== lastMetaUserId) {
      lastMetaUserId = store.user.id;
      loadGlobalCatalogMeta();
    }
  });

  window.addEventListener('hashchange', () => {
    routeCurrentView();
  });

  const initialPath = getRoutePath();
  const needsAuthBeforeRender = !isPublicRoute(initialPath);

  // Render Home & public routes IMMEDIATELY (0ms startup delay, zero extra network calls)
  let initialRouted = false;
  if (!needsAuthBeforeRender) {
    initialRouted = true;
    store.authReady = true;
    routeCurrentView();
  }

  const finishAuthProtectedRoute = async () => {
    if (initialRouted) return;
    initialRouted = true;
    store.authReady = true;
    renderHeaderAndFooter();
    await routeCurrentView();
  };

  // Restore active email/password session token immediately in parallel
  if (store.sessionToken) {
    const prevUserId = store.user?.id || null;
    await refreshCurrentUser();
    if (store.user) {
      lastMetaUserId = store.user.id;
      loadGlobalCatalogMeta();
    }
    if (!initialRouted) {
      await finishAuthProtectedRoute();
    } else if (store.user?.id !== prevUserId) {
      renderHeaderAndFooter();
      const currPath = getRoutePath();
      if (currPath.startsWith('/content/') || currPath === '/login' || currPath === '/signup') {
        routeCurrentView();
      }
    }
  }

  // Subscribe to Firebase Auth state (Google Sign-In persistence)
  subscribeFirebaseAuth(async (firebaseUser) => {
    const prevUserId = store.user?.id || null;
    if (firebaseUser && !store.sessionToken) {
      try {
        const idToken = await firebaseUser.getIdToken();
        const res = await apiFetch('/api/auth/firebase-sync', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
        });
        store.user = res.user;
        notifyStore();
      } catch (err) {
        if (err?.data?.accountBlocked) {
          try {
            sessionStorage.setItem('sp_last_block_notice', JSON.stringify(err.data));
          } catch {}
          await signOutFirebase();
          store.user = null;
          notifyStore();
          window.location.hash = '#/login';
        }
      }
    }
    if (store.user && store.user.id !== lastMetaUserId) {
      lastMetaUserId = store.user.id;
      loadGlobalCatalogMeta();
    }
    if (!initialRouted) {
      await finishAuthProtectedRoute();
    } else if (store.user?.id !== prevUserId) {
      renderHeaderAndFooter();
      const currPath = getRoutePath();
      if (
        currPath.startsWith('/content/') ||
        !isPublicRoute(currPath) ||
        currPath === '/login' ||
        currPath === '/signup'
      ) {
        routeCurrentView();
      }
    }
  });

  // Safety fallback for auth-protected routes only if Firebase is slow
  if (needsAuthBeforeRender) {
    setTimeout(finishAuthProtectedRoute, 650);
  }
}

// Global Full-Screen Image Viewer Delegation:
// Clicking any cover page, content page, thumbnail, or preview image anywhere on the site
// opens the pure-black gesture-driven full-screen image viewer (pinch zoom, pan, swipe, double-tap).
document.addEventListener('click', (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  // Ignore clicks inside the viewer itself, interactive buttons (like remove-file X), or active rich-text editor
  if (
    target.closest('#sp-image-lightbox') ||
    target.closest('.sp-rte-editor') ||
    target.closest('[data-no-lightbox]')
  ) {
    return;
  }

  // 1) Thumbnail / Cover photo click anywhere (Home, Explore, Search, Reader Cover, Profile, Cover Preview)
  let thumbImg = target.closest('img.sp-zoom-img');
  if (!thumbImg) {
    const thumbOverlay = target.closest('.sp-thumb-overlay');
    if (thumbOverlay) {
      thumbImg = thumbOverlay.parentElement?.querySelector('img.sp-zoom-img') || null;
    }
  }
  if (thumbImg && thumbImg.getAttribute('src')) {
    e.preventDefault();
    e.stopPropagation();
    const title = thumbImg.dataset.zoomTitle || thumbImg.getAttribute('alt') || 'Image';
    openImageLightbox({
      images: [
        {
          src: thumbImg.currentSrc || thumbImg.getAttribute('src'),
          title,
        },
      ],
      startIndex: 0,
    });
    return;
  }

  // 2) Any photo or content page image inside Full Content (.reading-prose img)
  const proseImg = target.closest('.reading-prose img');
  if (proseImg && proseImg.getAttribute('src')) {
    e.preventDefault();
    e.stopPropagation();
    const scope = proseImg.closest('#rd-unlocked-content') || proseImg.closest('.reading-prose') || document;
    const allProseImgs = Array.from(scope.querySelectorAll('.reading-prose img')).filter((img) =>
      img.getAttribute('src')
    );
    const galleryBtns = Array.from(scope.querySelectorAll('.rd-gallery-item'));
    const galleryItems = [
      ...galleryBtns
        .filter((b) => b.dataset.gallerySrc)
        .map((b, i) => ({
          el: b,
          src: b.dataset.gallerySrc,
          title: b.dataset.galleryName || `Photo ${i + 1}`,
        })),
      ...allProseImgs.map((img, i) => ({
        el: img,
        src: img.currentSrc || img.getAttribute('src'),
        title: img.getAttribute('alt') || `Page ${i + 1}`,
      })),
    ];
    const clickedIdx = Math.max(
      0,
      galleryItems.findIndex((it) => it.el === proseImg)
    );
    openImageLightbox({ images: galleryItems, startIndex: clickedIdx });
  }
});

bootstrap();
