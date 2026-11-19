import {
  apiFetch,
  CONTENT_TYPES,
  esc,
  formatDate,
  formatInr,
  HOME_HERO_BANNER,
  LANGUAGES,
  renderContentCard,
  renderCoverImage,
  showToast,
  store,
} from './api.js';

function renderHomeTrendingCard(item) {
  const isVideo = /video|tutorial|lecture/i.test(item.contentType || '');
  const ratingVal = Number(item.avgRating || 0);
  const viewsVal = Number(item.viewsCount || 0);
  const viewsLabel =
    viewsVal >= 1000 ? `${(viewsVal / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(viewsVal);
  const typeAccentMap = {
    Notes: 'text-blue-700 dark:text-blue-400',
    'Video Lectures': 'text-emerald-700 dark:text-emerald-400',
    'Online Tutorials': 'text-emerald-700 dark:text-emerald-400',
    Articles: 'text-violet-700 dark:text-violet-400',
    Stories: 'text-amber-700 dark:text-amber-400',
    Poems: 'text-rose-700 dark:text-rose-400',
    'PDF / Documents': 'text-indigo-700 dark:text-indigo-400',
    'E-books': 'text-indigo-700 dark:text-indigo-400',
  };
  const accentCls = typeAccentMap[item.contentType] || 'text-[#5a1fd8] dark:text-violet-400';

  return `
    <article class="group bg-white dark:bg-[#0D1629] border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col hover:border-indigo-300 dark:hover:border-violet-500/60 hover:shadow-md transition-all">
      <a href="#/content/${esc(item.slug)}" class="block aspect-[16/10] bg-slate-100 dark:bg-slate-900 overflow-hidden relative">
        ${renderCoverImage(item)}
        ${
          isVideo
            ? `<div class="absolute inset-0 flex items-center justify-center bg-slate-950/20 group-hover:bg-slate-950/30 transition-colors">
                 <span class="w-11 h-11 rounded-full bg-white/95 text-[#5a1fd8] flex items-center justify-center shadow-lg">
                   <svg class="w-5 h-5 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>
                 </span>
               </div>`
            : ''
        }
      </a>
      <div class="p-3.5 sm:p-4 flex-1 flex flex-col">
        <div class="flex items-center justify-between gap-2 text-[11px] font-semibold mb-1.5">
          <span class="${accentCls} truncate">${esc(item.contentType || 'Resource')}</span>
          <span class="text-slate-400 dark:text-slate-500 truncate">${esc(item.language || 'English')}</span>
        </div>
        <a href="#/content/${esc(item.slug)}" class="font-semibold text-sm text-slate-900 dark:text-white leading-snug line-clamp-2 hover:text-[#5a1fd8] dark:hover:text-violet-300 transition-colors mb-3 flex-1">
          ${esc(item.title)}
        </a>
        <div class="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
          <div class="flex items-center gap-2.5 text-slate-500 dark:text-slate-400 tabular-nums">
            <span class="inline-flex items-center gap-1" title="Views">
              <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              ${esc(viewsLabel)}
            </span>
            <span class="inline-flex items-center gap-1" title="Rating">
              <svg class="w-3.5 h-3.5 text-amber-500" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>
              ${ratingVal > 0 ? ratingVal.toFixed(1) : 'New'}
            </span>
          </div>
          <span class="font-mono font-bold tabular-nums ${
            item.isFree
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-[#c2410c] dark:text-amber-400'
          }">
            ${item.isFree ? 'Free' : formatInr(item.priceInr)}
          </span>
        </div>
      </div>
    </article>
  `;
}

export async function renderHomePage(container) {
  container.innerHTML = `
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div class="animate-pulse space-y-6">
        <div class="h-80 bg-slate-200 dark:bg-slate-800 rounded-3xl"></div>
        <div class="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div class="h-20 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
          <div class="h-20 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
          <div class="h-20 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
          <div class="h-20 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
          <div class="h-20 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
          <div class="h-20 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-5">
          <div class="h-64 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
          <div class="h-64 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
          <div class="h-64 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
          <div class="h-64 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        </div>
      </div>
    </div>
  `;

  try {
    const data = await apiFetch('/api/catalog/home');
    store.settings = data.settings || {};
    const stats = data.stats || {};
    const commissionRate = stats.defaultCommissionRate || 10;
    const creatorKeep = 100 - commissionRate;
    const announcement = (data.settings?.announcement_banner || '').trim();
    const isCreatorOrAdmin = store.user?.role === 'creator' || store.user?.role === 'admin';
    const uploadHref = isCreatorOrAdmin ? '#/creator/upload' : '#/become-creator';
    const creatorCtaHref = isCreatorOrAdmin ? '#/creator/overview' : '#/become-creator';
    const creatorCtaLabel = isCreatorOrAdmin ? 'Creator Studio' : 'Become a Creator';

    const quickFormatTiles = [
      {
        title: 'Notes',
        sub: 'Study Guides & PDFs',
        href: '#/notes',
        surface: 'bg-[#edf4ff] hover:bg-[#e1eeff] dark:bg-blue-950/35 dark:hover:bg-blue-950/55 border-blue-200/70 dark:border-blue-900/60',
        iconBg: 'bg-[#2d7df6]',
        arrowCls: 'text-[#2d7df6] bg-blue-100/90 dark:bg-blue-900/60 dark:text-blue-300',
        svg: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>',
      },
      {
        title: 'Lectures',
        sub: 'Video Tutorials',
        href: '#/videos',
        surface: 'bg-[#e9f9f1] hover:bg-[#dcf5e8] dark:bg-emerald-950/35 dark:hover:bg-emerald-950/55 border-emerald-200/70 dark:border-emerald-900/60',
        iconBg: 'bg-[#19b86b]',
        arrowCls: 'text-[#159958] bg-emerald-100/90 dark:bg-emerald-900/60 dark:text-emerald-300',
        svg: '<path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>',
      },
      {
        title: 'Articles',
        sub: 'Essays & Research',
        href: '#/articles',
        surface: 'bg-[#f2ecff] hover:bg-[#e8dfff] dark:bg-violet-950/35 dark:hover:bg-violet-950/55 border-violet-200/70 dark:border-violet-900/60',
        iconBg: 'bg-[#8b46f6]',
        arrowCls: 'text-[#7432db] bg-violet-100/90 dark:bg-violet-900/60 dark:text-violet-300',
        svg: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>',
      },
      {
        title: 'Stories',
        sub: 'Poems & Literature',
        href: '#/poems-stories',
        surface: 'bg-[#fff5e6] hover:bg-[#ffecd1] dark:bg-amber-950/35 dark:hover:bg-amber-950/55 border-amber-200/70 dark:border-amber-900/60',
        iconBg: 'bg-[#f59714]',
        arrowCls: 'text-[#d47b05] bg-amber-100/90 dark:bg-amber-900/60 dark:text-amber-300',
        svg: '<path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>',
      },
      {
        title: 'PDF Library',
        sub: 'E-Books & Papers',
        href: '#/pdf-library',
        surface: 'bg-[#ffedf3] hover:bg-[#ffe0eb] dark:bg-rose-950/35 dark:hover:bg-rose-950/55 border-rose-200/70 dark:border-rose-900/60',
        iconBg: 'bg-[#ec3872]',
        arrowCls: 'text-[#d6245e] bg-rose-100/90 dark:bg-rose-900/60 dark:text-rose-300',
        svg: '<path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>',
      },
      {
        title: 'Creators',
        sub: 'Verified Educators',
        href: '#/creators',
        surface: 'bg-[#e8f8f8] hover:bg-[#d8f3f3] dark:bg-teal-950/35 dark:hover:bg-teal-950/55 border-teal-200/70 dark:border-teal-900/60',
        iconBg: 'bg-[#11b5b5]',
        arrowCls: 'text-[#0d9494] bg-teal-100/90 dark:bg-teal-900/60 dark:text-teal-300',
        svg: '<path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path>',
      },
    ];

    const categoryIconColors = [
      'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50',
      'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50',
      'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50',
      'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/50',
      'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50',
      'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50',
      'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50',
    ];

    const popularCategories = (data.categories || []).slice(0, 7);
    const trendingItems = (data.trending || []).slice(0, 4);

    container.innerHTML = `
      ${
        announcement
          ? `<div class="bg-[#1b1a88] text-white text-xs sm:text-sm py-2.5 px-4 text-center">
               <div class="max-w-7xl mx-auto">${esc(announcement)}</div>
             </div>`
          : ''
      }

      <!-- Vibrant Sky-Periwinkle Hero Canvas + Quick Format Strip -->
      <div class="bg-gradient-to-b from-[#dceaff] via-[#edf3ff] to-[#F8FAFC] dark:from-[#0b152b] dark:via-[#0e182e] dark:to-[#0B1120] pt-4 sm:pt-6 pb-8 sm:pb-10">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-5 sm:space-y-6">

          <!-- Hero Banner Card using User's Uploaded Illustration -->
          <section class="relative rounded-2xl sm:rounded-3xl overflow-hidden border border-indigo-200/80 dark:border-slate-800 shadow-[0_14px_40px_rgba(65,70,165,0.12)] dark:shadow-none bg-[#d8e8ff] dark:bg-[#0f1b34]">
            <!-- Desktop Background Artwork + Directional Readability Scrim -->
            <img
              src="${HOME_HERO_BANNER}"
              alt="ScholarPress learning desk with books, lightbulb, laptop, graduation cap, and globe"
              class="hidden lg:block absolute inset-0 w-full h-full object-cover object-right select-none pointer-events-none"
            />
            <div class="hidden lg:block absolute inset-0 bg-gradient-to-r from-[#e6efff] via-[#e6efff]/92 via-45% to-transparent dark:from-[#0c162d] dark:via-[#0d1831]/92 dark:via-48% dark:to-[#0d1831]/25 pointer-events-none"></div>

            <!-- Hero Foreground Content -->
            <div class="relative z-10 px-5 sm:px-8 lg:px-12 py-7 sm:py-10 lg:py-12 lg:max-w-[60%]">
              <div class="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-[#14143c] dark:text-slate-100 bg-white/90 dark:bg-slate-900/80 border border-indigo-100 dark:border-slate-700/80 rounded-full px-3.5 py-1.5 shadow-sm mb-4">
                <svg class="w-4 h-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>
                <span>India's Open &amp; Monetized Education Platform</span>
              </div>

              <h1 class="font-display text-3xl sm:text-5xl lg:text-[3.35rem] font-bold tracking-tight text-[#0f0f4d] dark:text-white leading-[1.08]">
                Welcome to <span class="text-[#5a1fd8] dark:text-violet-400">ScholarPress</span>
              </h1>
              <p class="text-lg sm:text-2xl lg:text-[1.75rem] font-semibold text-[#14143c] dark:text-slate-100 mt-1.5 leading-snug">
                Learn, Create, Share &amp; Earn
              </p>
              <p class="text-sm sm:text-base text-[#2b2b4a] dark:text-slate-300 leading-relaxed max-w-xl mt-3">
                Explore study notes, video lectures, articles, poems, and stories. Share your knowledge with learners everywhere and earn transparently.
              </p>

              <!-- Direct Search Bar -->
              <form id="hero-search-form" class="mt-5 sm:mt-6 flex items-center bg-white dark:bg-[#0B1120] border border-indigo-200/80 dark:border-slate-700 rounded-full p-1 shadow-[0_6px_18px_rgba(80,80,160,0.12)] dark:shadow-none max-w-xl">
                <svg class="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 ml-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                <input
                  type="search"
                  id="hero-search-input"
                  placeholder="Search for notes, lectures, articles, poems..."
                  class="flex-1 min-w-0 bg-transparent border-0 outline-none focus:outline-none px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
                />
                <button
                  type="submit"
                  class="min-h-[38px] px-5 sm:px-7 py-2 text-xs sm:text-sm font-semibold rounded-full bg-[#5a1fd8] hover:bg-[#4a14c4] dark:bg-violet-600 dark:hover:bg-violet-500 text-white transition-colors whitespace-nowrap shrink-0"
                >
                  Search
                </button>
              </form>

              <!-- Primary Hero Actions -->
              <div class="mt-4 sm:mt-5 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
                <a
                  href="${uploadHref}"
                  class="min-h-[44px] inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-full bg-[#5a1fd8] hover:bg-[#4a14c4] dark:bg-violet-600 dark:hover:bg-violet-500 text-white shadow-[0_8px_18px_rgba(90,31,216,0.28)] transition-colors whitespace-nowrap shrink-0"
                >
                  <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                  <span>Upload Content →</span>
                </a>
                <a
                  href="#/explore"
                  class="min-h-[44px] inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-full bg-white/90 hover:bg-white dark:bg-slate-900/85 dark:hover:bg-slate-900 border border-[#5a1fd8]/40 dark:border-violet-400/50 text-[#0f0f4d] dark:text-white transition-colors whitespace-nowrap shrink-0"
                >
                  <svg class="w-4 h-4 text-[#5a1fd8] dark:text-violet-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
                  <span>Explore Resources</span>
                </a>
              </div>
            </div>

            <!-- Mobile & Tablet Responsive Illustration Banner (prevents text overlap on narrow screens) -->
            <div class="lg:hidden relative h-48 sm:h-64 w-full overflow-hidden border-t border-indigo-200/60 dark:border-slate-800">
              <img
                src="${HOME_HERO_BANNER}"
                alt="ScholarPress learning desk illustration"
                class="w-full h-full object-cover object-[78%_center]"
              />
            </div>
          </section>

          <!-- 6-Tile Quick Category Strip -->
          <section aria-label="Quick Format Navigation" class="bg-white dark:bg-[#111A2E] rounded-2xl p-3 sm:p-4 border border-indigo-100/90 dark:border-slate-800 shadow-[0_10px_28px_rgba(70,80,160,0.08)] dark:shadow-none">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2.5 sm:gap-3">
              ${quickFormatTiles
                .map(
                  (tile) => `
                <a href="${tile.href}" class="group flex items-center gap-3 rounded-xl px-3.5 py-3 border transition-all ${tile.surface}">
                  <div class="w-10 h-10 rounded-xl ${tile.iconBg} text-white flex items-center justify-center shrink-0 shadow-sm">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${tile.svg}</svg>
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="font-semibold text-sm text-[#14143c] dark:text-white truncate leading-tight">${tile.title}</div>
                    <div class="text-[11px] text-slate-600 dark:text-slate-400 truncate mt-0.5">${tile.sub}</div>
                  </div>
                  <span class="w-6 h-6 rounded-full ${tile.arrowCls} flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform" aria-hidden="true">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                  </span>
                </a>
              `
                )
                .join('')}
            </div>
          </section>

          <!-- Live Platform Stats + Become a Creator Gradient CTA Strip -->
          <section class="bg-white dark:bg-[#111A2E] rounded-2xl border border-indigo-100/90 dark:border-slate-800 shadow-[0_8px_24px_rgba(70,80,160,0.08)] dark:shadow-none overflow-hidden grid grid-cols-1 lg:grid-cols-12">
            <div class="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 dark:divide-slate-800">
              <div class="px-4 py-4 sm:py-5 flex items-center gap-3">
                <div class="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                </div>
                <div class="min-w-0">
                  <div class="font-mono text-lg sm:text-xl font-bold text-[#0f0f4d] dark:text-white tabular-nums leading-tight">${stats.registeredMembers ?? 0}</div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">Members</div>
                </div>
              </div>
              <div class="px-4 py-4 sm:py-5 flex items-center gap-3">
                <div class="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                </div>
                <div class="min-w-0">
                  <div class="font-mono text-lg sm:text-xl font-bold text-[#0f0f4d] dark:text-white tabular-nums leading-tight">${stats.publishedWorks ?? 0}</div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">Resources</div>
                </div>
              </div>
              <div class="px-4 py-4 sm:py-5 flex items-center gap-3">
                <div class="w-9 h-9 rounded-lg bg-violet-50 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                </div>
                <div class="min-w-0">
                  <div class="font-mono text-lg sm:text-xl font-bold text-[#0f0f4d] dark:text-white tabular-nums leading-tight">${stats.activeCreators ?? 0}</div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">Active Creators</div>
                </div>
              </div>
              <div class="px-4 py-4 sm:py-5 flex items-center gap-3">
                <div class="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-500 flex items-center justify-center shrink-0">
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>
                </div>
                <div class="min-w-0">
                  <div class="font-mono text-lg sm:text-xl font-bold text-[#0f0f4d] dark:text-white tabular-nums leading-tight">${creatorKeep}%</div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">Creator Share</div>
                </div>
              </div>
            </div>

            <div class="lg:col-span-5 bg-gradient-to-r from-[#2863eb] via-[#4a36dc] to-[#5d20d8] text-white px-5 sm:px-6 py-4 sm:py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div class="flex items-center gap-3.5 min-w-0">
                <div class="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                  <svg class="w-6 h-6 text-[#ffc830]" fill="currentColor" viewBox="0 0 24 24"><path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"></path></svg>
                </div>
                <div class="min-w-0">
                  <div class="font-semibold text-sm sm:text-base leading-snug">Share Your Knowledge</div>
                  <div class="text-xs text-indigo-100/90">Earn up to ${creatorKeep}% from every paid work</div>
                </div>
              </div>
              <a
                href="${creatorCtaHref}"
                class="w-full sm:w-auto min-h-[40px] inline-flex items-center justify-center px-5 py-2 rounded-full bg-[#ffc01f] hover:bg-[#f2b312] text-[#14143c] font-bold text-xs sm:text-sm shadow-md transition-colors whitespace-nowrap shrink-0"
              >
                ${creatorCtaLabel} →
              </a>
            </div>
          </section>

          <!-- Two-Column Main Showcase: Trending Content (Left) + Popular Categories (Right) -->
          <section class="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
            <!-- Trending Content Panel -->
            <div class="lg:col-span-8 xl:col-span-9 bg-white dark:bg-[#111A2E] rounded-2xl border border-indigo-100/90 dark:border-slate-800 shadow-[0_8px_24px_rgba(70,80,160,0.07)] dark:shadow-none p-5 sm:p-6">
              <div class="flex items-center justify-between gap-4 mb-5">
                <div class="flex items-center gap-2.5">
                  <span class="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-950/50 text-orange-500 flex items-center justify-center shrink-0">
                    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clip-rule="evenodd"></path></svg>
                  </span>
                  <h2 class="font-display text-xl sm:text-2xl font-bold text-[#0f0f4d] dark:text-white">Trending Content</h2>
                </div>
                <a href="#/explore?sort=popular" class="text-xs sm:text-sm font-semibold text-[#5a1fd8] dark:text-violet-400 hover:underline whitespace-nowrap shrink-0">
                  View All →
                </a>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                ${
                  trendingItems.length
                    ? trendingItems.map(renderHomeTrendingCard).join('')
                    : `<p class="col-span-full text-sm text-slate-500 dark:text-slate-400 py-8 text-center">No published resources yet. Be the first to share your notes or video lecture.</p>`
                }
              </div>
            </div>

            <!-- Popular Categories Panel -->
            <aside class="lg:col-span-4 xl:col-span-3 bg-white dark:bg-[#111A2E] rounded-2xl border border-indigo-100/90 dark:border-slate-800 shadow-[0_8px_24px_rgba(70,80,160,0.07)] dark:shadow-none p-5 sm:p-6">
              <div class="flex items-center justify-between gap-3 mb-4">
                <h2 class="font-display text-xl font-bold text-[#0f0f4d] dark:text-white">Popular Categories</h2>
                <a href="#/categories" class="text-xs font-semibold text-[#5a1fd8] dark:text-violet-400 hover:underline whitespace-nowrap shrink-0">View All →</a>
              </div>
              <ul class="divide-y divide-slate-100 dark:divide-slate-800">
                ${
                  popularCategories.length
                    ? popularCategories
                        .map(
                          (cat, idx) => `
                      <li>
                        <a href="#/explore?category=${esc(cat.slug)}" class="group flex items-center justify-between gap-3 py-2.5 hover:text-[#5a1fd8] dark:hover:text-violet-300 transition-colors">
                          <div class="flex items-center gap-3 min-w-0">
                            <span class="w-8 h-8 rounded-lg ${categoryIconColors[idx % categoryIconColors.length]} flex items-center justify-center shrink-0">
                              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"></path></svg>
                            </span>
                            <span class="text-sm font-semibold text-slate-800 dark:text-slate-100 group-hover:text-[#5a1fd8] dark:group-hover:text-violet-300 truncate">${esc(cat.name)}</span>
                          </div>
                          <span class="text-[11px] font-mono text-slate-400 dark:text-slate-500 tabular-nums shrink-0">${cat.contentCount}</span>
                        </a>
                      </li>
                    `
                        )
                        .join('')
                    : `<li class="py-4 text-xs text-slate-500">Categories coming soon.</li>`
                }
              </ul>
            </aside>
          </section>
        </div>
      </div>

      <!-- Recently Published -->
      <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
        <div class="flex items-end justify-between gap-4 mb-6">
          <div>
            <h2 class="font-display text-2xl sm:text-3xl font-bold text-[#0f0f4d] dark:text-white">Recently Published</h2>
            <p class="text-sm text-slate-600 dark:text-slate-400 mt-1">Freshly approved study notes, video lectures, PDFs, articles, and stories.</p>
          </div>
          <a href="#/explore?sort=latest" class="text-sm font-semibold text-[#5a1fd8] dark:text-violet-400 hover:underline whitespace-nowrap shrink-0">Explore latest →</a>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          ${(data.recent || []).map(renderContentCard).join('') || '<p class="text-sm text-slate-500">No recent publications yet.</p>'}
        </div>
      </section>

      <!-- Featured Creators -->
      <section class="bg-white dark:bg-[#0F172A] border-t border-slate-200 dark:border-slate-800 py-10 sm:py-12">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex items-end justify-between gap-4 mb-6">
            <div>
              <h2 class="font-display text-2xl sm:text-3xl font-bold text-[#0f0f4d] dark:text-white">Featured Creators</h2>
              <p class="text-sm text-slate-600 dark:text-slate-400 mt-1">Independent educators, researchers, and authors publishing on ScholarPress.</p>
            </div>
            <a href="#/creators" class="text-sm font-semibold text-[#5a1fd8] dark:text-violet-400 hover:underline whitespace-nowrap shrink-0">All creators →</a>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            ${(data.featuredCreators || [])
              .map(
                (cr) => `
              <a href="#/creator-profile/${cr.id}" class="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-[#111A2E] hover:border-indigo-300 dark:hover:border-violet-500/60 transition-colors flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-3 mb-3">
                    <div class="w-11 h-11 rounded-full bg-gradient-to-br from-[#3a1fc7] to-[#7a2be2] text-white font-display font-semibold flex items-center justify-center shrink-0">
                      ${esc((cr.displayName || cr.name || 'C').slice(0, 2).toUpperCase())}
                    </div>
                    <div class="min-w-0">
                      <h3 class="font-semibold text-sm text-slate-900 dark:text-white truncate">${esc(cr.displayName || cr.name)}</h3>
                      <p class="text-xs text-slate-500 dark:text-slate-400 truncate">${esc(cr.tagline || 'Educator & Publisher')}</p>
                    </div>
                  </div>
                  <p class="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mb-4">${esc(cr.bio || cr.expertise || '')}</p>
                </div>
                <div class="pt-3 border-t border-slate-200/70 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  <span>${cr.publishedCount} publications</span>
                  <span>${cr.followerCount} followers</span>
                </div>
              </a>
            `
              )
              .join('')}
          </div>
        </div>
      </section>

      <!-- Deep Royal Indigo Trust & Value Highlight Bar -->
      <section class="bg-gradient-to-r from-[#17177a] via-[#261fa0] to-[#3421b5] text-white">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 sm:py-8">
          <div class="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6 flex-1">
              <div class="flex items-center gap-3.5">
                <div class="w-10 h-10 rounded-xl bg-white/10 text-sky-300 flex items-center justify-center shrink-0">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                </div>
                <div>
                  <div class="font-semibold text-sm">Secure &amp; Trusted</div>
                  <div class="text-xs text-indigo-200/90">Your data &amp; files are protected</div>
                </div>
              </div>
              <div class="flex items-center gap-3.5">
                <div class="w-10 h-10 rounded-xl bg-white/10 text-sky-300 flex items-center justify-center shrink-0">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                </div>
                <div>
                  <div class="font-semibold text-sm">Instant Access</div>
                  <div class="text-xs text-indigo-200/90">Read notes &amp; watch anytime</div>
                </div>
              </div>
              <div class="flex items-center gap-3.5">
                <div class="w-10 h-10 rounded-xl bg-white/10 text-sky-300 flex items-center justify-center shrink-0">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </div>
                <div>
                  <div class="font-semibold text-sm">Fair Earnings</div>
                  <div class="text-xs text-indigo-200/90">Keep ${creatorKeep}% (${commissionRate}% fee)</div>
                </div>
              </div>
              <div class="flex items-center gap-3.5">
                <div class="w-10 h-10 rounded-xl bg-white/10 text-sky-300 flex items-center justify-center shrink-0">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                </div>
                <div>
                  <div class="font-semibold text-sm">Editorial Support</div>
                  <div class="text-xs text-indigo-200/90">Dedicated creator helpdesk</div>
                </div>
              </div>
            </div>
            <div class="xl:pl-6 xl:border-l xl:border-white/20 shrink-0">
              <p class="font-display italic font-semibold text-xl sm:text-2xl text-amber-300 leading-tight">
                Together for a<br class="hidden xl:inline" /> Smarter Education!
              </p>
            </div>
          </div>
        </div>
      </section>
    `;

    document.getElementById('hero-search-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = document.getElementById('hero-search-input')?.value.trim() || '';
      window.location.hash = q ? `#/explore?q=${encodeURIComponent(q)}` : '#/explore';
    });
  } catch (err) {
    container.innerHTML = `
      <div class="max-w-3xl mx-auto px-4 py-16 text-center">
        <h2 class="font-display text-2xl font-semibold mb-2">Unable to load catalog</h2>
        <p class="text-sm text-slate-600 dark:text-slate-400 mb-6">${esc(err.message)}</p>
        <button onclick="location.reload()" class="px-4 py-2 text-sm font-semibold rounded-lg bg-[#5a1fd8] text-white">Retry</button>
      </div>
    `;
  }
}

