import {
  apiFetch,
  CONTENT_TYPES,
  esc,
  formatDate,
  formatInr,
  getCachedHomeSnapshot,
  HOME_HERO_BANNER,
  LANGUAGES,
  renderContentCard,
  renderCoverImage,
  saveHomeSnapshot,
  showToast,
  store,
} from './api.js';

function formatCompactCount(num) {
  const n = Number(num || 0);
  if (n >= 100000) return `${(n / 100000).toFixed(1).replace(/\.0$/, '')}L+`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K+`;
  return String(n);
}

function getTypeBadgeStyle(contentType = '') {
  const t = String(contentType);
  if (/note/i.test(t)) return { label: 'Notes', cls: 'bg-[#1a73e8] text-white' };
  if (/video|lecture|tutorial/i.test(t)) return { label: 'Lecture', cls: 'bg-[#17a968] text-white' };
  if (/article|research|essay/i.test(t)) return { label: 'Article', cls: 'bg-[#8b3dff] text-white' };
  if (/story|stories/i.test(t)) return { label: 'Story', cls: 'bg-[#f58b0a] text-white' };
  if (/poem|poetry/i.test(t)) return { label: 'Poetry', cls: 'bg-[#e63372] text-white' };
  if (/pdf|book|doc/i.test(t)) return { label: 'PDF', cls: 'bg-[#4f46e5] text-white' };
  return { label: t || 'Resource', cls: 'bg-[#5a1fd8] text-white' };
}

function renderHomeTrendingCard(item) {
  const isVideo = /video|tutorial|lecture/i.test(item.contentType || '');
  const ratingVal = Number(item.avgRating || 0);
  const viewsVal = Number(item.viewsCount || 0);
  const viewsLabel =
    viewsVal >= 1000 ? `${(viewsVal / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(viewsVal);
  const badge = getTypeBadgeStyle(item.contentType);

  return `
    <article class="group shrink-0 w-[195px] sm:w-[225px] lg:w-auto snap-start bg-white dark:bg-[#0D1629] border border-indigo-100/90 dark:border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-[0_4px_14px_rgba(70,80,160,0.06)] dark:shadow-none hover:border-indigo-300 dark:hover:border-violet-500/60 hover:shadow-md transition-all">
      <a href="#/content/${esc(item.slug)}" class="block aspect-[16/10] bg-slate-100 dark:bg-slate-900 overflow-hidden relative">
        ${renderCoverImage(item.coverUrl, item.title, 'aspect-[16/10]')}
        ${
          isVideo
            ? `<div class="absolute inset-0 flex items-center justify-center bg-slate-950/15 group-hover:bg-slate-950/25 transition-colors">
                 <span class="w-10 h-10 rounded-full bg-white/95 text-[#2d3ec9] flex items-center justify-center shadow-lg">
                   <svg class="w-5 h-5 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>
                 </span>
               </div>`
            : ''
        }
        <span class="absolute left-2 bottom-2 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide shadow-sm ${badge.cls}">
          ${esc(badge.label)}
        </span>
      </a>
      <div class="p-2.5 sm:p-3 flex-1 flex flex-col">
        <a href="#/content/${esc(item.slug)}" class="font-bold text-[13px] sm:text-sm text-[#14143c] dark:text-white leading-snug line-clamp-2 hover:text-[#5a1fd8] dark:hover:text-violet-300 transition-colors mb-2.5 flex-1">
          ${esc(item.title)}
        </a>
        <div class="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1.5 text-[11px] sm:text-xs">
          <div class="flex items-center gap-2 text-slate-500 dark:text-slate-400 tabular-nums min-w-0">
            <span class="inline-flex items-center gap-1" title="Views">
              <svg class="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"></path><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"></path></svg>
              ${esc(viewsLabel)}
            </span>
            <span class="inline-flex items-center gap-1" title="Rating">
              <svg class="w-3.5 h-3.5 text-rose-500 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd"></path></svg>
              ${ratingVal > 0 ? ratingVal.toFixed(1) : 'New'}
            </span>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums shrink-0 ${
            item.isFree
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'bg-orange-50 text-[#d9480f] dark:bg-orange-950/60 dark:text-amber-300'
          }">
            ${item.isFree ? 'Free' : formatInr(item.priceInr)}
          </span>
        </div>
      </div>
    </article>
  `;
}

function getCategoryIconSvg(idx) {
  const icons = [
    '<path d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"></path>',
    '<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>',
    '<path d="M8 21h8m-4-4v4m-5-9a5 5 0 0010 0V5H7v7zm0-5H4a1 1 0 00-1 1v1a3 3 0 003 3h1m10-5h3a1 1 0 011 1v1a3 3 0 01-3 3h-1"></path>',
    '<path d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path>',
    '<path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>',
    '<path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>',
  ];
  return icons[idx % icons.length];
}

function renderHomeMarkup(container, data) {
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
      surface:
        'bg-[#eef5ff] hover:bg-[#e2eeff] dark:bg-blue-950/35 dark:hover:bg-blue-950/55 border-blue-200/80 dark:border-blue-900/60',
      iconBg: 'bg-gradient-to-br from-[#3b82f6] to-[#1d63eb]',
      arrowCls: 'text-[#2563eb] bg-white/90 dark:bg-blue-900/70 dark:text-blue-200',
      svg: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>',
    },
    {
      title: 'Lectures',
      sub: 'Video Tutorials',
      href: '#/videos',
      surface:
        'bg-[#ebf9f1] hover:bg-[#ddf4e7] dark:bg-emerald-950/35 dark:hover:bg-emerald-950/55 border-emerald-200/80 dark:border-emerald-900/60',
      iconBg: 'bg-gradient-to-br from-[#22c55e] to-[#0ea865]',
      arrowCls: 'text-[#159958] bg-white/90 dark:bg-emerald-900/70 dark:text-emerald-200',
      svg: '<path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>',
    },
    {
      title: 'Articles',
      sub: 'Essays & Research',
      href: '#/articles',
      surface:
        'bg-[#f3eeff] hover:bg-[#eae0ff] dark:bg-violet-950/35 dark:hover:bg-violet-950/55 border-violet-200/80 dark:border-violet-900/60',
      iconBg: 'bg-gradient-to-br from-[#9353f8] to-[#7432db]',
      arrowCls: 'text-[#7432db] bg-white/90 dark:bg-violet-900/70 dark:text-violet-200',
      svg: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>',
    },
    {
      title: 'Stories',
      sub: 'Short Stories',
      href: '#/poems-stories',
      surface:
        'bg-[#fff6e8] hover:bg-[#ffedd4] dark:bg-amber-950/35 dark:hover:bg-amber-950/55 border-amber-200/80 dark:border-amber-900/60',
      iconBg: 'bg-gradient-to-br from-[#fb923c] to-[#ea7b0c]',
      arrowCls: 'text-[#d97706] bg-white/90 dark:bg-amber-900/70 dark:text-amber-200',
      svg: '<path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>',
    },
    {
      title: 'Poetry',
      sub: 'Poems & Verse',
      href: '#/poems-stories',
      surface:
        'bg-[#ffeff5] hover:bg-[#ffe1ec] dark:bg-rose-950/35 dark:hover:bg-rose-950/55 border-rose-200/80 dark:border-rose-900/60',
      iconBg: 'bg-gradient-to-br from-[#f43f7a] to-[#d92363]',
      arrowCls: 'text-[#d92363] bg-white/90 dark:bg-rose-900/70 dark:text-rose-200',
      svg: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>',
    },
    {
      title: 'Community',
      sub: 'Join & Discuss',
      href: '#/creators',
      surface:
        'bg-[#e9f9f9] hover:bg-[#d8f4f4] dark:bg-teal-950/35 dark:hover:bg-teal-950/55 border-teal-200/80 dark:border-teal-900/60',
      iconBg: 'bg-gradient-to-br from-[#14b8b8] to-[#0d9696]',
      arrowCls: 'text-[#0d9494] bg-white/90 dark:bg-teal-900/70 dark:text-teal-200',
      svg: '<path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path>',
    },
  ];

  const categoryIconColors = [
    'text-[#2563eb] dark:text-blue-400',
    'text-[#1d74f5] dark:text-sky-400',
    'text-[#eab308] dark:text-amber-400',
    'text-[#7c3aed] dark:text-violet-400',
    'text-[#9333ea] dark:text-purple-400',
    'text-[#f59e0b] dark:text-yellow-400',
  ];

  const popularCategories = (data.categories || []).slice(0, 6);
  const trendingItems = (data.trending || []).slice(0, 4);

  container.innerHTML = `
    ${
      announcement
        ? `<div class="bg-[#1b1a88] text-white text-xs sm:text-sm py-2 px-4 text-center">
             <div class="max-w-7xl mx-auto">${esc(announcement)}</div>
           </div>`
        : ''
    }

    <!-- Sky-Periwinkle Hero + Responsive Home Canvas (Matches Mobile Image 1 & Desktop Image 2) -->
    <div class="bg-gradient-to-b from-[#dceaff] via-[#eef4ff] to-[#f4f7ff] dark:from-[#0b152b] dark:via-[#0e182e] dark:to-[#0B1120] pt-2 sm:pt-4 lg:pt-5 pb-7 sm:pb-10">
      <div class="max-w-[1440px] mx-auto px-3 sm:px-5 lg:px-8 space-y-3.5 sm:space-y-5">

        <!-- HERO SECTION -->
        <section class="relative rounded-2xl lg:rounded-3xl overflow-hidden border border-indigo-200/75 dark:border-slate-800 shadow-[0_12px_34px_rgba(65,70,165,0.10)] dark:shadow-none bg-gradient-to-br from-[#e2eeff] via-[#d7e8ff] to-[#c7e0ff] dark:from-[#0e1933] dark:via-[#111e3d] dark:to-[#0b152b]">
          <!-- Hero Desk Artwork (Right-Aligned on BOTH Mobile & Desktop like Images 1 & 2) -->
          <img
            src="${HOME_HERO_BANNER}"
            alt="ScholarPress study desk with books, glowing lightbulb, laptop, graduation cap, and globe"
            fetchpriority="high"
            decoding="async"
            class="absolute right-0 top-0 h-[230px] sm:h-[285px] lg:h-full w-[72%] sm:w-[68%] lg:w-full object-cover object-[84%_center] sm:object-[80%_center] lg:object-right select-none pointer-events-none"
          />
          <!-- Directional Left Readability Gradient -->
          <div class="absolute inset-0 bg-gradient-to-r from-[#e6f0ff] via-[#e6f0ff]/95 via-[44%] sm:via-[46%] lg:via-[42%] to-transparent dark:from-[#0c162d] dark:via-[#0d1831]/94 dark:via-[46%] dark:to-[#0d1831]/20 pointer-events-none"></div>
          <!-- Mobile Lower Surface Fade so Search & CTAs sit cleanly -->
          <div class="lg:hidden absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#e8f1ff] via-[#e8f1ff]/90 to-transparent dark:from-[#0c162d] dark:via-[#0c162d]/90 dark:to-transparent pointer-events-none"></div>

          <!-- Foreground Content -->
          <div class="relative z-10 px-3.5 sm:px-7 lg:px-12 pt-4 pb-5 sm:py-8 lg:py-11">
            <!-- Top Badge -->
            <div class="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-bold text-[#14143c] dark:text-slate-100 bg-white/95 dark:bg-slate-900/85 border border-indigo-100 dark:border-slate-700/80 rounded-full px-3 py-1 shadow-sm mb-2.5 sm:mb-4">
              <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>
              <span>India's Largest Education Platform</span>
            </div>

            <!-- Headline Block (Left Column on Mobile & Desktop) -->
            <div class="max-w-[58%] sm:max-w-[56%] lg:max-w-[55%]">
              <h1 class="font-display text-[1.75rem] sm:text-4xl lg:text-[3.4rem] font-extrabold tracking-tight text-[#0f0f4d] dark:text-white leading-[1.06]">
                Welcome to <br class="sm:hidden" /><span class="text-[#5a1fd8] dark:text-violet-400">ScholarPress</span>
              </h1>
              <p class="text-[15px] sm:text-xl lg:text-[1.75rem] font-bold text-[#14143c] dark:text-slate-100 mt-1 sm:mt-1.5 leading-snug">
                Learn, Create, Share &amp; Earn
              </p>
              <p class="text-[11.5px] sm:text-sm lg:text-[15px] text-[#2b2b4a] dark:text-slate-300 leading-snug sm:leading-relaxed mt-1.5 sm:mt-2.5 max-w-lg">
                Explore notes, lectures, articles, poems and stories. Share your knowledge with the world and grow together.
              </p>
            </div>

            <!-- Search Bar (Full width on Mobile like Image 1, max-w-xl on Desktop like Image 2) -->
            <form id="hero-search-form" class="mt-4 sm:mt-6 flex items-center bg-white dark:bg-[#0B1120] border border-indigo-200/80 dark:border-slate-700 rounded-full p-1 shadow-[0_6px_18px_rgba(80,80,160,0.13)] dark:shadow-none w-full lg:max-w-[540px]">
              <svg class="w-4 h-4 sm:w-5 sm:h-5 text-slate-500 ml-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
              <input
                type="search"
                id="hero-search-input"
                placeholder="Search for notes, lectures, articles..."
                class="flex-1 min-w-0 bg-transparent border-0 outline-none focus:outline-none px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
              />
              <button
                type="submit"
                class="min-h-[34px] sm:min-h-[38px] px-4 sm:px-7 py-1.5 sm:py-2 text-xs sm:text-sm font-bold rounded-full bg-gradient-to-r from-[#5a1fd8] to-[#7429e8] hover:from-[#4a14c4] hover:to-[#6320d4] text-white shadow-sm transition-colors whitespace-nowrap shrink-0"
              >
                Search
              </button>
            </form>

            <!-- Action Buttons (2 Side-by-Side Pills on Mobile & Desktop) -->
            <div class="mt-3 sm:mt-4 grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5 sm:gap-3.5 max-w-md sm:max-w-none">
              <a
                href="${uploadHref}"
                class="min-h-[40px] sm:min-h-[44px] inline-flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-6 py-2 text-xs sm:text-sm font-bold rounded-full bg-gradient-to-r from-[#5a1fd8] to-[#7429e8] hover:from-[#4a14c4] hover:to-[#6320d4] text-white shadow-[0_8px_18px_rgba(90,31,216,0.28)] transition-colors whitespace-nowrap"
              >
                <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                <span>Upload Content →</span>
              </a>
              <a
                href="#/explore"
                class="min-h-[40px] sm:min-h-[44px] inline-flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-6 py-2 text-xs sm:text-sm font-bold rounded-full bg-white/95 hover:bg-white dark:bg-slate-900/90 dark:hover:bg-slate-900 border border-[#5a1fd8]/55 dark:border-violet-400/50 text-[#0f0f4d] dark:text-white shadow-sm transition-colors whitespace-nowrap"
              >
                <svg class="w-4 h-4 text-[#5a1fd8] dark:text-violet-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
                <span>Explore Resources</span>
              </a>
            </div>
          </div>
        </section>

        <!-- 6-TILE QUICK CATEGORY STRIP (2x3 on Mobile Image 1, 6-col Single Row on Desktop Image 2) -->
        <section aria-label="Quick Categories" class="lg:bg-white lg:dark:bg-[#111A2E] lg:rounded-2xl lg:p-3 lg:border lg:border-indigo-100/90 lg:dark:border-slate-800 lg:shadow-[0_10px_28px_rgba(70,80,160,0.08)] lg:dark:shadow-none">
          <div class="grid grid-cols-2 lg:grid-cols-6 gap-2.5 sm:gap-3">
            ${quickFormatTiles
              .map(
                (tile) => `
              <a href="${tile.href}" class="group flex items-center gap-2.5 sm:gap-3 rounded-2xl px-2.5 sm:px-3 py-2.5 sm:py-3 border shadow-[0_4px_12px_rgba(70,80,160,0.05)] lg:shadow-none transition-all ${tile.surface}">
                <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${tile.iconBg} text-white flex items-center justify-center shrink-0 shadow-sm">
                  <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${tile.svg}</svg>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="font-bold text-[13px] sm:text-sm text-[#14143c] dark:text-white truncate leading-tight">${tile.title}</div>
                  <div class="text-[10.5px] sm:text-[11px] text-slate-600 dark:text-slate-400 truncate mt-0.5">${tile.sub}</div>
                </div>
                <span class="w-6 h-6 rounded-full ${tile.arrowCls} flex items-center justify-center shrink-0 shadow-xs group-hover:translate-x-0.5 transition-transform" aria-hidden="true">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
                </span>
              </a>
            `
              )
              .join('')}
          </div>
        </section>

        <!-- STATS + BECOME A CREATOR STRIP (3-Stat Bar on Mobile Image 1; 4-Stat + Gradient Banner on Desktop Image 2) -->
        <section class="bg-white/95 dark:bg-[#111A2E] rounded-2xl border border-indigo-100/90 dark:border-slate-800 shadow-[0_8px_24px_rgba(70,80,160,0.07)] dark:shadow-none overflow-hidden lg:grid lg:grid-cols-12">
          <div class="lg:col-span-7 grid grid-cols-3 lg:grid-cols-4 divide-x divide-indigo-100/90 dark:divide-slate-800">
            <div class="px-2.5 sm:px-4 py-3 sm:py-4 flex items-center justify-center sm:justify-start gap-2 sm:gap-3">
              <div class="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-[#2563eb] dark:text-blue-400 flex items-center justify-center shrink-0">
                <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"></path></svg>
              </div>
              <div class="min-w-0">
                <div class="font-display text-sm sm:text-lg font-extrabold text-[#0f0f4d] dark:text-white tabular-nums leading-tight">${esc(formatCompactCount(stats.registeredMembers))}</div>
                <div class="text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-400 truncate">Happy Users</div>
              </div>
            </div>
            <div class="px-2.5 sm:px-4 py-3 sm:py-4 flex items-center justify-center sm:justify-start gap-2 sm:gap-3">
              <div class="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-[#3b5bdb] dark:text-indigo-400 flex items-center justify-center shrink-0">
                <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"></path></svg>
              </div>
              <div class="min-w-0">
                <div class="font-display text-sm sm:text-lg font-extrabold text-[#0f0f4d] dark:text-white tabular-nums leading-tight">${esc(formatCompactCount(stats.publishedWorks))}</div>
                <div class="text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-400 truncate">Study Resources</div>
              </div>
            </div>
            <div class="px-2.5 sm:px-4 py-3 sm:py-4 flex items-center justify-center sm:justify-start gap-2 sm:gap-3">
              <div class="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-[#1a73e8] dark:text-sky-400 flex items-center justify-center shrink-0">
                <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"></path></svg>
              </div>
              <div class="min-w-0">
                <div class="font-display text-sm sm:text-lg font-extrabold text-[#0f0f4d] dark:text-white tabular-nums leading-tight">${esc(formatCompactCount(stats.activeCreators))}</div>
                <div class="text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-400 truncate">Active Creators</div>
              </div>
            </div>
            <!-- 4th Stat visible on Desktop matching Image 2 -->
            <div class="hidden lg:flex px-4 py-4 items-center gap-3">
              <div class="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-400 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>
              </div>
              <div class="min-w-0">
                <div class="font-display text-lg font-extrabold text-[#0f0f4d] dark:text-white tabular-nums leading-tight">${creatorKeep}%</div>
                <div class="text-[11px] text-slate-600 dark:text-slate-400 truncate">Creator Share</div>
              </div>
            </div>
          </div>

          <!-- Desktop Gradient Become a Creator Pill Banner (Image 2 Right Side) -->
          <div class="hidden lg:flex lg:col-span-5 bg-gradient-to-r from-[#2863eb] via-[#4a36dc] to-[#6320df] text-white px-5 py-3.5 items-center justify-between gap-4 rounded-l-full">
            <div class="flex items-center gap-3 min-w-0 pl-1">
              <div class="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <svg class="w-6 h-6 text-[#ffc830]" fill="currentColor" viewBox="0 0 24 24"><path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"></path></svg>
              </div>
              <div class="min-w-0">
                <div class="font-bold text-sm leading-snug">Share Your Knowledge</div>
                <div class="text-xs text-indigo-100/95">Earn from Your Content</div>
              </div>
            </div>
            <a
              href="${creatorCtaHref}"
              class="min-h-[38px] inline-flex items-center justify-center px-5 py-2 rounded-full bg-[#ffc422] hover:bg-[#f2b312] text-[#14143c] font-extrabold text-xs shadow-md transition-colors whitespace-nowrap shrink-0"
            >
              ${creatorCtaLabel} →
            </a>
          </div>
        </section>

        <!-- MAIN SHOWCASE: TRENDING CONTENT + POPULAR CATEGORIES (Stacked on Mobile Image 1, 9/3 Split on Desktop Image 2) -->
        <section class="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-stretch">
          <!-- Trending Content Panel -->
          <div class="lg:col-span-8 xl:col-span-9 lg:bg-white lg:dark:bg-[#111A2E] lg:rounded-2xl lg:border lg:border-indigo-100/90 lg:dark:border-slate-800 lg:shadow-[0_8px_24px_rgba(70,80,160,0.07)] lg:dark:shadow-none lg:p-5">
            <div class="flex items-center justify-between gap-4 mb-3 lg:mb-4">
              <div class="flex items-center gap-2">
                <span class="text-orange-500 flex items-center justify-center shrink-0">
                  <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clip-rule="evenodd"></path></svg>
                </span>
                <h2 class="font-display text-lg sm:text-xl font-extrabold text-[#0f0f4d] dark:text-white">Trending Content</h2>
              </div>
              <a href="#/explore?sort=popular" class="text-xs sm:text-sm font-bold text-[#2563eb] dark:text-violet-400 hover:underline whitespace-nowrap shrink-0">
                View All →
              </a>
            </div>
            <!-- Horizontal Swipeable Row on Mobile (Image 1), Crisp 4-Card Grid on Desktop (Image 2) -->
            <div class="flex lg:grid lg:grid-cols-4 gap-3 sm:gap-3.5 overflow-x-auto lg:overflow-visible snap-x snap-mandatory pb-1 lg:pb-0 -mx-1 px-1 lg:mx-0 lg:px-0">
              ${
                trendingItems.length
                  ? trendingItems.map(renderHomeTrendingCard).join('')
                  : `<p class="col-span-full w-full text-sm text-slate-500 dark:text-slate-400 py-8 text-center bg-white dark:bg-[#111A2E] rounded-2xl">No published resources yet. Be the first to share your notes or video lecture.</p>`
              }
            </div>
          </div>

          <!-- Popular Categories Card -->
          <aside class="lg:col-span-4 xl:col-span-3 bg-white dark:bg-[#111A2E] rounded-2xl border border-indigo-100/90 dark:border-slate-800 shadow-[0_8px_24px_rgba(70,80,160,0.07)] dark:shadow-none p-4 sm:p-5 flex flex-col">
            <div class="flex items-center justify-between gap-3 mb-2.5 sm:mb-3">
              <h2 class="font-display text-lg sm:text-xl font-extrabold text-[#0f0f4d] dark:text-white">Popular Categories</h2>
              <a href="#/categories" class="text-xs font-bold text-[#2563eb] dark:text-violet-400 hover:underline whitespace-nowrap shrink-0">View All →</a>
            </div>
            <ul class="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
              ${
                popularCategories.length
                  ? popularCategories
                      .map(
                        (cat, idx) => `
                    <li>
                      <a href="#/explore?category=${esc(cat.slug)}" class="group flex items-center justify-between gap-3 py-2.5 hover:text-[#5a1fd8] dark:hover:text-violet-300 transition-colors">
                        <div class="flex items-center gap-3 min-w-0">
                          <span class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${categoryIconColors[idx % categoryIconColors.length]}">
                            <svg class="w-4 h-4 sm:w-[18px] sm:h-[18px]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${getCategoryIconSvg(idx)}</svg>
                          </span>
                          <span class="text-sm font-semibold text-[#14143c] dark:text-slate-100 group-hover:text-[#5a1fd8] dark:group-hover:text-violet-300 truncate">${esc(cat.name)}</span>
                        </div>
                        <span class="w-5 h-5 rounded-full bg-indigo-50 dark:bg-slate-800 text-[#2563eb] dark:text-sky-400 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform" aria-hidden="true">
                          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                        </span>
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

    <!-- DEEP ROYAL INDIGO TRUST & TAGLINE BAR (Exact Match to Mobile Image 1 & Desktop Image 2) -->
    <section class="bg-gradient-to-r from-[#17177a] via-[#261fa0] to-[#3421b5] text-white">
      <div class="max-w-[1440px] mx-auto px-3.5 sm:px-6 lg:px-8 py-5 sm:py-6">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 lg:gap-6">
          <div class="grid grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-5 flex-1 lg:divide-x lg:divide-white/15">
            <div class="flex items-center gap-2 sm:gap-3">
              <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-white/10 text-sky-300 flex items-center justify-center shrink-0">
                <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
              </div>
              <div class="min-w-0">
                <div class="font-bold text-[11px] sm:text-sm leading-tight truncate">Secure &amp; Trusted</div>
                <div class="text-[9.5px] sm:text-xs text-indigo-200/90 truncate">Your data is safe</div>
              </div>
            </div>
            <div class="flex items-center gap-2 sm:gap-3 lg:pl-5">
              <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-white/10 text-sky-300 flex items-center justify-center shrink-0">
                <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
              </div>
              <div class="min-w-0">
                <div class="font-bold text-[11px] sm:text-sm leading-tight truncate">Instant Access</div>
                <div class="text-[9.5px] sm:text-xs text-indigo-200/90 truncate">Read &amp; Watch Anytime</div>
              </div>
            </div>
            <!-- 3rd item (Fair Earnings) visible on Desktop like Image 2 -->
            <div class="hidden lg:flex items-center gap-3 lg:pl-5">
              <div class="w-10 h-10 rounded-xl bg-white/10 text-sky-300 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              </div>
              <div class="min-w-0">
                <div class="font-bold text-sm leading-tight truncate">Fair Earnings</div>
                <div class="text-xs text-indigo-200/90 truncate">Keep ${creatorKeep}% (${commissionRate}% fee)</div>
              </div>
            </div>
            <div class="flex items-center gap-2 sm:gap-3 lg:pl-5">
              <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-white/10 text-sky-300 flex items-center justify-center shrink-0">
                <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
              </div>
              <div class="min-w-0">
                <div class="font-bold text-[11px] sm:text-sm leading-tight truncate">24×7 Support</div>
                <div class="text-[9.5px] sm:text-xs text-indigo-200/90 truncate">We're here to help</div>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-center lg:justify-end lg:pl-6 lg:border-l lg:border-white/20 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-white/15">
            <div class="text-center lg:text-right">
              <p class="font-script font-bold text-2xl sm:text-[1.75rem] text-white leading-none tracking-wide">
                Together for a <span class="text-[#ffd23f]">Smarter Education!</span>
              </p>
              <svg class="w-44 h-2.5 mx-auto lg:ml-auto lg:mr-0 mt-0.5 text-[#ffd23f]" viewBox="0 0 180 10" fill="none"><path d="M3 7C46 2 128 1.5 177 6.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
            </div>
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
}

