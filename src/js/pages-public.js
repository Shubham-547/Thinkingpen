import {
  apiFetch,
  CONTENT_TYPES,
  esc,
  formatDate,
  HERO_LIBRARY_IMAGE,
  LANGUAGES,
  renderContentCard,
  showToast,
  store,
} from './api.js';

export async function renderHomePage(container) {
  container.innerHTML = `
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div class="animate-pulse space-y-6">
        <div class="h-64 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="h-72 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
          <div class="h-72 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
          <div class="h-72 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
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

    container.innerHTML = `
      ${
        announcement
          ? `<div class="bg-[#0F2547] text-white text-sm py-2.5 px-4 text-center">
               <div class="max-w-7xl mx-auto">${esc(announcement)}</div>
             </div>`
          : ''
      }

      <!-- Hero Section (2-column stretched editorial split) -->
      <section class="bg-white dark:bg-[#0F172A] border-b border-slate-200 dark:border-slate-800">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
            <div class="lg:col-span-7 flex flex-col justify-center">
              <p class="text-xs sm:text-sm font-medium text-[#1B3B6F] dark:text-sky-400 mb-2.5 sm:mb-3">
                Educational Publishing &amp; Knowledge Marketplace
              </p>
              <h1 class="font-display text-3xl sm:text-4xl lg:text-[3.15rem] font-semibold tracking-tight text-slate-900 dark:text-white leading-[1.12] mb-4 sm:mb-5">
                Share Your Knowledge. Publish Your Ideas. Earn From Your Creativity.
              </h1>
              <p class="text-sm sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl mb-6 sm:mb-7">
                Discover educational resources, share your knowledge, and turn your content into an opportunity. Publish study notes, PDF monographs, articles, e-books, research papers, video lectures, poems, and stories.
              </p>

              <!-- Direct Catalog Search -->
              <form id="hero-search-form" class="flex flex-col sm:flex-row gap-2.5 max-w-xl mb-6 sm:mb-7">
                <input
                  type="search"
                  id="hero-search-input"
                  placeholder="Search notes, PDFs, calculus, UPSC, poetry, or creators..."
                  class="flex-1 min-h-[44px] px-4 py-3 text-sm bg-slate-50 dark:bg-[#111A2E] border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
                <button
                  type="submit"
                  class="min-h-[44px] px-5 py-3 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors whitespace-nowrap shrink-0"
                >
                  Search Catalog
                </button>
              </form>

              <div class="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
                <a
                  href="#/explore"
                  class="min-h-[44px] flex items-center justify-center px-5 py-2.5 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-950 transition-colors whitespace-nowrap shrink-0"
                >
                  Explore Content
                </a>
                <a
                  href="${store.user?.role === 'creator' || store.user?.role === 'admin' ? '#/creator/upload' : '#/become-creator'}"
                  class="min-h-[44px] flex items-center justify-center px-5 py-2.5 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                >
                  Start Publishing
                </a>
              </div>
            </div>

            <div class="lg:col-span-5">
              <div class="h-full min-h-[220px] sm:min-h-[280px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 relative">
                <img
                  src="${HERO_LIBRARY_IMAGE}"
                  alt="Modern university reading hall and educational library"
                  referrerpolicy="no-referrer"
                  class="w-full h-full object-cover"
                />
                <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/40 to-transparent p-4 sm:p-6 text-white">
                  <p class="text-xs text-slate-200 mb-1">Transparent Creator Economics</p>
                  <p class="font-display text-base sm:text-lg font-medium leading-snug">
                    Keep up to ${creatorKeep}% of every paid sale with instant INR ledger tracking.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Full-width quantitative summary strip below hero split -->
          <div class="mt-8 sm:mt-10 pt-6 sm:pt-8 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            <div>
              <div class="font-mono text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">${stats.publishedWorks ?? 0}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Published Resources</div>
            </div>
            <div>
              <div class="font-mono text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">${stats.activeCreators ?? 0}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Verified Educators &amp; Authors</div>
            </div>
            <div>
              <div class="font-mono text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">${creatorKeep}%</div>
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Default Creator Revenue Share</div>
            </div>
            <div>
              <div class="font-mono text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">10</div>
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Supported Publishing Formats</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Format Quick Navigation Strip -->
      <section class="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0D1526]">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center gap-5 sm:gap-6 overflow-x-auto no-scrollbar touch-scroll-x text-sm font-medium text-slate-600 dark:text-slate-300">
          <a href="#/notes" class="py-1 hover:text-[#0F2547] dark:hover:text-white whitespace-nowrap shrink-0">Notes</a>
          <a href="#/study-materials" class="py-1 hover:text-[#0F2547] dark:hover:text-white whitespace-nowrap shrink-0">Study Materials</a>
          <a href="#/pdf-library" class="py-1 hover:text-[#0F2547] dark:hover:text-white whitespace-nowrap shrink-0">PDF Library</a>
          <a href="#/articles" class="py-1 hover:text-[#0F2547] dark:hover:text-white whitespace-nowrap shrink-0">Articles</a>
          <a href="#/videos" class="py-1 hover:text-[#0F2547] dark:hover:text-white whitespace-nowrap shrink-0">Video Lectures</a>
          <a href="#/poems-stories" class="py-1 hover:text-[#0F2547] dark:hover:text-white whitespace-nowrap shrink-0">Poems &amp; Stories</a>
          <a href="#/creators" class="py-1 hover:text-[#0F2547] dark:hover:text-white whitespace-nowrap shrink-0">Creators</a>
        </div>
      </section>

      <!-- Trending Content -->
      <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <div class="flex items-end justify-between gap-4 mb-6 sm:mb-7">
          <div>
            <h2 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">Trending Resources</h2>
            <p class="text-sm text-slate-600 dark:text-slate-400 mt-1">Most-read notes, monographs, lectures, and literary works this week.</p>
          </div>
          <a href="#/explore?sort=popular" class="text-sm font-semibold text-[#0F2547] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0">View all →</a>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          ${(data.trending || []).map(renderContentCard).join('') || '<p class="text-slate-500">No published content yet.</p>'}
        </div>
      </section>

      <!-- Featured Categories -->
      <section class="bg-white dark:bg-[#0F172A] border-y border-slate-200 dark:border-slate-800 py-10 sm:py-14">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex items-end justify-between gap-4 mb-6 sm:mb-7">
            <div>
              <h2 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">Featured Categories</h2>
              <p class="text-sm text-slate-600 dark:text-slate-400 mt-1">Browse academic disciplines, competitive exam tracks, and creative literature.</p>
            </div>
            <a href="#/categories" class="text-sm font-semibold text-[#0F2547] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0">All subjects →</a>
          </div>
          <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
            ${(data.categories || [])
              .filter((c) => c.isFeatured)
              .map(
                (cat) => `
              <a href="#/explore?category=${esc(cat.slug)}" class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111A2E] hover:border-[#0F2547] dark:hover:border-sky-400 transition-colors flex flex-col justify-between">
                <div>
                  <h3 class="font-semibold text-slate-900 dark:text-white text-sm mb-1">${esc(cat.name)}</h3>
                  <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">${esc(cat.description || '')}</p>
                </div>
                <div class="mt-3 pt-2 border-t border-slate-200/70 dark:border-slate-800 text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  ${cat.contentCount} ${cat.contentCount === 1 ? 'work' : 'works'}
                </div>
              </a>
            `
              )
              .join('')}
          </div>
        </div>
      </section>

      <!-- Recently Published -->
      <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <div class="flex items-end justify-between gap-4 mb-6 sm:mb-7">
          <div>
            <h2 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">Recently Published</h2>
            <p class="text-sm text-slate-600 dark:text-slate-400 mt-1">Freshly approved study notes, research papers, lectures, and stories.</p>
          </div>
          <a href="#/explore?sort=latest" class="text-sm font-semibold text-[#0F2547] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0">Explore latest →</a>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          ${(data.recent || []).map(renderContentCard).join('')}
        </div>
      </section>

      <!-- Featured Creators -->
      <section class="bg-white dark:bg-[#0F172A] border-t border-slate-200 dark:border-slate-800 py-10 sm:py-14">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex items-end justify-between gap-4 mb-6 sm:mb-7">
            <div>
              <h2 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">Featured Creators</h2>
              <p class="text-sm text-slate-600 dark:text-slate-400 mt-1">Independent educators, researchers, and authors publishing on ScholarPress.</p>
            </div>
            <a href="#/creators" class="text-sm font-semibold text-[#0F2547] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0">All creators →</a>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            ${(data.featuredCreators || [])
              .map(
                (cr) => `
              <a href="#/creator-profile/${cr.id}" class="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-[#111A2E] hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-3 mb-3">
                    <div class="w-11 h-11 rounded-full bg-[#0F2547] dark:bg-sky-900 text-white font-display font-semibold flex items-center justify-center shrink-0">
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

      <!-- How It Works -->
      <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div class="mb-8 sm:mb-10 max-w-2xl">
          <h2 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">How It Works</h2>
          <p class="text-sm text-slate-600 dark:text-slate-400 mt-1.5">
            Built for independent teachers, researchers, students, and authors who want full control over pricing and readership.
          </p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-8">
          <div class="p-6 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
            <div class="font-mono text-sm font-semibold text-[#1B3B6F] dark:text-sky-400 mb-3">01. Create an Account</div>
            <h3 class="font-display text-xl font-semibold text-slate-900 dark:text-white mb-2">Register in seconds</h3>
            <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Sign in with Google or email to browse free study notes, build your personal reading library, or activate your Creator publishing profile.
            </p>
          </div>
          <div class="p-6 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
            <div class="font-mono text-sm font-semibold text-[#1B3B6F] dark:text-sky-400 mb-3">02. Publish Your Content</div>
            <h3 class="font-display text-xl font-semibold text-slate-900 dark:text-white mb-2">Upload any format</h3>
            <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Author rich-text notes and poems, attach protected PDFs or recorded video lectures, set Free or INR pricing (₹10–₹50,000), and preview before submitting.
            </p>
          </div>
          <div class="p-6 rounded-xl bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800">
            <div class="font-mono text-sm font-semibold text-[#1B3B6F] dark:text-sky-400 mb-3">03. Earn From Your Knowledge</div>
            <h3 class="font-display text-xl font-semibold text-slate-900 dark:text-white mb-2">Transparent INR payouts</h3>
            <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Every verified purchase automatically credits your Creator Wallet after the configurable ${commissionRate}% platform fee. Track your ledger and withdraw via UPI or bank transfer.
            </p>
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
        <button onclick="location.reload()" class="px-4 py-2 text-sm font-semibold rounded-lg bg-[#0F2547] text-white">Retry</button>
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