export async function renderExplorePage(container, preset = {}) {
  const hashQuery = window.location.hash.includes('?')
    ? new URLSearchParams(window.location.hash.split('?')[1])
    : new URLSearchParams();

  const state = {
    q: hashQuery.get('q') || '',
    category: hashQuery.get('category') || '',
    subject: hashQuery.get('subject') || '',
    contentType: preset.contentType || hashQuery.get('contentType') || '',
    language: hashQuery.get('language') || 'all',
    pricing: hashQuery.get('pricing') || 'all',
    sort: hashQuery.get('sort') || 'latest',
    page: Math.max(1, Number(hashQuery.get('page') || 1)),
  };

  const pageTitle = preset.title || 'Explore Educational Catalog';
  const pageSubtitle =
    preset.subtitle ||
    'Search across notes, PDFs, articles, e-books, research papers, video lectures, poems, and stories.';

  container.innerHTML = `
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 sm:py-10">
      <div class="mb-6 sm:mb-8">
        <h1 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">${esc(pageTitle)}</h1>
        <p class="text-sm text-slate-600 dark:text-slate-400 mt-1.5">${esc(pageSubtitle)}</p>
      </div>

      <!-- Filter & Search Bar -->
      <form id="explore-filter-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 mb-6 sm:mb-8 space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-3">
          <div class="sm:col-span-2 md:col-span-5">
            <label for="ex-q" class="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Keyword, title, creator, or tag</label>
            <input id="ex-q" type="search" value="${esc(state.q)}" placeholder="e.g. Raft, Linear Algebra, GATE, Poetry..."
              class="w-full min-h-[40px] px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-white" />
          </div>
          <div class="md:col-span-3">
            <label for="ex-category" class="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Category</label>
            <select id="ex-category" class="w-full min-h-[40px] px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-white">
              <option value="">All Categories</option>
              ${store.categories
                .map(
                  (c) => `<option value="${esc(c.slug)}" ${state.category === c.slug ? 'selected' : ''}>${esc(c.name)}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="md:col-span-2">
            <label for="ex-type" class="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Content Type</label>
            <select id="ex-type" ${preset.lockType ? 'disabled' : ''} class="w-full min-h-[40px] px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-white disabled:opacity-60">
              <option value="">All Formats</option>
              ${CONTENT_TYPES.map(
                (t) => `<option value="${esc(t)}" ${state.contentType === t ? 'selected' : ''}>${esc(t)}</option>`
              ).join('')}
              ${
                preset.contentType === 'PoemsAndStories'
                  ? `<option value="PoemsAndStories" selected>Poems &amp; Stories</option>`
                  : ''
              }
              ${
                preset.contentType === 'StudyMaterials'
                  ? `<option value="StudyMaterials" selected>Study Materials</option>`
                  : ''
              }
            </select>
          </div>
          <div class="md:col-span-2">
            <label for="ex-language" class="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Language</label>
            <select id="ex-language" class="w-full min-h-[40px] px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-white">
              <option value="all">All Languages</option>
              ${LANGUAGES.map(
                (l) => `<option value="${esc(l)}" ${state.language === l ? 'selected' : ''}>${esc(l)}</option>`
              ).join('')}
            </select>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <!-- Interactive Segmented Price Filter -->
          <div class="w-full sm:w-auto grid grid-cols-3 sm:flex items-center gap-1 p-1 bg-slate-100 dark:bg-[#0B1120] rounded-lg" role="group" aria-label="Pricing filter">
            ${[
              { id: 'all', label: 'All' },
              { id: 'free', label: 'Free' },
              { id: 'paid', label: 'Paid' },
            ]
              .map(
                (opt) => `
              <button type="button" data-pricing="${opt.id}" class="ex-pricing-btn min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-md transition-colors text-center whitespace-nowrap shrink-0 ${
                state.pricing === opt.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }">${opt.label}</button>
            `
              )
              .join('')}
          </div>

          <div class="flex flex-wrap items-center gap-2.5">
            <select id="ex-sort" class="flex-1 sm:flex-none min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-white">
              <option value="latest" ${state.sort === 'latest' ? 'selected' : ''}>Latest Uploads</option>
              <option value="popular" ${state.sort === 'popular' ? 'selected' : ''}>Most Popular</option>
              <option value="highest_rated" ${state.sort === 'highest_rated' ? 'selected' : ''}>Highest Rated</option>
              <option value="price_asc" ${state.sort === 'price_asc' ? 'selected' : ''}>Price: Low to High</option>
              <option value="price_desc" ${state.sort === 'price_desc' ? 'selected' : ''}>Price: High to Low</option>
            </select>
            <button type="submit" class="min-h-[38px] px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors whitespace-nowrap shrink-0">
              Apply
            </button>
            <button type="button" id="ex-reset-btn" class="min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white whitespace-nowrap shrink-0">
              Reset
            </button>
          </div>
        </div>
      </form>

      <div id="explore-results-meta" class="text-xs text-slate-500 dark:text-slate-400 mb-4 tabular-nums"></div>
      <div id="explore-results-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"></div>
      <div id="explore-pagination" class="mt-10 flex items-center justify-center gap-2"></div>
    </div>
  `;

  async function runQuery() {
    const grid = document.getElementById('explore-results-grid');
    const meta = document.getElementById('explore-results-meta');
    const pag = document.getElementById('explore-pagination');
    if (!grid) return;

    grid.innerHTML = `<div class="col-span-full py-12 text-center text-sm text-slate-500">Loading publications...</div>`;
    try {
      const qs = new URLSearchParams();
      if (state.q) qs.set('q', state.q);
      if (state.category) qs.set('category', state.category);
      if (state.subject) qs.set('subject', state.subject);
      if (state.contentType) qs.set('contentType', state.contentType);
      if (state.language && state.language !== 'all') qs.set('language', state.language);
      if (state.pricing && state.pricing !== 'all') qs.set('pricing', state.pricing);
      qs.set('sort', state.sort);
      qs.set('page', String(state.page));
      qs.set('limit', '12');

      const res = await apiFetch(`/api/catalog/contents?${qs.toString()}`);
      meta.textContent = `Showing ${res.items.length} of ${res.total} matching ${res.total === 1 ? 'publication' : 'publications'}`;

      if (!res.items.length) {
        grid.innerHTML = `
          <div class="col-span-full bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center">
            <h3 class="font-display text-xl font-semibold text-slate-900 dark:text-white mb-2">No matching publications found</h3>
            <p class="text-sm text-slate-500 dark:text-slate-400 mb-5">Try broadening your search terms, clearing filters, or switching categories.</p>
            <button type="button" id="ex-empty-reset" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] text-white">Clear All Filters</button>
          </div>
        `;
        document.getElementById('ex-empty-reset')?.addEventListener('click', () => {
          document.getElementById('ex-reset-btn')?.click();
        });
        pag.innerHTML = '';
        return;
      }

      grid.innerHTML = res.items.map(renderContentCard).join('');

      if (res.totalPages > 1) {
        let btns = '';
        for (let p = 1; p <= res.totalPages; p++) {
          btns += `<button type="button" data-page="${p}" class="ex-page-btn px-3.5 py-2 text-xs font-mono font-semibold rounded-lg border transition-colors ${
            p === res.page
              ? 'bg-[#0F2547] text-white border-[#0F2547] dark:bg-sky-500 dark:text-slate-950 dark:border-sky-500'
              : 'bg-white dark:bg-[#111A2E] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-400'
          }">${p}</button>`;
        }
        pag.innerHTML = btns;
        pag.querySelectorAll('.ex-page-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            state.page = Number(btn.dataset.page);
            runQuery();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });
        });
      } else {
        pag.innerHTML = '';
      }
    } catch (err) {
      grid.innerHTML = `<div class="col-span-full p-6 rounded-xl border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm">${esc(err.message)}</div>`;
    }
  }

  document.getElementById('explore-filter-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    state.q = document.getElementById('ex-q')?.value.trim() || '';
    state.category = document.getElementById('ex-category')?.value || '';
    if (!preset.lockType) {
      state.contentType = document.getElementById('ex-type')?.value || '';
    }
    state.language = document.getElementById('ex-language')?.value || 'all';
    state.sort = document.getElementById('ex-sort')?.value || 'latest';
    state.page = 1;
    runQuery();
  });

  document.getElementById('ex-sort')?.addEventListener('change', () => {
    state.sort = document.getElementById('ex-sort').value;
    state.page = 1;
    runQuery();
  });

  document.querySelectorAll('.ex-pricing-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.pricing = btn.dataset.pricing;
      state.page = 1;
      document.querySelectorAll('.ex-pricing-btn').forEach((b) => {
        const active = b.dataset.pricing === state.pricing;
        b.className = `ex-pricing-btn min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-md transition-colors text-center whitespace-nowrap shrink-0 ${
          active
            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
        }`;
      });
      runQuery();
    });
  });

  document.getElementById('ex-reset-btn')?.addEventListener('click', () => {
    state.q = '';
    state.category = '';
    state.subject = '';
    if (!preset.lockType) state.contentType = '';
    state.language = 'all';
    state.pricing = 'all';
    state.sort = 'latest';
    state.page = 1;
    document.getElementById('ex-q').value = '';
    document.getElementById('ex-category').value = '';
    if (!preset.lockType) document.getElementById('ex-type').value = '';
    document.getElementById('ex-language').value = 'all';
    document.getElementById('ex-sort').value = 'latest';
    runQuery();
  });

  await runQuery();
}