export async function renderHomePage(container) {
  const cached = getCachedHomeSnapshot();
  if (cached) {
    renderHomeMarkup(container, cached);
  } else {
    container.innerHTML = `
      <div class="bg-gradient-to-b from-[#dceaff] via-[#eef4ff] to-[#f4f7ff] dark:from-[#0b152b] dark:via-[#0e182e] dark:to-[#0B1120] py-5">
        <div class="max-w-[1440px] mx-auto px-3 sm:px-6 lg:px-8 animate-pulse space-y-4">
          <div class="h-64 sm:h-80 bg-white/70 dark:bg-slate-800/80 rounded-2xl"></div>
          <div class="grid grid-cols-2 lg:grid-cols-6 gap-2.5">
            <div class="h-16 bg-white/70 dark:bg-slate-800/80 rounded-2xl"></div>
            <div class="h-16 bg-white/70 dark:bg-slate-800/80 rounded-2xl"></div>
            <div class="h-16 bg-white/70 dark:bg-slate-800/80 rounded-2xl"></div>
            <div class="h-16 bg-white/70 dark:bg-slate-800/80 rounded-2xl"></div>
            <div class="h-16 bg-white/70 dark:bg-slate-800/80 rounded-2xl"></div>
            <div class="h-16 bg-white/70 dark:bg-slate-800/80 rounded-2xl"></div>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div class="h-56 bg-white/70 dark:bg-slate-800/80 rounded-2xl"></div>
            <div class="h-56 bg-white/70 dark:bg-slate-800/80 rounded-2xl"></div>
            <div class="h-56 bg-white/70 dark:bg-slate-800/80 rounded-2xl"></div>
            <div class="h-56 bg-white/70 dark:bg-slate-800/80 rounded-2xl"></div>
          </div>
        </div>
      </div>
    `;
  }

  try {
    const data = await apiFetch('/api/catalog/home');
    saveHomeSnapshot(data);
    renderHomeMarkup(container, data);
  } catch (err) {
    if (!cached) {
      container.innerHTML = `
        <div class="max-w-3xl mx-auto px-4 py-16 text-center">
          <h2 class="font-display text-2xl font-semibold mb-2">Unable to load catalog</h2>
          <p class="text-sm text-slate-600 dark:text-slate-400 mb-6">${esc(err.message)}</p>
          <button onclick="location.reload()" class="px-4 py-2 text-sm font-semibold rounded-lg bg-[#5a1fd8] text-white">Retry</button>
        </div>
      `;
    }
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
