import './index.css';
import {
  apiFetch,
  esc,
  loadGlobalCatalogMeta,
  loadStoredSessionToken,
  logoutAll,
  notifyStore,
  refreshCurrentUser,
  showToast,
  store,
  subscribeStore,
} from './js/api.js';
import { subscribeFirebaseAuth } from './js/firebase.js';
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
  renderUserDashboardPage,
} from './js/pages-auth-user.js';
import { renderCreatorDashboardPage } from './js/pages-creator.js';
import { renderAdminDashboardPage } from './js/pages-admin.js';

function getRoutePath() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [pathPart] = raw.split('?');
  return pathPart || '/';
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  try {
    localStorage.setItem('sp_theme', isDark ? 'dark' : 'light');
  } catch {}
  renderHeaderAndFooter();
}

function renderHeaderHtml() {
  const user = store.user;
  const isDark = document.documentElement.classList.contains('dark');
  const route = getRoutePath();

  const navLinks = [
    { href: '#/', label: 'Home', active: route === '/' },
    { href: '#/explore', label: 'Explore', active: route.startsWith('/explore') },
    { href: '#/categories', label: 'Categories', active: route.startsWith('/categories') },
    {
      href: user?.role === 'creator' || user?.role === 'admin' ? '#/creator' : '#/become-creator',
      label: user?.role === 'creator' || user?.role === 'admin' ? 'Creator Studio' : 'Publish',
      active: route.startsWith('/creator') || route.startsWith('/become-creator'),
    },
    ...(user?.role === 'admin'
      ? [{ href: '#/admin', label: 'Admin', active: route.startsWith('/admin') }]
      : [{ href: '#/creators', label: 'Creators', active: route.startsWith('/creators') }]),
  ];

  const rightAction = user
    ? `
      <div class="relative flex items-center gap-2 shrink-0">
        <button type="button" id="theme-toggle-btn" aria-label="Toggle light and dark theme" title="${isDark ? 'Switch to light mode' : 'Switch to dark mode'}"
          class="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0">
          ${
            isDark
              ? `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`
              : `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`
          }
        </button>
        <button type="button" id="user-menu-btn" class="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-white transition-colors whitespace-nowrap shrink-0">
          <span class="w-6 h-6 rounded-full bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950 font-display text-[11px] flex items-center justify-center shrink-0">${esc(user.name.slice(0, 1).toUpperCase())}</span>
          <span class="hidden sm:inline max-w-[110px] truncate">${esc(user.name)}</span>
          ${user.unreadNotifications > 0 ? `<span class="font-mono text-[10px] text-amber-600 dark:text-amber-400">(${user.unreadNotifications})</span>` : ''}
        </button>
        <div id="user-menu-dropdown" class="hidden absolute right-0 top-12 w-56 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 shadow-xl py-2 z-50 text-sm">
          <div class="px-4 py-2 border-b border-slate-100 dark:border-slate-800">
            <div class="font-semibold text-xs text-slate-900 dark:text-white truncate">${esc(user.name)}</div>
            <div class="text-[11px] text-slate-500 truncate">${esc(user.email)}</div>
          </div>
          <a href="#/dashboard" class="block px-4 py-2.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">Reader Dashboard</a>
          <a href="#/dashboard/library" class="block px-4 py-2.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">My Library &amp; Purchases</a>
          <a href="#/dashboard/notifications" class="block px-4 py-2.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">Notifications ${user.unreadNotifications > 0 ? `(${user.unreadNotifications})` : ''}</a>
          ${
            user.role === 'creator' || user.role === 'admin'
              ? `<a href="#/creator" class="block px-4 py-2.5 text-xs font-medium text-[#1B3B6F] dark:text-sky-400 hover:bg-slate-50 dark:hover:bg-slate-800">Creator Studio</a>`
              : `<a href="#/become-creator" class="block px-4 py-2.5 text-xs font-medium text-[#1B3B6F] dark:text-sky-400 hover:bg-slate-50 dark:hover:bg-slate-800">Become a Creator</a>`
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
        <button type="button" id="theme-toggle-btn" aria-label="Toggle light and dark theme" title="${isDark ? 'Switch to light mode' : 'Switch to dark mode'}"
          class="p-2.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0">
          ${
            isDark
              ? `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`
              : `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`
          }
        </button>
        <a href="#/login" class="px-3.5 sm:px-4 py-2 min-h-[40px] flex items-center text-xs font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors whitespace-nowrap shrink-0">
          Sign In
        </a>
      </div>
    `;

  return `
    <header class="sticky top-0 z-40 bg-white/95 dark:bg-[#0B1120]/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-3 md:gap-8">
        <!-- Zone 1: Single-line Brand Wordmark -->
        <a href="#/" class="font-display text-lg sm:text-xl font-bold tracking-tight text-[#0F2547] dark:text-white whitespace-nowrap shrink-0">
          ScholarPress
        </a>

        <!-- Zone 2: 5 concise single-line text nav links -->
        <nav class="hidden md:flex items-center gap-6 lg:gap-7 text-sm font-medium">
          ${navLinks
            .map(
              (l) =>
                `<a href="${l.href}" class="whitespace-nowrap shrink-0 transition-colors ${
                  l.active
                    ? 'text-[#0F2547] dark:text-sky-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }">${esc(l.label)}</a>`
            )
            .join('')}
        </nav>

        <!-- Zone 3: Primary Action + Mobile Drawer Toggle -->
        <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
          ${rightAction}
          <button type="button" id="mobile-nav-btn" aria-label="Toggle navigation menu" aria-expanded="false" class="md:hidden p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
        </div>
      </div>

      <!-- Mobile Navigation Drawer -->
      <div id="mobile-nav-drawer" class="hidden md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1120] px-4 py-3 space-y-1 text-sm max-h-[75vh] overflow-y-auto shadow-lg">
        ${navLinks
          .map(
            (l) =>
              `<a href="${l.href}" class="mobile-nav-link flex items-center min-h-[44px] px-3 rounded-lg font-medium ${
                l.active
                  ? 'bg-slate-100 dark:bg-slate-800 text-[#0F2547] dark:text-sky-400 font-semibold'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }">${esc(l.label)}</a>`
          )
          .join('')}
        <div class="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-1 text-xs">
          <a href="#/notes" class="mobile-nav-link flex items-center min-h-[40px] px-3 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Notes</a>
          <a href="#/pdf-library" class="mobile-nav-link flex items-center min-h-[40px] px-3 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">PDF Library</a>
          <a href="#/videos" class="mobile-nav-link flex items-center min-h-[40px] px-3 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Video Lectures</a>
          <a href="#/poems-stories" class="mobile-nav-link flex items-center min-h-[40px] px-3 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Poems &amp; Stories</a>
        </div>
        ${
          user
            ? `<div class="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
                <a href="#/dashboard" class="mobile-nav-link flex items-center min-h-[44px] px-3 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">Reader Dashboard</a>
                ${user.role === 'admin' ? `<a href="#/admin" class="mobile-nav-link flex items-center min-h-[44px] px-3 rounded-lg font-semibold text-amber-700 dark:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800">Admin Console</a>` : ''}
              </div>`
            : `<div class="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800 flex gap-2">
                <a href="#/login" class="mobile-nav-link flex-1 flex items-center justify-center min-h-[44px] rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950 font-semibold text-xs">Sign In</a>
                <a href="#/signup" class="mobile-nav-link flex-1 flex items-center justify-center min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 font-semibold text-xs">Sign Up</a>
              </div>`
        }
      </div>
    </header>
  `;
}

function renderFooterHtml() {
  return `
    <footer class="mt-auto bg-white dark:bg-[#0F172A] border-t border-slate-200 dark:border-slate-800">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
          <div class="col-span-2 md:col-span-1">
            <a href="#/" class="font-display text-xl font-bold text-[#0F2547] dark:text-white">ScholarPress</a>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
              An open-access and monetized educational publishing marketplace for study notes, PDFs, research papers, lectures, poems, and stories.
            </p>
          </div>
          <div>
            <div class="text-xs font-semibold text-slate-900 dark:text-white mb-3">Library</div>
            <ul class="space-y-2 text-xs text-slate-600 dark:text-slate-400">
              <li><a href="#/explore" class="hover:text-slate-900 dark:hover:text-white">Explore All Content</a></li>
              <li><a href="#/notes" class="hover:text-slate-900 dark:hover:text-white">Educational Notes</a></li>
              <li><a href="#/pdf-library" class="hover:text-slate-900 dark:hover:text-white">PDF Library</a></li>
              <li><a href="#/articles" class="hover:text-slate-900 dark:hover:text-white">Articles &amp; Papers</a></li>
              <li><a href="#/videos" class="hover:text-slate-900 dark:hover:text-white">Video Lectures</a></li>
              <li><a href="#/poems-stories" class="hover:text-slate-900 dark:hover:text-white">Poems &amp; Stories</a></li>
            </ul>
          </div>
          <div>
            <div class="text-xs font-semibold text-slate-900 dark:text-white mb-3">Publishing</div>
            <ul class="space-y-2 text-xs text-slate-600 dark:text-slate-400">
              <li><a href="#/become-creator" class="hover:text-slate-900 dark:hover:text-white">Become a Creator</a></li>
              <li><a href="#/creators" class="hover:text-slate-900 dark:hover:text-white">Creator Directory</a></li>
              <li><a href="#/categories" class="hover:text-slate-900 dark:hover:text-white">Categories &amp; Subjects</a></li>
              <li><a href="#/about" class="hover:text-slate-900 dark:hover:text-white">About Us</a></li>
              <li><a href="#/contact" class="hover:text-slate-900 dark:hover:text-white">Contact Editorial Desk</a></li>
            </ul>
          </div>
          <div class="col-span-2 sm:col-span-1">
            <div class="text-xs font-semibold text-slate-900 dark:text-white mb-3">Policies &amp; Safeguards</div>
            <ul class="space-y-2 text-xs text-slate-600 dark:text-slate-400">
              <li><a href="#/terms" class="hover:text-slate-900 dark:hover:text-white">Terms &amp; Creator Agreement</a></li>
              <li><a href="#/privacy" class="hover:text-slate-900 dark:hover:text-white">Privacy Policy</a></li>
              <li><a href="#/copyright" class="hover:text-slate-900 dark:hover:text-white">Copyright &amp; Refund Policy</a></li>
            </ul>
          </div>
        </div>
        <div class="mt-8 sm:mt-10 pt-6 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400 text-center sm:text-left">
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
  `;
  wireHeaderEvents();
}

function renderHeaderAndFooter() {
  const h = document.getElementById('site-header-slot');
  if (h) {
    h.innerHTML = renderHeaderHtml();
    wireHeaderEvents();
  }
}

function wireHeaderEvents() {
  document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme);

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
  window.scrollTo({ top: 0 });

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
    const tab = path.split('/')[2] || 'overview';
    await renderAdminDashboardPage(main, tab);
  } else {
    await renderHomePage(main);
  }
}

async function bootstrap() {
  renderShell();
  loadStoredSessionToken();
  await loadGlobalCatalogMeta();

  let initialRouted = false;
  const finishInitialRoute = async () => {
    if (initialRouted) return;
    initialRouted = true;
    store.authReady = true;
    renderHeaderAndFooter();
    await routeCurrentView();
  };

  subscribeStore(() => {
    renderHeaderAndFooter();
  });

  // If user has an active email/password session token, restore immediately
  if (store.sessionToken) {
    await refreshCurrentUser();
    await finishInitialRoute();
  }

  // Subscribe to Firebase Auth state (Google Sign-In persistence)
  subscribeFirebaseAuth(async (firebaseUser) => {
    if (firebaseUser && !store.sessionToken) {
      try {
        const idToken = await firebaseUser.getIdToken();
        const res = await apiFetch('/api/auth/firebase-sync', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
        });
        store.user = res.user;
        notifyStore();
      } catch {
        // Ignore transient sync error
      }
    }
    await finishInitialRoute();
  });

  // Fallback timeout in case Firebase auth init is slow
  setTimeout(finishInitialRoute, 900);

  window.addEventListener('hashchange', () => {
    routeCurrentView();
  });
}

bootstrap();