export async function renderCategoriesPage(container) {
  container.innerHTML = `<div class="max-w-7xl mx-auto px-4 py-12 text-sm text-slate-500">Loading categories...</div>`;
  try {
    const data = await apiFetch('/api/catalog/categories');
    store.categories = data.categories || [];
    container.innerHTML = `
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div class="mb-10 max-w-2xl">
          <h1 class="font-display text-3xl font-semibold text-slate-900 dark:text-white">Categories &amp; Subjects</h1>
          <p class="text-sm text-slate-600 dark:text-slate-400 mt-1.5">
            Explore curated academic disciplines, competitive examination tracks, and literary collections.
          </p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          ${data.categories
            .map(
              (cat) => `
            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between">
              <div>
                <div class="flex items-baseline justify-between gap-4 mb-2">
                  <a href="#/explore?category=${esc(cat.slug)}" class="font-display text-xl font-semibold text-slate-900 dark:text-white hover:text-[#1B3B6F] dark:hover:text-sky-400">
                    ${esc(cat.name)}
                  </a>
                  <span class="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">${cat.contentCount} works</span>
                </div>
                <p class="text-sm text-slate-600 dark:text-slate-400 mb-4">${esc(cat.description || '')}</p>
                ${
                  cat.subjects?.length
                    ? `<div class="pt-3 border-t border-slate-100 dark:border-slate-800">
                        <div class="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Subjects</div>
                        <div class="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                          ${cat.subjects
                            .map(
                              (s) =>
                                `<a href="#/explore?category=${esc(cat.slug)}&subject=${esc(s.slug)}" class="text-[#1B3B6F] dark:text-sky-400 hover:underline">${esc(s.name)}</a>`
                            )
                            .join('')}
                        </div>
                      </div>`
                    : ''
                }
              </div>
              <div class="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <a href="#/explore?category=${esc(cat.slug)}" class="text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-[#0F2547] dark:hover:text-white">
                  Browse ${esc(cat.name)} →
                </a>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="max-w-3xl mx-auto p-12 text-red-600">${esc(err.message)}</div>`;
  }
}

export async function renderCreatorsDirectoryPage(container) {
  container.innerHTML = `<div class="max-w-7xl mx-auto px-4 py-12 text-sm text-slate-500">Loading creators...</div>`;
  try {
    const data = await apiFetch('/api/catalog/creators');
    container.innerHTML = `
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div class="flex flex-wrap items-end justify-between gap-4 mb-10">
          <div>
            <h1 class="font-display text-3xl font-semibold text-slate-900 dark:text-white">Educators &amp; Publishers</h1>
            <p class="text-sm text-slate-600 dark:text-slate-400 mt-1.5">Follow your favourite professors, authors, and subject specialists.</p>
          </div>
          <a href="#/become-creator" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950 whitespace-nowrap shrink-0">
            Become a Creator
          </a>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          ${(data.creators || [])
            .map(
              (cr) => `
            <a href="#/creator-profile/${cr.id}" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6 hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex flex-col justify-between">
              <div>
                <div class="flex items-center gap-3.5 mb-3">
                  <div class="w-12 h-12 rounded-full bg-[#0F2547] dark:bg-sky-900 text-white font-display font-semibold text-lg flex items-center justify-center shrink-0">
                    ${esc((cr.displayName || cr.name).slice(0, 2).toUpperCase())}
                  </div>
                  <div class="min-w-0">
                    <h2 class="font-display text-lg font-semibold text-slate-900 dark:text-white truncate">${esc(cr.displayName || cr.name)}</h2>
                    <div class="text-xs text-slate-500 dark:text-slate-400">
                      ${cr.verified ? 'Verified Publisher · ' : ''}${esc(cr.tagline || 'Independent Educator')}
                    </div>
                  </div>
                </div>
                <p class="text-sm text-slate-600 dark:text-slate-400 line-clamp-3 mb-4">${esc(cr.bio || cr.expertise || '')}</p>
              </div>
              <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                <span>${cr.publishedCount} published works</span>
                <span>${cr.followerCount} followers · ${cr.totalSales} sales</span>
              </div>
            </a>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="max-w-3xl mx-auto p-12 text-red-600">${esc(err.message)}</div>`;
  }
}

export async function renderCreatorPublicProfilePage(container, creatorId) {
  container.innerHTML = `<div class="max-w-7xl mx-auto px-4 py-12 text-sm text-slate-500">Loading creator profile...</div>`;
  try {
    const data = await apiFetch(`/api/catalog/creators/${creatorId}`);
    const cr = data.creator;
    let isFollowing = Boolean(data.isFollowing);
    let followers = Number(cr.followerCount || 0);

    container.innerHTML = `
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-8 mb-8 sm:mb-10">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div class="flex flex-col sm:flex-row items-start gap-4 sm:gap-5">
              <div class="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#0F2547] dark:bg-sky-900 text-white font-display text-xl sm:text-2xl font-semibold flex items-center justify-center shrink-0">
                ${esc((cr.displayName || cr.name).slice(0, 2).toUpperCase())}
              </div>
              <div class="min-w-0">
                <div class="text-xs text-slate-500 dark:text-slate-400 mb-1">
                  ${cr.verified ? 'Verified Publisher' : 'Creator'} · Member since ${formatDate(cr.createdAt)}
                </div>
                <h1 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">${esc(cr.displayName || cr.name)}</h1>
                ${cr.tagline ? `<p class="text-sm font-medium text-[#1B3B6F] dark:text-sky-400 mt-1">${esc(cr.tagline)}</p>` : ''}
                <p class="text-sm text-slate-600 dark:text-slate-400 mt-3 max-w-2xl leading-relaxed">${esc(cr.bio || 'Publishing educational study notes and digital resources on ScholarPress.')}</p>
                ${cr.expertise ? `<p class="text-xs text-slate-500 dark:text-slate-400 mt-2">Expertise: ${esc(cr.expertise)}</p>` : ''}
              </div>
            </div>

            <div class="flex flex-col sm:items-end gap-2.5 shrink-0">
              <button type="button" id="profile-follow-btn" class="w-full sm:w-auto min-h-[42px] px-5 py-2.5 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                isFollowing
                  ? 'border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100'
                  : 'bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 text-white dark:text-slate-950'
              }">
                ${isFollowing ? 'Following' : 'Follow Creator'}
              </button>
              <div class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                <span id="profile-follower-count">${followers}</span> followers · ${data.contents.length} publications
              </div>
            </div>
          </div>
        </div>

        <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-6">Published Works</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          ${data.contents.length ? data.contents.map(renderContentCard).join('') : '<p class="text-sm text-slate-500">No published resources yet.</p>'}
        </div>
      </div>
    `;

    document.getElementById('profile-follow-btn')?.addEventListener('click', async () => {
      if (!store.user) {
        showToast('Please sign in to follow creators.', 'info');
        window.location.hash = '#/login';
        return;
      }
      try {
        const res = await apiFetch(`/api/community/follow/${cr.id}`, { method: 'POST' });
        isFollowing = res.following;
        followers = Math.max(0, followers + (isFollowing ? 1 : -1));
        const btn = document.getElementById('profile-follow-btn');
        btn.textContent = isFollowing ? 'Following' : 'Follow Creator';
        btn.className = `px-5 py-2.5 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
          isFollowing
            ? 'border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100'
            : 'bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 text-white dark:text-slate-950'
        }`;
        document.getElementById('profile-follower-count').textContent = String(followers);
        showToast(isFollowing ? 'Now following creator.' : 'Unfollowed creator.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="max-w-3xl mx-auto p-12 text-red-600">${esc(err.message)}</div>`;
  }
}

export function renderStaticPage(container, pageKey) {
  if (pageKey === 'contact') {
    container.innerHTML = `
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-14">
        <h1 class="font-display text-3xl font-semibold text-slate-900 dark:text-white mb-2">Contact Us</h1>
        <p class="text-sm text-slate-600 dark:text-slate-400 mb-8">
          Reach our editorial review team, creator payout desk, or copyright compliance office.
        </p>
        <form id="contact-form" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Full Name</label>
              <input name="name" required class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Email Address</label>
              <input name="email" type="email" required class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Subject</label>
            <input name="subject" required placeholder="e.g. Creator Payout Inquiry, Copyright Notice, Partnership" class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Message</label>
            <textarea name="message" rows="5" required class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]"></textarea>
          </div>
          <button type="submit" class="px-5 py-2.5 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 text-white dark:text-slate-950">
            Send Inquiry
          </button>
        </form>
      </div>
    `;
    document.getElementById('contact-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await apiFetch('/api/catalog/contact', {
          method: 'POST',
          body: Object.fromEntries(fd.entries()),
        });
        showToast(res.message, 'success');
        e.target.reset();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    return;
  }

  const docs = {
    about: {
      title: 'About ScholarPress',
      body: `
        <p>ScholarPress is an independent educational content publishing and monetization marketplace designed for educators, researchers, students, and literary authors.</p>
        <h2>Our Mission</h2>
        <p>High-quality study notes, monograph PDFs, lectures, and original literature deserve sustainable readership. ScholarPress empowers creators to publish freely accessible resources or set fair INR pricing while maintaining transparent revenue sharing (5%–20% platform commission).</p>
        <h2>Built for Academic Rigor &amp; Fair Payouts</h2>
        <ul>
          <li>Multi-format publishing across Notes, PDF Documents, Articles, E-books, Video Lectures, Tutorials, Research Papers, Poems, and Stories.</li>
          <li>Server-enforced access control for paid publications and protected downloads.</li>
          <li>Verified-purchase reviews to preserve scholarly trust.</li>
          <li>Full transaction ledger, commission transparency, and audited creator withdrawal workflows.</li>
        </ul>
      `,
    },
    terms: {
      title: 'Terms of Service, Creator Agreement & Content Guidelines',
      body: `
        <h2>1. Platform Terms of Service</h2>
        <p>By registering on ScholarPress, readers and creators agree to respect intellectual property laws, maintain accurate account details, and use purchased resources strictly for personal educational study unless otherwise licensed.</p>
        <h2>2. Creator Publishing Agreement</h2>
        <p>Creators retain copyright ownership of all original works they publish on ScholarPress and grant the platform a non-exclusive license to host, preview, deliver, and process purchases for those works. Creators warrant that every uploaded file, text, diagram, and video is either original or properly authorized for commercial distribution.</p>
        <h2>3. Revenue Share &amp; Commission</h2>
        <p>Platform commission is configurable between 5% and 20% per transaction (default 10%, unless a custom creator or content rate is assigned by administration). Failed or refunded transactions do not generate creator earnings and are reversed cleanly from pending/available balances.</p>
        <h2>4. Content Guidelines</h2>
        <ul>
          <li>No plagiarized textbooks, pirated exam papers, or unauthorized scanned copies.</li>
          <li>No malicious files, deceptive metadata, or harmful content.</li>
          <li>All submissions are subject to editorial approval and community moderation.</li>
        </ul>
      `,
    },
    privacy: {
      title: 'Privacy Policy & Data Protection',
      body: `
        <h2>1. Data We Collect</h2>
        <p>We store account profile information (name, email, institution), publishing metadata, library entitlements, and payment gateway references necessary to deliver purchased resources and creator payouts.</p>
        <h2>2. Payment Security</h2>
        <p>ScholarPress never collects or stores raw credit card, debit card, or UPI PIN credentials. All INR payments are routed through tokenized Razorpay orders with backend HMAC signature verification.</p>
        <h2>3. Age &amp; Student Privacy Safeguards</h2>
        <p>Users under the age of 18 should obtain parental or guardian consent before purchasing paid content or registering as a monetized creator. You may update your profile or request account deactivation at any time through our editorial contact desk.</p>
      `,
    },
    copyright: {
      title: 'Copyright Policy, Takedown Process & Refund Policy',
      body: `
        <h2>1. Copyright Ownership &amp; Takedown Mechanism</h2>
        <p>Every creator must explicitly affirm ownership or publishing rights before submitting content. If you believe any publication infringes your copyright, open the resource page and click <strong>Report / Copyright Notice</strong> to submit a formal takedown request with proof of ownership. Administrators review copyright claims promptly and remove infringing works with a full audit log.</p>
        <h2>2. Realistic Content Protection</h2>
        <p>Paid documents and videos are served exclusively through authenticated server-side access controls rather than public links. While no web browser can guarantee absolute screenshot prevention or DRM, unauthorized redistribution violates our Terms and results in immediate account suspension.</p>
        <h2>3. Refund Policy</h2>
        <p>Refund requests for defective files, materially misrepresented content, or duplicate charges may be submitted within 7 days of purchase via Contact Us. Approved refunds are processed by administrators and automatically reverse associated creator earnings and platform commission.</p>
      `,
    },
  };

  const doc = docs[pageKey] || docs.about;
  container.innerHTML = `
    <div class="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-14">
      <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-10">
        <h1 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white mb-6">${esc(doc.title)}</h1>
        <div class="reading-prose">${doc.body}</div>
      </div>
    </div>
  `;
}
