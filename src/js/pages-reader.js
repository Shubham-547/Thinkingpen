import {
  apiFetch,
  esc,
  formatBytes,
  formatDate,
  formatDurationShort,
  formatInr,
  getAuthToken,
  openImageLightbox,
  openModal,
  renderContentCard,
  renderCoverImage,
  resolveVideoEmbed,
  showToast,
  store,
} from './api.js';
import { clearTrackedContent, setTrackedContent } from './tracker.js';

let activeScrollHandler = null;
let activeProtectionCleanup = null;
let activeVideoProgressCleanup = null;

export function cleanupReaderProgress() {
  clearTrackedContent();
  if (activeScrollHandler) {
    window.removeEventListener('scroll', activeScrollHandler);
    activeScrollHandler = null;
  }
  if (activeProtectionCleanup) {
    activeProtectionCleanup();
    activeProtectionCleanup = null;
  }
  if (activeVideoProgressCleanup) {
    activeVideoProgressCleanup();
    activeVideoProgressCleanup = null;
  }
  const bar = document.getElementById('reading-progress-bar');
  if (bar) bar.remove();
}

export async function renderContentDetailPage(container, slug) {
  cleanupReaderProgress();
  container.innerHTML = `<div class="max-w-6xl mx-auto px-4 py-14 text-sm text-slate-500">Loading publication...</div>`;

  try {
    const prevHash = typeof window !== 'undefined' && window.__spPrevRouteHash ? String(window.__spPrevRouteHash).slice(0, 140) : '';
    const detailUrl = prevHash
      ? `/api/catalog/contents/${encodeURIComponent(slug)}?src=${encodeURIComponent(prevHash)}`
      : `/api/catalog/contents/${encodeURIComponent(slug)}`;
    const data = await apiFetch(detailUrl);
    const c = data.content;
    const creator = data.creator;
    const files = data.files || [];
    const authToken = await getAuthToken();

    setTrackedContent(c.id, c.title);

    // Reading progress bar
    const progressEl = document.createElement('div');
    progressEl.id = 'reading-progress-bar';
    document.body.appendChild(progressEl);
    activeScrollHandler = () => {
      const h = document.documentElement;
      const denom = Math.max(1, h.scrollHeight - h.clientHeight);
      progressEl.style.width = `${Math.min(100, (window.scrollY / denom) * 100)}%`;
    };
    window.addEventListener('scroll', activeScrollHandler, { passive: true });

    // Extract headings for Table of Contents when unlocked
    let tocItems = [];
    let processedBody = c.bodyHtml || '';
    if (c.hasAccess && processedBody) {
      let idx = 0;
      processedBody = processedBody.replace(/<(h[23])([^>]*)>([\s\S]*?)<\/\1>/gi, (_m, tag, attrs, inner) => {
        idx += 1;
        const headingId = `sec-${idx}`;
        const plain = inner.replace(/<[^>]+>/g, '').trim();
        tocItems.push({ id: headingId, level: tag.toLowerCase(), text: plain });
        return `<${tag} id="${headingId}"${attrs}>${inner}</${tag}>`;
      });
    }

    const pdfFiles = files.filter((f) => f.fileType === 'pdf');
    const videoFiles = files.filter((f) => f.fileType === 'video');
    const imageFiles = files.filter((f) => f.fileType === 'image');
    const docFiles = files.filter((f) => f.fileType === 'document');
    const displayAuthorName = (c.authorName && c.authorName.trim()) || creator.name;
    const isPaidContent = !c.isFree && Number(c.priceInr) > 0;
    const viewerWatermark = isPaidContent
      ? store.user
        ? `ScholarPress · UID ${store.user.publicUid || store.user.id} · ${store.user.email || store.user.name || 'Licensed'}`
        : 'ScholarPress · Protected Publication'
      : '';

    const withAuthParam = (url) => {
      if (!url) return '';
      if (url.includes('ft=')) return url;
      if (!authToken) return url;
      return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(authToken)}`;
    };

    const withThumbWidth = (url, width = 480) => {
      const authed = withAuthParam(url);
      if (!authed) return '';
      return `${authed}${authed.includes('?') ? '&' : '?'}w=${width}`;
    };

    let isBookmarked = Boolean(data.userState?.isBookmarked);
    let isLiked = Boolean(data.userState?.isLiked);
    let likesCount = Number(c.likesCount || 0);
    let isFollowing = Boolean(data.userState?.isFollowingCreator);

    container.innerHTML = `
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        <!-- Breadcrumb -->
        <nav class="text-xs text-slate-500 dark:text-slate-400 mb-5 sm:mb-6 flex items-center gap-2 flex-wrap">
          <a href="#/" class="hover:text-slate-900 dark:hover:text-white">Home</a>
          <span>/</span>
          <a href="#/explore" class="hover:text-slate-900 dark:hover:text-white">Explore</a>
          ${c.categorySlug ? `<span>/</span><a href="#/explore?category=${esc(c.categorySlug)}" class="hover:text-slate-900 dark:hover:text-white">${esc(c.categoryName)}</a>` : ''}
          <span>/</span>
          <span class="text-slate-800 dark:text-slate-200 truncate max-w-[200px] sm:max-w-xs">${esc(c.title)}</span>
        </nav>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-start">
          <!-- Main Reading & Media Column -->
          <div class="lg:col-span-8 space-y-6 sm:space-y-8 min-w-0">
            <header class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              ${c.coverImageUrl ? renderCoverImage(c.coverImageUrl, c.title, 'aspect-[16/8] sm:aspect-[16/7]') : ''}
              <div class="p-4 sm:p-8">
                <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mb-3">
                  <span>${esc(c.categoryName || 'General')}</span>
                  ${c.subjectName ? `<span aria-hidden="true">·</span><span>${esc(c.subjectName)}</span>` : ''}
                  ${c.classLevel ? `<span aria-hidden="true">·</span><span>${esc(c.classLevel)}</span>` : ''}
                  ${c.studyLabel ? `<span aria-hidden="true">·</span><span class="font-medium text-[#0F2547] dark:text-sky-400">${esc(c.studyLabel)}</span>` : ''}
                  <span aria-hidden="true">·</span>
                  <span>${esc(c.contentType)}</span>
                  <span aria-hidden="true">·</span>
                  <span>${esc(c.language)}</span>
                  <span aria-hidden="true">·</span>
                  <span class="tabular-nums">${c.durationSeconds ? esc(formatDurationShort(c.durationSeconds)) : `${c.readingTimeMins} min read`}</span>
                </div>
                ${
                  c.chapter || c.topic
                    ? `<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mb-2">
                        ${c.chapter ? `<span>Chapter: <strong class="text-slate-700 dark:text-slate-200">${esc(c.chapter)}</strong></span>` : ''}
                        ${c.chapter && c.topic ? `<span aria-hidden="true">·</span>` : ''}
                        ${c.topic ? `<span>Topic: <strong class="text-slate-700 dark:text-slate-200">${esc(c.topic)}</strong></span>` : ''}
                      </div>`
                    : ''
                }

                <h1 class="font-display text-2xl sm:text-3xl lg:text-4xl font-semibold text-slate-900 dark:text-white leading-tight mb-3 sm:mb-4">
                  ${esc(c.title)}
                </h1>
                <p class="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed mb-5 sm:mb-6">
                  ${esc(c.shortDescription)}
                </p>

                <div class="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <div class="flex items-center gap-x-4 gap-y-1.5 flex-wrap tabular-nums">
                    <span>By <a href="#/creator-profile/${creator.id}" class="font-semibold text-slate-900 dark:text-white hover:underline">${esc(displayAuthorName)}</a></span>
                    ${c.publisherName ? `<span>Published by <strong class="font-semibold text-slate-800 dark:text-slate-200">${esc(c.publisherName)}</strong></span>` : ''}
                    <span>${formatDate(c.publishedAt || c.createdAt)}</span>
                    <span>${c.viewsCount} views</span>
                    <span>★ ${Number(c.avgRating || 0) > 0 ? Number(c.avgRating).toFixed(1) : 'Unrated'} (${c.reviewsCount})</span>
                  </div>

                  <div class="flex flex-wrap items-center gap-2">
                    <button type="button" id="rd-like-btn" class="min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      isLiked
                        ? 'border-[#0F2547] bg-[#0F2547] text-white dark:bg-sky-500 dark:border-sky-500 dark:text-slate-950'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }">
                      ${isLiked ? 'Liked' : 'Like'} (<span id="rd-like-count" class="tabular-nums">${likesCount}</span>)
                    </button>
                    <button type="button" id="rd-bookmark-btn" class="min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      isBookmarked
                        ? 'border-[#0F2547] text-[#0F2547] dark:border-sky-400 dark:text-sky-400'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }">
                      ${isBookmarked ? 'Bookmarked' : 'Bookmark'}
                    </button>
                    <button type="button" id="rd-report-btn" class="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 whitespace-nowrap shrink-0">
                      Report
                    </button>
                  </div>
                </div>
              </div>
            </header>

            <!-- Inline Mobile / Tablet Quick Action Bar (when locked or before opening content) -->
            ${
              !c.hasAccess
                ? `<div class="lg:hidden bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div class="text-xs text-slate-500 dark:text-slate-400">${c.isFree ? 'Free Publication · Sign In Required to Read' : 'Premium Publication · Instant Lifetime Access'}</div>
                      <div class="font-mono text-xl font-semibold ${c.isFree ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-white'} tabular-nums">${c.isFree ? 'Free' : formatInr(c.priceInr)}</div>
                    </div>
                    <button type="button" id="mobile-buy-btn" class="w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors whitespace-nowrap shrink-0">
                      ${c.isFree ? 'Sign In & Read Free' : `Pay ${formatInr(c.priceInr)} & Unlock`}
                    </button>
                  </div>`
                : ''
            }

            <!-- Full Content & Protected Media Container -->
            ${
              c.hasAccess
                ? `
                  <!-- Gate Banner: Cover & Details shown first for reading items; Video Lectures open immediately when unlocked -->
                  <section id="rd-content-gate" class="${videoFiles.length > 0 ? 'hidden ' : ''}bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                    <div class="space-y-1.5">
                      <div class="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        ${c.hasPurchased ? 'Payment Verified · Unlocked in Your Library' : c.isFree ? 'Free Access Unlocked' : 'Full Access (Creator / Admin)'}
                      </div>
                      <h2 class="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white">Ready to Read Full Content</h2>
                      <p class="text-sm text-slate-600 dark:text-slate-400">
                        Cover page and details are displayed above. Click below to open the complete study notes, diagrams, and attached files.
                      </p>
                    </div>
                    <button type="button" id="rd-open-content-btn" class="w-full sm:w-auto min-h-[44px] px-6 py-3 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors whitespace-nowrap shrink-0">
                      Open Full Content
                    </button>
                  </section>

                  <div id="rd-unlocked-content" data-paid-protected="${isPaidContent ? '1' : '0'}" class="${videoFiles.length > 0 ? '' : 'hidden '}space-y-6 sm:space-y-8 ${isPaidContent ? 'sp-protected-reader relative' : ''}">
                    <!-- Video Lecture Player -->
                    ${
                      videoFiles.length
                        ? `<section id="rd-video-section" class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6 space-y-4">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                              <h2 class="font-display text-xl font-semibold text-slate-900 dark:text-white">Video Lecture</h2>
                              <span id="rd-watch-status-text" class="text-xs font-medium text-emerald-700 dark:text-emerald-400">${
                                data.userState?.watchProgress?.completed
                                  ? 'Completed'
                                  : Number(data.userState?.watchProgress?.progressPercent || 0) > 0
                                  ? `${data.userState.watchProgress.progressPercent}% watched`
                                  : isPaidContent
                                  ? 'Protected Stream'
                                  : 'Ready to Watch'
                              }</span>
                            </div>
                            ${
                              store.user &&
                              data.userState?.watchProgress &&
                              !data.userState.watchProgress.completed &&
                              Number(data.userState.watchProgress.lastPositionSeconds || 0) >= 8
                                ? `<div id="rd-video-resume-banner" class="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 text-xs">
                                    <span class="text-slate-700 dark:text-slate-300">
                                      Paused previously at <strong class="font-mono text-slate-900 dark:text-white">${esc(formatSecondsClock(data.userState.watchProgress.lastPositionSeconds))}</strong> (${Number(data.userState.watchProgress.progressPercent || 0)}% watched)
                                    </span>
                                    <div class="flex items-center gap-2">
                                      <button type="button" id="rd-resume-seek-btn" data-seek-sec="${Number(data.userState.watchProgress.lastPositionSeconds || 0)}" class="px-3 py-1 font-semibold rounded bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Resume</button>
                                      <button type="button" id="rd-restart-video-btn" class="px-2.5 py-1 font-medium rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300">Start Over</button>
                                    </div>
                                  </div>`
                                : ''
                            }
                            ${videoFiles
                              .map((vf, vIdx) => {
                                if (vf.externalVideoUrl) {
                                  const resolved = resolveVideoEmbed(vf.externalVideoUrl);
                                  const embedSrc = resolved ? resolved.embedUrl : vf.externalVideoUrl;
                                  const watchHref = resolved ? resolved.watchUrl : vf.externalVideoUrl;
                                  const providerLabel = resolved ? resolved.provider : 'Video';
                                  const ytVidAttr =
                                    resolved?.provider === 'YouTube' && resolved?.videoId
                                      ? `data-yt-video-id="${esc(resolved.videoId)}"`
                                      : '';
                                  return `<div class="space-y-2.5">
                                      <div class="relative aspect-video w-full rounded-xl overflow-hidden bg-black border border-slate-200 dark:border-slate-800 shadow-sm">
                                        <iframe
                                          id="sp-yt-player-${vIdx}"
                                          ${ytVidAttr}
                                          src="${esc(embedSrc)}"
                                          title="${esc(vf.originalName || c.title)}"
                                          class="w-full h-full border-0"
                                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                          referrerpolicy="strict-origin-when-cross-origin"
                                          allowfullscreen
                                        ></iframe>
                                      </div>
                                      <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                                        <span class="truncate">${esc(vf.originalName || c.title)}</span>
                                        ${
                                          isPaidContent
                                            ? `<span class="text-[11px] font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap shrink-0">Protected Playback</span>`
                                            : `<a href="${esc(watchHref)}" target="_blank" rel="noopener noreferrer" class="font-semibold text-[#5a1fd8] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0">Open on ${esc(providerLabel)} ↗</a>`
                                        }
                                      </div>
                                    </div>`;
                                }
                                return `<div class="space-y-2">
                                    <div class="sp-video-wrap relative rounded-lg overflow-hidden bg-black">
                                      <video id="sp-html5-video-${vIdx}" controls controlsList="${isPaidContent ? 'nodownload noplaybackrate nofullscreen' : 'nodownload'}" ${isPaidContent ? 'disablePictureInPicture' : ''} class="w-full rounded-lg bg-black max-h-[480px]" src="${esc(withAuthParam(vf.accessUrl))}"></video>
                                      ${
                                        isPaidContent
                                          ? `<button type="button" class="sp-video-fs-btn absolute top-2.5 right-2.5 z-30 px-2.5 py-1 rounded bg-black/70 hover:bg-black/90 text-white text-[11px] font-semibold border border-white/20">Full Screen</button>`
                                          : ''
                                      }
                                    </div>
                                    <p class="text-xs text-slate-500">${esc(vf.originalName)} · ${formatBytes(vf.sizeBytes)}</p>
                                  </div>`;
                              })
                              .join('')}
                            <div id="rd-video-complete-card" class="hidden rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 sm:p-5 space-y-4">
                              <div class="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <div class="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Lecture Completed</div>
                                  <div class="font-display text-lg font-semibold text-slate-900 dark:text-white mt-0.5">You completed: ${esc(c.title)}</div>
                                </div>
                                <button type="button" id="rd-replay-video-btn" class="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800">Replay Video</button>
                              </div>
                              <div id="rd-complete-next-wrap" class="hidden space-y-2.5">
                                <div class="text-xs font-semibold text-slate-600 dark:text-slate-300">Next Recommended Study Videos</div>
                                <div id="rd-complete-next-list" class="grid grid-cols-1 sm:grid-cols-2 gap-3"></div>
                              </div>
                            </div>
                          </section>`
                        : ''
                    }

                    <!-- In-Browser PDF Document Viewer -->
                    ${
                      pdfFiles.length
                        ? `<section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6">
                            <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
                              <h2 class="font-display text-lg sm:text-xl font-semibold text-slate-900 dark:text-white">PDF Document Reader</h2>
                              <div class="flex items-center gap-2 text-xs">
                                <button type="button" id="pdf-zoom-out" class="min-w-[34px] min-h-[34px] px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">−</button>
                                <span id="pdf-zoom-label" class="font-mono tabular-nums w-12 text-center">100%</span>
                                <button type="button" id="pdf-zoom-in" class="min-w-[34px] min-h-[34px] px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">+</button>
                                <button type="button" id="pdf-fullscreen-btn" class="min-h-[34px] px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-[#0F2547] dark:text-sky-400 whitespace-nowrap">Full Screen</button>
                              </div>
                            </div>
                            ${pdfFiles
                              .map(
                                (pf) => `<div class="space-y-3">
                                  <div class="relative overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 h-[380px] sm:h-[520px] lg:h-[600px]">
                                    <iframe id="pdf-viewer-frame" src="${esc(withAuthParam(pf.accessUrl))}${isPaidContent ? '#toolbar=0&navpanes=0' : '#toolbar=1'}" class="w-full h-full transition-transform origin-top-left" title="${esc(pf.originalName)}"></iframe>
                                  </div>
                                  <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                                    <span class="truncate">${esc(pf.originalName)} · ${formatBytes(pf.sizeBytes)}</span>
                                    ${
                                      isPaidContent
                                        ? `<span class="text-[11px] font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap shrink-0">Protected View · Download Disabled</span>`
                                        : `<a href="${esc(withAuthParam(`${pf.accessUrl}${pf.accessUrl.includes('?') ? '&' : '?'}download=1`))}" class="font-semibold text-[#0F2547] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0">Download PDF</a>`
                                    }
                                  </div>
                                </div>`
                              )
                              .join('')}
                          </section>`
                        : ''
                    }

                    <!-- Attached Photo Gallery (Multi-Image Uploads) -->
                    ${
                      imageFiles.length
                        ? `<section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6">
                            <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
                              <h2 class="font-display text-lg sm:text-xl font-semibold text-slate-900 dark:text-white">Attached Gallery (${imageFiles.length} Photo${imageFiles.length > 1 ? 's' : ''})</h2>
                              <span class="text-xs text-slate-500">Click any photo to view full size</span>
                            </div>
                            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              ${imageFiles
                                .map((imgFile, i) => {
                                  const imgFullSrc = withAuthParam(imgFile.accessUrl);
                                  const imgThumbSrc = withThumbWidth(imgFile.accessUrl, 480);
                                  const dlUrl = isPaidContent
                                    ? ''
                                    : withAuthParam(`${imgFile.accessUrl}${imgFile.accessUrl.includes('?') ? '&' : '?'}download=1`);
                                  return `
                                    <button type="button" data-gallery-src="${esc(imgFullSrc)}" data-gallery-name="${esc(imgFile.originalName)}" data-gallery-dl="${esc(dlUrl)}" class="rd-gallery-item group text-left rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] hover:border-[#0F2547] dark:hover:border-sky-400 transition-colors">
                                      <div class="aspect-[4/3] w-full overflow-hidden bg-slate-100 dark:bg-slate-900">
                                        <img src="${esc(imgThumbSrc)}" data-full-src="${esc(imgFullSrc)}" alt="${esc(imgFile.originalName || `Photo ${i + 1}`)}" loading="lazy" decoding="async" ${isPaidContent ? 'draggable="false"' : ''} class="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200 ${isPaidContent ? 'pointer-events-none select-none' : ''}" />
                                      </div>
                                      <div class="px-2.5 py-1.5 text-[11px] text-slate-600 dark:text-slate-300 truncate">${esc(imgFile.originalName)}</div>
                                    </button>
                                  `;
                                })
                                .join('')}
                            </div>
                          </section>`
                        : ''
                    }

                    <!-- Unlocked Main Body -->
                    <section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-10">
                      <div class="reading-prose">${processedBody || '<p>No inline text content attached; see media or PDF files above.</p>'}</div>

                      ${
                        docFiles.length
                          ? `<div class="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800">
                              <h3 class="text-sm font-semibold text-slate-900 dark:text-white mb-3">Attached Study Files</h3>
                              <div class="space-y-2">
                                ${docFiles
                                  .map(
                                    (df) => `
                                  <div class="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
                                    <span>${esc(df.originalName)} (${formatBytes(df.sizeBytes)})</span>
                                    <a href="${esc(withAuthParam(`${df.accessUrl}${df.accessUrl.includes('?') ? '&' : '?'}download=1`))}" class="font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">Download</a>
                                  </div>
                                `
                                  )
                                  .join('')}
                              </div>
                            </div>`
                          : ''
                      }

                      ${
                        c.tags?.length
                          ? `<div class="mt-8 pt-5 border-t border-slate-100 dark:border-slate-800 flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                              <span class="font-semibold text-slate-700 dark:text-slate-300">Tags:</span>
                              ${c.tags.map((t) => `<a href="#/explore?q=${encodeURIComponent(t)}" class="hover:text-[#0F2547] dark:hover:text-sky-400">#${esc(t)}</a>`).join('<span aria-hidden="true">·</span>')}
                            </div>`
                          : ''
                      }
                    </section>
                  </div>
                `
                : `
                  <!-- Locked Content Gate: Cover & Details only; full content & files strictly hidden until payment / sign-in -->
                  <section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-8 space-y-6">
                    <div class="p-6 sm:p-8 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                      <div class="space-y-2">
                        <div class="inline-flex items-center gap-1.5 text-xs font-semibold ${c.isFree ? 'text-emerald-700 dark:text-emerald-400' : 'text-[#1B3B6F] dark:text-sky-400'}">
                          <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0110 0v4"></path></svg>
                          <span>${c.isFree ? 'Free Publication · Content Locked for Guests' : 'Paid Publication · Content Locked'}</span>
                        </div>
                        <h3 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">
                          ${c.isFree ? 'Sign In to Read Full Content (Free)' : `Pay ${formatInr(c.priceInr)} to Unlock Full Content`}
                        </h3>
                        <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                          ${
                            c.isFree
                              ? 'The full text, diagrams, and attached study files are hidden until you sign in. Create a free account or sign in to access immediately.'
                              : 'Only the cover page and publication details are visible before purchase. Complete secure INR payment to instantly unlock the complete notes, images, PDFs, and lifetime library access.'
                          }
                        </p>
                        ${
                          files.length
                            ? `<p class="text-xs text-slate-500 dark:text-slate-400 font-mono">Includes ${files.length} protected attachment${files.length > 1 ? 's' : ''} (${[
                                imageFiles.length ? `${imageFiles.length} Photo${imageFiles.length > 1 ? 's' : ''}` : '',
                                videoFiles.length ? `${videoFiles.length} Video${videoFiles.length > 1 ? 's' : ''}` : '',
                                pdfFiles.length ? `${pdfFiles.length} PDF` : '',
                                docFiles.length ? `${docFiles.length} File` : '',
                              ]
                                .filter(Boolean)
                                .join(' · ')})</p>`
                            : ''
                        }
                      </div>
                      <button type="button" id="rd-unlock-btn" class="w-full sm:w-auto min-h-[46px] px-6 py-3 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors whitespace-nowrap shrink-0">
                        ${c.isFree ? 'Sign In & Read Free' : `Pay ${formatInr(c.priceInr)} & Unlock`}
                      </button>
                    </div>

                    ${
                      c.tags?.length
                        ? `<div class="pt-2 flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                            <span class="font-semibold text-slate-700 dark:text-slate-300">Tags:</span>
                            ${c.tags.map((t) => `<a href="#/explore?q=${encodeURIComponent(t)}" class="hover:text-[#0F2547] dark:hover:text-sky-400">#${esc(t)}</a>`).join('<span aria-hidden="true">·</span>')}
                          </div>`
                        : ''
                    }
                  </section>
                `
            }

            <!-- Verified Ratings & Reviews -->
            <section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-8">
              <div class="flex flex-wrap items-baseline justify-between gap-4 mb-6">
                <div>
                  <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white">Reader Reviews</h2>
                  <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    ${c.isFree ? 'Open to registered readers.' : 'Only verified purchasers can submit reviews on paid publications.'}
                  </p>
                </div>
                <div class="font-mono text-lg font-semibold text-slate-900 dark:text-white tabular-nums">
                  ★ ${Number(c.avgRating || 0).toFixed(1)} <span class="text-xs font-normal text-slate-500">(${c.reviewsCount})</span>
                </div>
              </div>

              ${
                c.canReview
                  ? `<form id="review-form" class="mb-8 p-5 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 space-y-4">
                      <div class="flex flex-wrap items-center justify-between gap-3">
                        <span class="text-sm font-semibold text-slate-900 dark:text-white">Write your review</span>
                        <div class="flex items-center gap-1" id="star-picker">
                          ${[1, 2, 3, 4, 5]
                            .map(
                              (n) =>
                                `<button type="button" data-star="${n}" class="star-btn text-xl leading-none px-0.5 text-amber-500" aria-label="${n} stars">★</button>`
                            )
                            .join('')}
                        </div>
                      </div>
                      <input type="hidden" name="rating" id="review-rating-input" value="5" />
                      <input name="title" placeholder="Headline (optional)" class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111A2E]" />
                      <textarea name="body" rows="3" required placeholder="Share how useful this resource was for your study or teaching..." class="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111A2E]"></textarea>
                      <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Submit Review</button>
                    </form>`
                  : !store.user
                  ? `<p class="text-xs text-slate-500 mb-6"><a href="#/login" class="font-semibold text-[#0F2547] dark:text-sky-400 underline">Sign in</a> to review or comment.</p>`
                  : `<p class="text-xs text-slate-500 mb-6">Purchase this publication to unlock verified-purchase review privileges.</p>`
              }

              <div id="reviews-list" class="divide-y divide-slate-100 dark:divide-slate-800">
                ${
                  data.reviews?.length
                    ? data.reviews
                        .map(
                          (r) => `
                      <div class="py-4 first:pt-0">
                        <div class="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400 mb-1">
                          <div>
                            <span class="font-semibold text-slate-900 dark:text-white">${esc(r.userName)}</span>
                            ${r.isVerifiedPurchase ? '<span class="mx-1.5">·</span><span class="text-emerald-700 dark:text-emerald-400 font-medium">Verified Purchase</span>' : ''}
                            <span class="mx-1.5">·</span>
                            <span>${formatDate(r.createdAt)}</span>
                          </div>
                          <span class="font-mono text-amber-600 dark:text-amber-400">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
                        </div>
                        ${r.title ? `<div class="text-sm font-semibold text-slate-900 dark:text-white mb-1">${esc(r.title)}</div>` : ''}
                        <p class="text-sm text-slate-600 dark:text-slate-300">${esc(r.body)}</p>
                      </div>
                    `
                        )
                        .join('')
                    : `<p class="text-sm text-slate-500">No reviews yet. Be the first to share feedback.</p>`
                }
              </div>
            </section>

            <!-- Threaded Comments & Replies -->
            <section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-8">
              <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-5">Discussion &amp; Questions</h2>
              ${
                store.user
                  ? `<form id="comment-form" class="mb-6 space-y-3">
                      <textarea id="comment-body" rows="3" required placeholder="Ask a question or leave a scholarly note..." class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]"></textarea>
                      <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Post Comment</button>
                    </form>`
                  : `<p class="text-xs text-slate-500 mb-6"><a href="#/login" class="font-semibold text-[#0F2547] dark:text-sky-400 underline">Sign in</a> to participate in discussion.</p>`
              }
              <div id="comments-thread" class="space-y-4">
                ${renderCommentsTree(data.comments || [])}
              </div>
            </section>
          </div>

          <!-- Right Sidebar: Purchase Card, Table of Contents, Creator Profile -->
          <aside class="lg:col-span-4 space-y-6 lg:sticky lg:top-20">
            <!-- Access / Purchase Card -->
            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6">
              <div class="flex items-baseline justify-between mb-4">
                <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Access Tier</span>
                <span class="font-mono text-2xl font-semibold ${c.isFree || c.hasPurchased ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-white'} tabular-nums">
                  ${c.isFree ? 'Free' : c.hasPurchased ? 'Free (Unlocked)' : formatInr(c.priceInr)}
                </span>
              </div>
              ${
                c.hasAccess
                  ? `<div class="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs font-medium text-emerald-800 dark:text-emerald-300 mb-3">
                      ${c.hasPurchased ? 'Purchased · Now unlocked and free forever in your account.' : c.isFree ? 'Open-access free publication.' : 'Full preview access (Creator / Admin).'}
                    </div>
                    ${
                      videoFiles.length
                        ? ''
                        : `<button type="button" id="sidebar-open-content-btn" class="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors mb-4">
                      Open Full Content
                    </button>`
                    }`
                  : `<button type="button" id="sidebar-buy-btn" class="w-full py-3 px-4 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors mb-4">
                      ${c.isFree ? 'Sign In & Read Free' : `Pay ${formatInr(c.priceInr)} & Unlock`}
                    </button>`
              }
              <dl class="space-y-2.5 text-xs pt-3 border-t border-slate-100 dark:border-slate-800">
                <div class="flex justify-between gap-2"><dt class="text-slate-500">Author</dt><dd class="font-medium text-slate-900 dark:text-slate-200 text-right truncate">${esc(displayAuthorName)}</dd></div>
                ${c.publisherName ? `<div class="flex justify-between gap-2"><dt class="text-slate-500">Publisher</dt><dd class="font-medium text-slate-900 dark:text-slate-200 text-right truncate">${esc(c.publisherName)}</dd></div>` : ''}
                ${c.classLevel ? `<div class="flex justify-between gap-2"><dt class="text-slate-500">Class / Level</dt><dd class="font-medium text-slate-900 dark:text-slate-200 text-right truncate">${esc(c.classLevel)}</dd></div>` : ''}
                ${c.chapter ? `<div class="flex justify-between gap-2"><dt class="text-slate-500">Chapter</dt><dd class="font-medium text-slate-900 dark:text-slate-200 text-right truncate">${esc(c.chapter)}</dd></div>` : ''}
                ${c.topic ? `<div class="flex justify-between gap-2"><dt class="text-slate-500">Topic</dt><dd class="font-medium text-slate-900 dark:text-slate-200 text-right truncate">${esc(c.topic)}</dd></div>` : ''}
                <div class="flex justify-between"><dt class="text-slate-500">Format</dt><dd class="font-medium text-slate-900 dark:text-slate-200">${esc(c.contentType)}</dd></div>
                <div class="flex justify-between"><dt class="text-slate-500">Language</dt><dd class="font-medium text-slate-900 dark:text-slate-200">${esc(c.language)}</dd></div>
                <div class="flex justify-between"><dt class="text-slate-500">${c.durationSeconds ? 'Duration' : 'Est. Study Time'}</dt><dd class="font-mono text-slate-900 dark:text-slate-200 tabular-nums">${c.durationSeconds ? esc(formatDurationShort(c.durationSeconds)) : `${c.readingTimeMins} min`}</dd></div>
                <div class="flex justify-between"><dt class="text-slate-500">Attached Files</dt><dd class="font-mono text-slate-900 dark:text-slate-200 tabular-nums">${files.length}</dd></div>
              </dl>
            </div>

            <!-- Table of Contents -->
            ${
              tocItems.length
                ? `<div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6">
                    <h3 class="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">Table of Contents</h3>
                    <nav class="space-y-2 text-sm">
                      ${tocItems
                        .map(
                          (item) =>
                            `<a href="javascript:void(0)" data-scroll-target="${item.id}" class="toc-link block text-slate-600 dark:text-slate-300 hover:text-[#0F2547] dark:hover:text-sky-400 ${item.level === 'h3' ? 'pl-4 text-xs' : 'font-medium'}">${esc(item.text)}</a>`
                        )
                        .join('')}
                    </nav>
                  </div>`
                : ''
            }

            <!-- Creator Profile Card -->
            <div class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-6">
              <div class="flex items-center gap-3 mb-3">
                <div class="w-11 h-11 rounded-full bg-[#0F2547] dark:bg-sky-900 text-white font-display font-semibold flex items-center justify-center shrink-0">
                  ${esc(creator.name.slice(0, 2).toUpperCase())}
                </div>
                <div class="min-w-0">
                  <a href="#/creator-profile/${creator.id}" class="font-semibold text-sm text-slate-900 dark:text-white hover:underline block truncate">${esc(creator.name)}</a>
                  <p class="text-xs text-slate-500 dark:text-slate-400 truncate">${esc(creator.tagline || 'Published Author')}</p>
                </div>
              </div>
              <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4">${esc(creator.bio || '')}</p>
              <div class="flex items-center gap-2">
                <button type="button" id="rd-follow-btn" class="flex-1 py-2 px-3 text-xs font-semibold rounded-lg border transition-colors ${
                  isFollowing
                    ? 'border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100'
                    : 'bg-[#0F2547] border-[#0F2547] text-white dark:bg-sky-500 dark:border-sky-500 dark:text-slate-950'
                }">
                  ${isFollowing ? 'Following' : 'Follow'}
                </button>
                <a href="#/creator-profile/${creator.id}" class="py-2 px-3 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                  Profile
                </a>
              </div>
            </div>
          </aside>
        </div>

        <!-- Categorized AI & Educational Recommendations -->
        <div id="rd-recommendations-slot"></div>
      </div>
    `;

    // Wire TOC smooth scroll
    container.querySelectorAll('.toc-link').forEach((link) => {
      link.addEventListener('click', () => {
        document.getElementById(link.dataset.scrollTarget)?.scrollIntoView({ behavior: 'smooth' });
      });
    });

    // Wire Full-Screen Multi-Page Photo Gallery & Inline Image Lightbox
    const galleryBtns = Array.from(container.querySelectorAll('.rd-gallery-item'));
    const inlineBodyImgs = Array.from(container.querySelectorAll('#rd-unlocked-content .reading-prose img'));
    const collectAllReaderImages = () => {
      const attachedPhotos = galleryBtns
        .filter((b) => b.dataset.gallerySrc)
        .map((b, i) => ({
          src: b.dataset.gallerySrc,
          title: b.dataset.galleryName || `Gallery Photo ${i + 1}`,
          downloadHref: b.dataset.galleryDl || '',
        }));
      const inlineImgs = inlineBodyImgs
        .filter((img) => img.getAttribute('src'))
        .map((img, i) => ({
          src: img.currentSrc || img.getAttribute('src'),
          title: img.getAttribute('alt') || `Content Page ${i + 1}`,
        }));
      return { attachedPhotos, allImages: [...attachedPhotos, ...inlineImgs] };
    };

    galleryBtns.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        const { allImages } = collectAllReaderImages();
        openImageLightbox({ images: allImages, startIndex: idx, watermarkText: viewerWatermark });
      });
    });

    inlineBodyImgs.forEach((img, idx) => {
      if (isPaidContent) img.setAttribute('draggable', 'false');
      img.addEventListener('click', () => {
        const { attachedPhotos, allImages } = collectAllReaderImages();
        openImageLightbox({
          images: allImages,
          startIndex: attachedPhotos.length + idx,
          watermarkText: viewerWatermark,
        });
      });
    });

    // Attach multi-layer anti-capture shield & watermark tamper lock for paid publications
    const unlockedContainer = document.getElementById('rd-unlocked-content');
    if (c.hasAccess && isPaidContent && unlockedContainer) {
      activeProtectionCleanup = attachContentProtectionShield(unlockedContainer, viewerWatermark);
    }

    // Wire PDF Full Screen viewer modal
    document.getElementById('pdf-fullscreen-btn')?.addEventListener('click', () => {
      const frame = document.getElementById('pdf-viewer-frame');
      const src = frame?.getAttribute('src');
      if (!src) return;
      const wmBg = viewerWatermark ? buildWatermarkSvgUrl(viewerWatermark) : '';
      openModal({
        title: frame.getAttribute('title') || 'PDF Document Viewer',
        widthClass: 'max-w-6xl',
        bodyHtml: `
          <div class="relative w-full h-[80vh] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 ${isPaidContent ? 'sp-protected-reader' : ''}">
            <iframe src="${esc(src)}" class="w-full h-full border-0" title="Full Screen PDF Reader"></iframe>
            ${
              wmBg
                ? `<div aria-hidden="true" style="position:absolute;inset:0;z-index:20;pointer-events:none;background-image:url(&quot;${wmBg}&quot;);background-repeat:repeat;"></div>`
                : ''
            }
          </div>
        `,
      });
    });

    // Wire PDF zoom controls
    let pdfZoom = 100;
    const applyZoom = () => {
      const frame = document.getElementById('pdf-viewer-frame');
      const label = document.getElementById('pdf-zoom-label');
      if (frame && label) {
        frame.style.transform = `scale(${pdfZoom / 100})`;
        frame.style.width = `${10000 / pdfZoom}%`;
        frame.style.height = `${10000 / pdfZoom}%`;
        label.textContent = `${pdfZoom}%`;
      }
    };
    document.getElementById('pdf-zoom-in')?.addEventListener('click', () => {
      pdfZoom = Math.min(150, pdfZoom + 15);
      applyZoom();
    });
    document.getElementById('pdf-zoom-out')?.addEventListener('click', () => {
      pdfZoom = Math.max(70, pdfZoom - 15);
      applyZoom();
    });

    // Wire Open Full Content toggle (keeps Cover + Details first until reader opens content)
    const revealUnlockedContent = (autoScroll = true) => {
      const gate = document.getElementById('rd-content-gate');
      const bodyWrap = document.getElementById('rd-unlocked-content');
      const sideOpenBtn = document.getElementById('sidebar-open-content-btn');
      if (gate) gate.classList.add('hidden');
      if (bodyWrap) {
        bodyWrap.classList.remove('hidden');
        if (autoScroll) bodyWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (sideOpenBtn) sideOpenBtn.classList.add('hidden');
    };
    document.getElementById('rd-open-content-btn')?.addEventListener('click', () => revealUnlockedContent(true));
    document.getElementById('sidebar-open-content-btn')?.addEventListener('click', () => revealUnlockedContent(true));

    // If just returned from a completed purchase, immediately reveal the newly unlocked content
    try {
      const justUnlocked = sessionStorage.getItem('sp_just_unlocked_slug');
      if (justUnlocked === slug && c.hasAccess) {
        sessionStorage.removeItem('sp_just_unlocked_slug');
        revealUnlockedContent(false);
      }
    } catch {}

    // Wire Purchase / Sign-In Gate Action
    const startCheckout = async (evt) => {
      if (!store.user) {
        try {
          sessionStorage.setItem('sp_post_login_redirect', `#/content/${slug}`);
        } catch {}
        showToast(
          c.isFree ? 'Please sign in to read this free publication.' : 'Please sign in to pay and unlock this publication.',
          'info'
        );
        window.location.hash = '#/login';
        return;
      }
      if (c.isFree) {
        revealUnlockedContent(true);
        return;
      }

      const clickedBtn = evt?.currentTarget;
      const origText = clickedBtn?.textContent;
      if (clickedBtn) {
        clickedBtn.disabled = true;
        clickedBtn.textContent = 'Opening Checkout...';
      }
      try {
        const order = await apiFetch('/api/payments/create-order', {
          method: 'POST',
          body: { contentId: c.id },
        });
        openCheckoutModal(order, () => {
          try {
            sessionStorage.setItem('sp_just_unlocked_slug', slug);
          } catch {}
          if (store.user) {
            const prevIds = Array.isArray(store.user.purchasedContentIds)
              ? store.user.purchasedContentIds
              : [];
            if (!prevIds.includes(Number(c.id))) {
              store.user.purchasedContentIds = [...prevIds, Number(c.id)];
            }
          }
          renderContentDetailPage(container, slug);
        });
      } catch (err) {
        showToast(err.message || 'Unable to start checkout.', 'error');
      } finally {
        if (clickedBtn && origText) {
          clickedBtn.disabled = false;
          clickedBtn.textContent = origText;
        }
      }
    };
    document.getElementById('rd-unlock-btn')?.addEventListener('click', startCheckout);
    document.getElementById('sidebar-buy-btn')?.addEventListener('click', startCheckout);
    document.getElementById('mobile-buy-btn')?.addEventListener('click', startCheckout);

    // Wire Like
    document.getElementById('rd-like-btn')?.addEventListener('click', async () => {
      if (!store.user) {
        showToast('Sign in to like publications.', 'info');
        window.location.hash = '#/login';
        return;
      }
      try {
        const res = await apiFetch(`/api/community/likes/${c.id}`, { method: 'POST' });
        isLiked = res.liked;
        likesCount = Math.max(0, likesCount + (isLiked ? 1 : -1));
        const btn = document.getElementById('rd-like-btn');
        btn.innerHTML = `${isLiked ? 'Liked' : 'Like'} (<span id="rd-like-count" class="tabular-nums">${likesCount}</span>)`;
        btn.className = `min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
          isLiked
            ? 'border-[#0F2547] bg-[#0F2547] text-white dark:bg-sky-500 dark:border-sky-500 dark:text-slate-950'
            : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
        }`;
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Wire Bookmark
    document.getElementById('rd-bookmark-btn')?.addEventListener('click', async () => {
      if (!store.user) {
        showToast('Sign in to save bookmarks.', 'info');
        window.location.hash = '#/login';
        return;
      }
      try {
        const res = await apiFetch(`/api/community/bookmarks/${c.id}`, { method: 'POST' });
        isBookmarked = res.bookmarked;
        const btn = document.getElementById('rd-bookmark-btn');
        btn.textContent = isBookmarked ? 'Bookmarked' : 'Bookmark';
        showToast(isBookmarked ? 'Saved to bookmarks.' : 'Removed from bookmarks.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Wire Follow
    document.getElementById('rd-follow-btn')?.addEventListener('click', async () => {
      if (!store.user) {
        showToast('Sign in to follow creators.', 'info');
        window.location.hash = '#/login';
        return;
      }
      try {
        const res = await apiFetch(`/api/community/follow/${creator.id}`, { method: 'POST' });
        isFollowing = res.following;
        const btn = document.getElementById('rd-follow-btn');
        btn.textContent = isFollowing ? 'Following' : 'Follow';
        showToast(isFollowing ? `Following ${creator.name}.` : `Unfollowed ${creator.name}.`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Wire Report / Copyright Modal
    document.getElementById('rd-report-btn')?.addEventListener('click', () => {
      if (!store.user) {
        showToast('Please sign in to submit a report or copyright complaint.', 'info');
        window.location.hash = '#/login';
        return;
      }
      openModal({
        title: 'Report Content or Copyright Infringement',
        bodyHtml: `
          <form id="report-modal-form" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Report Category</label>
              <select name="reportType" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]">
                <option value="copyright">Copyright / Plagiarism Takedown</option>
                <option value="inappropriate">Inappropriate or Harmful Content</option>
                <option value="spam">Misleading / Spam Resource</option>
                <option value="other">Other Policy Violation</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Reason Summary</label>
              <input name="reason" required placeholder="Brief summary of the issue" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Detailed Explanation</label>
              <textarea name="details" rows="3" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]"></textarea>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Proof of Original Ownership (optional, for copyright claims)</label>
              <input name="copyrightProof" placeholder="URL, ISBN, publication reference, or registration ID" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120]" />
            </div>
            <div class="flex justify-end gap-2 pt-2">
              <button type="submit" class="px-4 py-2 text-xs font-semibold rounded-lg bg-red-700 hover:bg-red-800 text-white">Submit Report</button>
            </div>
          </form>
        `,
        onMount: (close) => {
          document.getElementById('report-modal-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            try {
              const res = await apiFetch(`/api/community/reports/${c.id}`, {
                method: 'POST',
                body: Object.fromEntries(fd.entries()),
              });
              showToast(res.message, 'success');
              close();
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        },
      });
    });

    // Wire Star Picker & Review Form
    const starBtns = container.querySelectorAll('.star-btn');
    starBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = Number(btn.dataset.star);
        document.getElementById('review-rating-input').value = String(val);
        starBtns.forEach((s) => {
          s.classList.toggle('text-amber-500', Number(s.dataset.star) <= val);
          s.classList.toggle('text-slate-300', Number(s.dataset.star) > val);
        });
      });
    });

    document.getElementById('review-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await apiFetch(`/api/community/reviews/${c.id}`, {
          method: 'POST',
          body: {
            rating: Number(fd.get('rating')),
            title: fd.get('title'),
            body: fd.get('body'),
          },
        });
        showToast('Review published.', 'success');
        renderContentDetailPage(container, slug);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Wire Comments & Replies
    document.getElementById('comment-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = document.getElementById('comment-body')?.value.trim();
      if (!body) return;
      try {
        await apiFetch(`/api/community/comments/${c.id}`, {
          method: 'POST',
          body: { body },
        });
        showToast('Comment posted.', 'success');
        renderContentDetailPage(container, slug);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    container.querySelectorAll('.reply-trigger-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const parentId = btn.dataset.commentId;
        const box = document.getElementById(`reply-box-${parentId}`);
        if (box) box.classList.toggle('hidden');
      });
    });

    container.querySelectorAll('.reply-form').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const parentId = Number(form.dataset.parentId);
        const body = form.querySelector('input')?.value.trim();
        if (!body) return;
        try {
          await apiFetch(`/api/community/comments/${c.id}`, {
            method: 'POST',
            body: { body, parentId },
          });
          showToast('Reply posted.', 'success');
          renderContentDetailPage(container, slug);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // Attach genuine video playback & progress tracking + load categorized recommendations
    if (c.hasAccess && videoFiles.length > 0) {
      activeVideoProgressCleanup = attachVideoWatchTracking({
        contentId: c.id,
        savedProgress: data.userState?.watchProgress || null,
        isLoggedIn: Boolean(store.user),
      });
    }
    loadReaderRecommendations(c.id, data.related || []);
  } catch (err) {
    container.innerHTML = `
      <div class="max-w-3xl mx-auto px-4 py-16 text-center">
        <h2 class="font-display text-2xl font-semibold mb-2">Publication unavailable</h2>
        <p class="text-sm text-slate-500 mb-6">${esc(err.message)}</p>
        <a href="#/explore" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] text-white">Return to Catalog</a>
      </div>
    `;
  }
}

function formatSecondsClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

let ytApiLoadPromise = null;
function ensureYouTubeIframeApi() {
  if (window.YT && typeof window.YT.Player === 'function') {
    return Promise.resolve(window.YT);
  }
  if (ytApiLoadPromise) return ytApiLoadPromise;
  ytApiLoadPromise = new Promise((resolve) => {
    const prevReady = window.onYouTubeIframeAPIReady;
    const timeoutId = setTimeout(() => resolve(window.YT || null), 6000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeoutId);
      if (typeof prevReady === 'function') {
        try {
          prevReady();
        } catch {}
      }
      resolve(window.YT || null);
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.onerror = () => {
        clearTimeout(timeoutId);
        resolve(null);
      };
      document.head.appendChild(tag);
    }
  });
  return ytApiLoadPromise;
}

function attachVideoWatchTracking({ contentId, savedProgress, isLoggedIn }) {
  let cleanedUp = false;
  let lastSentPos = Number(savedProgress?.lastPositionSeconds || 0);
  let lastPosition = Number(savedProgress?.lastPositionSeconds || 0);
  let totalDuration = Number(savedProgress?.durationSeconds || 0);
  let maxWatched = Number(savedProgress?.watchedSeconds || 0);
  let completionShown = false;
  let ytPlayer = null;
  let ytPollTimer = null;

  const statusTextEl = document.getElementById('rd-watch-status-text');
  const completeCard = document.getElementById('rd-video-complete-card');
  const resumeBanner = document.getElementById('rd-video-resume-banner');

  const showCompletePanel = () => {
    if (completionShown) return;
    completionShown = true;
    if (completeCard) completeCard.classList.remove('hidden');
    if (statusTextEl) statusTextEl.textContent = 'Completed';
  };

  const sendProgress = async ({ position, duration, completedEvent = false, force = false } = {}) => {
    if (cleanedUp) return;
    const pos = Math.max(0, Math.round(Number(position ?? lastPosition) || 0));
    const dur = Math.max(0, Math.round(Number(duration ?? totalDuration) || 0));
    lastPosition = pos;
    if (dur > 0) totalDuration = dur;
    if (pos > maxWatched) maxWatched = pos;

    const pct = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;
    if (statusTextEl && (pos > 0 || completedEvent)) {
      statusTextEl.textContent = completedEvent || pct >= 90 ? 'Completed' : `${pct}% watched`;
    }

    if (completedEvent || (dur > 0 && pct >= 90 && maxWatched >= 5)) {
      showCompletePanel();
    }

    if (!isLoggedIn) return;
    if (!force && !completedEvent && Math.abs(pos - lastSentPos) < 10) return;
    if (!completedEvent && pos <= 0) return;

    lastSentPos = pos;
    try {
      const token = await getAuthToken();
      await fetch(`/api/videos/${contentId}/progress`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          watchedSeconds: maxWatched,
          durationSeconds: dur,
          lastPositionSeconds: pos,
          completedEvent,
        }),
      });
    } catch {}
  };

  // HTML5 <video> tracking
  const html5Video = document.getElementById('sp-html5-video-0');
  let onTimeUpdate = null;
  let onPause = null;
  let onEnded = null;
  let onLoadedMeta = null;

  if (html5Video) {
    onLoadedMeta = () => {
      if (html5Video.duration && Number.isFinite(html5Video.duration)) {
        totalDuration = Math.round(html5Video.duration);
      }
    };
    onTimeUpdate = () => {
      const pos = html5Video.currentTime || 0;
      const dur = Number.isFinite(html5Video.duration) ? html5Video.duration : totalDuration;
      sendProgress({ position: pos, duration: dur });
    };
    onPause = () => {
      const pos = html5Video.currentTime || 0;
      const dur = Number.isFinite(html5Video.duration) ? html5Video.duration : totalDuration;
      if (pos > 1) sendProgress({ position: pos, duration: dur, force: true });
    };
    onEnded = () => {
      const dur = Number.isFinite(html5Video.duration) ? html5Video.duration : totalDuration;
      sendProgress({ position: dur || lastPosition, duration: dur, completedEvent: true, force: true });
    };

    html5Video.addEventListener('loadedmetadata', onLoadedMeta);
    html5Video.addEventListener('timeupdate', onTimeUpdate);
    html5Video.addEventListener('pause', onPause);
    html5Video.addEventListener('ended', onEnded);
  }

  // YouTube IFrame API tracking (non-blocking progressive enhancement)
  const ytIframe = document.querySelector('iframe[id^="sp-yt-player-"][data-yt-video-id]');
  if (ytIframe) {
    ensureYouTubeIframeApi().then((YT) => {
      if (cleanedUp || !YT || typeof YT.Player !== 'function' || !ytIframe.isConnected) return;
      try {
        ytPlayer = new YT.Player(ytIframe.id, {
          events: {
            onStateChange: (event) => {
              if (cleanedUp || !ytPlayer) return;
              const state = event.data;
              if (state === YT.PlayerState?.PLAYING) {
                clearInterval(ytPollTimer);
                ytPollTimer = setInterval(() => {
                  try {
                    const pos = ytPlayer.getCurrentTime?.() || 0;
                    const dur = ytPlayer.getDuration?.() || 0;
                    sendProgress({ position: pos, duration: dur });
                  } catch {}
                }, 5000);
              } else if (state === YT.PlayerState?.PAUSED) {
                clearInterval(ytPollTimer);
                try {
                  const pos = ytPlayer.getCurrentTime?.() || 0;
                  const dur = ytPlayer.getDuration?.() || 0;
                  if (pos > 1) sendProgress({ position: pos, duration: dur, force: true });
                } catch {}
              } else if (state === YT.PlayerState?.ENDED) {
                clearInterval(ytPollTimer);
                try {
                  const dur = ytPlayer.getDuration?.() || totalDuration;
                  sendProgress({
                    position: dur || lastPosition,
                    duration: dur,
                    completedEvent: true,
                    force: true,
                  });
                } catch {}
              }
            },
          },
        });
      } catch {}
    });
  }

  const seekAndPlay = (seconds) => {
    const target = Math.max(0, Number(seconds || 0));
    if (resumeBanner) resumeBanner.classList.add('hidden');
    if (completeCard && target === 0) {
      completeCard.classList.add('hidden');
      completionShown = false;
    }
    if (html5Video) {
      try {
        html5Video.currentTime = target;
        html5Video.play().catch(() => {});
      } catch {}
      return;
    }
    if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
      try {
        ytPlayer.seekTo(target, true);
        ytPlayer.playVideo?.();
      } catch {}
    }
  };

  document.getElementById('rd-resume-seek-btn')?.addEventListener('click', (e) => {
    seekAndPlay(Number(e.currentTarget.dataset.seekSec || 0));
  });
  document.getElementById('rd-restart-video-btn')?.addEventListener('click', () => seekAndPlay(0));
  document.getElementById('rd-replay-video-btn')?.addEventListener('click', () => seekAndPlay(0));

  const onVisChange = () => {
    if (document.hidden && lastPosition > 1) {
      sendProgress({ position: lastPosition, duration: totalDuration, force: true });
    }
  };
  const onBeforeUnload = () => {
    if (lastPosition > 1) {
      sendProgress({ position: lastPosition, duration: totalDuration, force: true });
    }
  };

  document.addEventListener('visibilitychange', onVisChange);
  window.addEventListener('beforeunload', onBeforeUnload);

  return () => {
    cleanedUp = true;
    clearInterval(ytPollTimer);
    document.removeEventListener('visibilitychange', onVisChange);
    window.removeEventListener('beforeunload', onBeforeUnload);
    if (html5Video) {
      if (onLoadedMeta) html5Video.removeEventListener('loadedmetadata', onLoadedMeta);
      if (onTimeUpdate) html5Video.removeEventListener('timeupdate', onTimeUpdate);
      if (onPause) html5Video.removeEventListener('pause', onPause);
      if (onEnded) html5Video.removeEventListener('ended', onEnded);
    }
    if (ytPlayer && typeof ytPlayer.destroy === 'function') {
      try {
        ytPlayer.destroy();
      } catch {}
    }
    ytPlayer = null;
  };
}

async function loadReaderRecommendations(contentId, fallbackRelated = []) {
  const slot = document.getElementById('rd-recommendations-slot');
  if (!slot) return;

  try {
    const data = await apiFetch(`/api/videos/${contentId}/related?includeExternal=1`);
    if (!slot.isConnected) return;

    const sections = [
      { key: 'continueLearning', title: 'Continue Learning', items: data.continueLearning || [] },
      { key: 'moreOnChapter', title: 'More on This Chapter', items: data.moreOnChapter || [] },
      { key: 'nextLearningStep', title: 'Next Learning Step', items: data.nextLearningStep || [] },
      {
        key: 'otherTeachers',
        title: 'Other Teachers Explaining This Topic',
        items: data.otherTeachers || [],
      },
      {
        key: 'relatedVideos',
        title: 'Related Videos & Study Material',
        items: (data.relatedVideos && data.relatedVideos.length ? data.relatedVideos : fallbackRelated) || [],
      },
      { key: 'recommendedForYou', title: 'Recommended for You', items: data.recommendedForYou || [] },
    ].filter((sec) => sec.items.length > 0);

    // Populate post-completion "Next Recommended Study Videos" list
    const nextList = document.getElementById('rd-complete-next-list');
    const nextWrap = document.getElementById('rd-complete-next-wrap');
    const nextItems = [
      ...(data.nextLearningStep || []),
      ...(data.moreOnChapter || []),
      ...(data.relatedVideos || []),
    ].slice(0, 2);

    if (nextList && nextWrap && nextItems.length > 0) {
      nextWrap.classList.remove('hidden');
      nextList.innerHTML = nextItems
        .map(
          (item) => `
        <a href="#/content/${esc(item.slug)}" data-rec-id="${esc(item.id)}" data-rec-section="postComplete" class="rd-rec-link flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] hover:border-[#0F2547] dark:hover:border-sky-400 transition-colors">
          ${item.coverImageUrl ? `<img src="${esc(item.coverImageUrl)}" alt="${esc(item.title)}" class="w-16 h-12 rounded object-cover shrink-0 bg-slate-100" />` : ''}
          <div class="min-w-0">
            <div class="text-xs font-semibold text-slate-900 dark:text-white line-clamp-2">${esc(item.title)}</div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">${esc(item.creatorName || '')}${item.durationSeconds ? ` · ${esc(formatDurationShort(item.durationSeconds))}` : ''}</div>
          </div>
        </a>`
        )
        .join('');
    }

    const externalVideos = Array.isArray(data.externalVideos) ? data.externalVideos : [];
    const sectionsHtml = sections
      .map(
        (sec) => `
      <section class="mt-10 sm:mt-14 pt-8 border-t border-slate-200 dark:border-slate-800">
        <h2 class="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white mb-5">${esc(sec.title)}</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6" data-rec-section="${esc(sec.key)}">
          ${sec.items.map(renderContentCard).join('')}
        </div>
      </section>`
      )
      .join('');

    const externalHtml = externalVideos.length
      ? `<section class="mt-10 sm:mt-14 pt-8 border-t border-slate-200 dark:border-slate-800">
          <div class="flex flex-wrap items-baseline justify-between gap-2 mb-5">
            <h2 class="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white">External Educational Videos</h2>
            <span class="text-xs text-slate-500 dark:text-slate-400">From YouTube · External educational reference</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            ${externalVideos
              .map(
                (v) => `
              <a href="${esc(v.watchUrl)}" target="_blank" rel="noopener noreferrer" class="group bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
                ${v.thumbnailUrl ? `<div class="aspect-video w-full bg-slate-100 dark:bg-slate-900 overflow-hidden"><img src="${esc(v.thumbnailUrl)}" alt="${esc(v.title)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200" /></div>` : ''}
                <div class="p-4 flex-1 flex flex-col">
                  <div class="text-[11px] font-medium text-red-700 dark:text-red-400 mb-1">External YouTube Video</div>
                  <div class="font-display text-sm font-semibold text-slate-900 dark:text-white line-clamp-2 mb-2">${esc(v.title)}</div>
                  <div class="mt-auto text-xs text-slate-500 dark:text-slate-400 truncate">${esc(v.channelTitle || 'YouTube')}</div>
                </div>
              </a>`
              )
              .join('')}
          </div>
        </section>`
      : '';

    slot.innerHTML = sectionsHtml + externalHtml;

    const trackClick = (targetId, section) => {
      if (!targetId) return;
      apiFetch('/api/recommendations/event', {
        method: 'POST',
        body: {
          sourceContentId: contentId,
          targetContentId: Number(targetId),
          section: section || 'relatedVideos',
          eventType: 'click',
        },
      }).catch(() => {});
    };

    slot.querySelectorAll('[data-rec-section] article[data-content-id]').forEach((card) => {
      const sectionKey = card.closest('[data-rec-section]')?.dataset.recSection || 'relatedVideos';
      const targetId = card.dataset.contentId;
      card.addEventListener('click', () => trackClick(targetId, sectionKey));
    });

    document.querySelectorAll('#rd-complete-next-list .rd-rec-link').forEach((link) => {
      link.addEventListener('click', () => trackClick(link.dataset.recId, 'postComplete'));
    });
  } catch {
    if (!slot.isConnected) return;
    if (fallbackRelated?.length) {
      slot.innerHTML = `
        <section class="mt-10 sm:mt-16 pt-8 sm:pt-10 border-t border-slate-200 dark:border-slate-800">
          <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-6">Related Publications</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6">
            ${fallbackRelated.map(renderContentCard).join('')}
          </div>
        </section>
      `;
    }
  }
}

function renderCommentsTree(comments) {
  if (!comments.length) {
    return `<p class="text-sm text-slate-500">No comments yet. Start a thoughtful discussion.</p>`;
  }
  const roots = comments.filter((c) => !c.parentId);
  const byParent = new Map();
  for (const c of comments) {
    if (c.parentId) {
      const list = byParent.get(c.parentId) || [];
      list.push(c);
      byParent.set(c.parentId, list);
    }
  }

  return roots
    .map((c) => {
      const replies = byParent.get(c.id) || [];
      return `
        <div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-[#0B1120]">
          <div class="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1.5">
            <span><strong class="text-slate-900 dark:text-white">${esc(c.userName)}</strong> · ${formatDate(c.createdAt)}</span>
            ${
              store.user
                ? `<button type="button" data-comment-id="${c.id}" class="reply-trigger-btn font-semibold text-[#1B3B6F] dark:text-sky-400 hover:underline">Reply</button>`
                : ''
            }
          </div>
          <p class="text-sm text-slate-700 dark:text-slate-200">${esc(c.body)}</p>

          <form id="reply-box-${c.id}" data-parent-id="${c.id}" class="reply-form hidden mt-3 flex gap-2">
            <input required placeholder="Write a reply..." class="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111A2E]" />
            <button type="submit" class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">Send</button>
          </form>

          ${
            replies.length
              ? `<div class="mt-3 pl-4 border-l border-slate-200 dark:border-slate-800 space-y-2.5">
                  ${replies
                    .map(
                      (r) => `
                    <div class="text-sm">
                      <div class="text-xs text-slate-500 dark:text-slate-400 mb-0.5">
                        <strong class="text-slate-900 dark:text-white">${esc(r.userName)}</strong> · ${formatDate(r.createdAt)}
                      </div>
                      <p class="text-slate-700 dark:text-slate-300 text-xs">${esc(r.body)}</p>
                    </div>
                  `
                    )
                    .join('')}
                </div>`
              : ''
          }
        </div>
      `;
    })
    .join('');
}

function openCheckoutModal(order, onSuccess) {
  const useRazorpayCheckout = Boolean(order.keyId);
  const isRazorpayTestKey = Boolean(order.keyId && String(order.keyId).startsWith('rzp_test_'));

  openModal({
    title: 'Complete Your Purchase',
    bodyHtml: `
      <div class="space-y-5">
        <div class="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-900/70 text-xs text-emerald-900 dark:text-emerald-200">
          <svg class="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/>
          </svg>
          <span><strong>One-time payment</strong> — Once unlocked, this publication stays free forever in your account.</span>
        </div>

        <div class="p-4 sm:p-5 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 space-y-3 text-sm">
          <div class="flex items-start justify-between gap-4">
            <span class="text-slate-500 dark:text-slate-400 shrink-0">Publication</span>
            <span class="font-semibold text-slate-900 dark:text-white text-right">${esc(order.contentTitle)}</span>
          </div>
          <div class="flex items-center justify-between gap-4">
            <span class="text-slate-500 dark:text-slate-400">Access</span>
            <span class="font-medium text-emerald-700 dark:text-emerald-400 text-right">Instant Lifetime Access</span>
          </div>
          <div class="flex items-center justify-between gap-4">
            <span class="text-slate-500 dark:text-slate-400">Receipt No.</span>
            <span class="font-mono text-xs text-slate-700 dark:text-slate-300">${esc(order.receiptNumber)}</span>
          </div>
          <div class="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-baseline">
            <span class="font-semibold text-slate-900 dark:text-white">Total Price</span>
            <span class="font-mono text-2xl font-bold text-[#0F2547] dark:text-sky-300 tabular-nums">${formatInr(order.amountInr)}</span>
          </div>
        </div>

        ${
          !useRazorpayCheckout
            ? `<div class="space-y-3">
                <div class="text-xs font-semibold text-slate-700 dark:text-slate-300">Choose Payment Method</div>
                <div class="grid grid-cols-3 gap-2 text-xs">
                  <button type="button" data-pm="upi" class="chk-pm-btn py-2.5 px-2 rounded-lg border-2 border-[#0F2547] dark:border-sky-400 bg-slate-50 dark:bg-[#0B1120] font-semibold text-slate-900 dark:text-white">UPI / QR</button>
                  <button type="button" data-pm="card" class="chk-pm-btn py-2.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium">Card</button>
                  <button type="button" data-pm="netbanking" class="chk-pm-btn py-2.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium">NetBanking</button>
                </div>
                <button type="button" id="chk-sandbox-pay" class="w-full min-h-[48px] py-3 px-4 text-sm font-semibold rounded-xl bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors shadow-sm">
                  Pay ${formatInr(order.amountInr)} &amp; Unlock Content
                </button>
                <div class="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                  <span>Test Checkout Mode</span>
                  <button type="button" id="chk-sandbox-fail" class="text-red-600 dark:text-red-400 hover:underline font-medium shrink-0">Simulate Failed Payment</button>
                </div>
              </div>`
            : `<div class="space-y-2.5">
                ${
                  isRazorpayTestKey
                    ? `<div class="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-200">
                        <strong>Test Mode</strong> — Use test UPI (<code class="font-mono">success@razorpay</code>) or test card safely with zero real charges.
                      </div>`
                    : ''
                }
                <button type="button" id="chk-razorpay-live" class="w-full min-h-[48px] py-3 px-4 text-sm font-semibold rounded-xl bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 disabled:opacity-60 disabled:cursor-not-allowed dark:text-slate-950 text-white transition-colors shadow-sm">
                  Pay ${formatInr(order.amountInr)} Securely
                </button>
                <p class="text-center text-[11px] text-slate-500 dark:text-slate-400">
                  Supports UPI, Credit/Debit Cards, NetBanking &amp; Wallets
                </p>
              </div>`
        }
      </div>
    `,
    onMount: (close) => {
      document.querySelectorAll('.chk-pm-btn').forEach((pmBtn) => {
        pmBtn.addEventListener('click', () => {
          document.querySelectorAll('.chk-pm-btn').forEach((b) => {
            const active = b === pmBtn;
            b.className = active
              ? 'chk-pm-btn py-2.5 px-2 rounded-lg border-2 border-[#0F2547] dark:border-sky-400 bg-slate-50 dark:bg-[#0B1120] font-semibold text-slate-900 dark:text-white'
              : 'chk-pm-btn py-2.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium';
          });
        });
      });

      document.getElementById('chk-sandbox-pay')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Processing & verifying payment...';
        try {
          const res = await apiFetch('/api/payments/verify', {
            method: 'POST',
            body: {
              orderId: order.orderId,
              providerPaymentId: order.sandboxCheckout.providerPaymentId,
              providerSignature: order.sandboxCheckout.providerSignature,
            },
          });
          showToast(res.message, 'success');
          close();
          onSuccess();
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
          btn.textContent = `Pay ${formatInr(order.amountInr)} & Unlock Content`;
        }
      });

      document.getElementById('chk-sandbox-fail')?.addEventListener('click', async () => {
        try {
          const res = await apiFetch('/api/payments/fail', {
            method: 'POST',
            body: { orderId: order.orderId, reason: 'Simulated bank decline in sandbox mode' },
          });
          showToast(res.message, 'info');
          close();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });

      document.getElementById('chk-razorpay-live')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const resetBtn = () => {
          btn.disabled = false;
          btn.textContent = `Pay ${formatInr(order.amountInr)} Securely`;
        };
        btn.disabled = true;
        btn.textContent = 'Opening secure checkout...';

        const launch = () => {
          const rzp = new window.Razorpay({
            key: order.keyId,
            amount: order.amountPaise,
            currency: 'INR',
            name: 'ScholarPress',
            description: order.contentTitle,
            image: `${window.location.origin}/scholarpress-app-icon.png`,
            order_id: order.orderId,
            prefill: {
              name: store.user?.name || '',
              email: store.user?.email || '',
            },
            theme: {
              color: '#0F2547',
            },
            modal: {
              ondismiss: () => {
                resetBtn();
              },
            },
            handler: async (resp) => {
              btn.textContent = 'Confirming payment & unlocking...';
              try {
                const verified = await apiFetch('/api/payments/verify', {
                  method: 'POST',
                  body: {
                    orderId: resp.razorpay_order_id,
                    providerPaymentId: resp.razorpay_payment_id,
                    providerSignature: resp.razorpay_signature,
                  },
                });
                showToast(verified.message, 'success');
                close();
                onSuccess();
              } catch (err) {
                showToast(err.message || 'Payment verification failed.', 'error');
                resetBtn();
              }
            },
          });
          rzp.on('payment.failed', async (failResp) => {
            const desc = failResp?.error?.description || 'Payment declined by Razorpay';
            try {
              await apiFetch('/api/payments/fail', {
                method: 'POST',
                body: { orderId: order.orderId, reason: desc },
              });
            } catch {}
            showToast(desc, 'error');
            resetBtn();
          });
          rzp.open();
        };

        if (window.Razorpay) {
          launch();
        } else {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = launch;
          script.onerror = () => {
            showToast('Unable to load Razorpay Checkout script. Please check your internet connection.', 'error');
            resetBtn();
          };
          document.head.appendChild(script);
        }
      });
    },
  });
}

function buildWatermarkSvgUrl(text) {
  const safeWm = String(text || 'ScholarPress')
    .replace(/[<>&"']/g, '')
    .slice(0, 68);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="190"><g transform="rotate(-24 160 95)"><text x="14" y="92" fill="rgba(15,23,42,0.22)" stroke="rgba(255,255,255,0.4)" stroke-width="0.6" paint-order="stroke" font-family="system-ui,sans-serif" font-size="13" font-weight="700">${safeWm}</text></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function attachContentProtectionShield(rootEl, watermarkText) {
  let cleanedUp = false;
  let tampered = false;
  let blurTimer = null;

  const wmUrl = buildWatermarkSvgUrl(watermarkText);

  const wmOverlay = document.createElement('div');
  wmOverlay.dataset.spReaderWatermark = '1';
  wmOverlay.setAttribute('aria-hidden', 'true');
  wmOverlay.style.cssText = [
    'position:absolute',
    'inset:0',
    'z-index:30',
    'pointer-events:none',
    'user-select:none',
    'margin:0',
    `background-image:url("${wmUrl}")`,
    'background-repeat:repeat',
  ].join(';');

  const shieldOverlay = document.createElement('div');
  shieldOverlay.dataset.spCaptureShield = '1';
  shieldOverlay.style.cssText = [
    'position:absolute',
    'inset:0',
    'z-index:40',
    'margin:0',
    'display:none',
    'align-items:center',
    'justify-content:center',
    'padding:1.5rem',
    'background:rgba(15,23,42,0.82)',
    'backdrop-filter:blur(10px)',
    '-webkit-backdrop-filter:blur(10px)',
    'color:#f8fafc',
    'text-align:center',
    'border-radius:0.75rem',
  ].join(';');
  shieldOverlay.innerHTML =
    '<div style="max-width:340px"><div style="font-weight:700;font-size:15px;margin-bottom:6px">Protected Content Paused</div><div style="font-size:12px;color:#cbd5e1;line-height:1.5">Return focus to this window to continue reading. Screen capture, printing, and copying are restricted on paid publications.</div></div>';

  const safeWmText = String(watermarkText || 'ScholarPress')
    .replace(/[<>&"']/g, '')
    .slice(0, 68);

  const movingBadge = document.createElement('div');
  movingBadge.dataset.spMovingWatermark = '1';
  movingBadge.setAttribute('aria-hidden', 'true');
  movingBadge.textContent = safeWmText;
  movingBadge.style.cssText = [
    'position:absolute',
    'top:8%',
    'left:8%',
    'z-index:32',
    'pointer-events:none',
    'user-select:none',
    'margin:0',
    'padding:3px 9px',
    'border-radius:6px',
    'background:rgba(15,23,42,0.48)',
    'border:1px solid rgba(255,255,255,0.2)',
    'color:rgba(255,255,255,0.86)',
    'font-size:11px',
    'font-weight:600',
    'font-family:ui-monospace,SFMono-Regular,monospace',
    'max-width:80%',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
    'transition:top 1100ms ease, left 1100ms ease',
  ].join(';');

  rootEl.appendChild(wmOverlay);
  rootEl.appendChild(movingBadge);
  rootEl.appendChild(shieldOverlay);

  const videoOverlays = [];
  rootEl.querySelectorAll('.sp-video-wrap').forEach((wrap) => {
    const vWm = document.createElement('div');
    vWm.setAttribute('aria-hidden', 'true');
    vWm.style.cssText = [
      'position:absolute',
      'inset:0',
      'z-index:20',
      'pointer-events:none',
      'user-select:none',
      `background-image:url("${wmUrl}")`,
      'background-repeat:repeat',
    ].join(';');
    wrap.appendChild(vWm);
    videoOverlays.push(vWm);

    const fsBtn = wrap.querySelector('.sp-video-fs-btn');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        if (document.fullscreenElement === wrap) {
          document.exitFullscreen?.();
        } else {
          wrap.requestFullscreen?.();
        }
      });
    }
    const vid = wrap.querySelector('video');
    if (vid) {
      vid.addEventListener('enterpictureinpicture', () => {
        try {
          vid.pause();
          document.exitPictureInPicture?.();
        } catch {}
      });
    }
  });

  const movingTimer = setInterval(() => {
    if (cleanedUp || tampered || !rootEl.isConnected) return;
    const topPct = 6 + Math.floor(Math.random() * 78);
    const leftPct = 5 + Math.floor(Math.random() * 52);
    movingBadge.style.top = `${topPct}%`;
    movingBadge.style.left = `${leftPct}%`;
    const shiftX = Math.floor(Math.random() * 140);
    const shiftY = Math.floor(Math.random() * 90);
    for (const vo of videoOverlays) {
      vo.style.backgroundPosition = `${shiftX}px ${shiftY}px`;
    }
  }, 4000);

  const contentSections = () =>
    Array.from(rootEl.children).filter(
      (el) => el !== wmOverlay && el !== movingBadge && el !== shieldOverlay
    );

  const setShieldActive = (active) => {
    if (cleanedUp || tampered) return;
    for (const sec of contentSections()) {
      sec.classList.toggle('sp-protected-blur', active);
    }
    if (active) {
      rootEl.querySelectorAll('video').forEach((v) => {
        try {
          if (!v.paused) v.pause();
        } catch {}
      });
      shieldOverlay.style.display = 'flex';
    } else {
      shieldOverlay.style.display = 'none';
    }
  };

  const lockForTampering = () => {
    if (cleanedUp || tampered || !rootEl.isConnected) return;
    tampered = true;
    observer.disconnect();
    clearInterval(integrityTimer);
    clearInterval(movingTimer);
    clearTimeout(blurTimer);
    rootEl.querySelectorAll('video').forEach((v) => {
      try {
        v.pause();
        v.removeAttribute('src');
      } catch {}
    });
    rootEl.innerHTML = `
      <div class="p-6 sm:p-8 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-center space-y-3">
        <div class="text-sm font-semibold text-red-800 dark:text-red-300">Protected Content Locked</div>
        <p class="text-xs text-red-700 dark:text-red-400 max-w-md mx-auto leading-relaxed">
          Security watermark or reader protection was altered in the browser. Reload the page to restore authorized viewing.
        </p>
        <button type="button" id="sp-reload-protected-btn" class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0F2547] dark:bg-sky-500 text-white dark:text-slate-950">
          Reload Page
        </button>
      </div>
    `;
    document.getElementById('sp-reload-protected-btn')?.addEventListener('click', () => {
      window.location.reload();
    });
    showToast('Protected content locked: tampering detected.', 'error');
  };

  const checkIntegrity = () => {
    if (cleanedUp || tampered || !rootEl.isConnected) return;
    if (rootEl.dataset.paidProtected !== '1') {
      lockForTampering();
      return;
    }
    if (
      !rootEl.contains(wmOverlay) ||
      !rootEl.contains(movingBadge) ||
      !rootEl.contains(shieldOverlay)
    ) {
      lockForTampering();
      return;
    }
    if (!rootEl.classList.contains('hidden')) {
      const cs = window.getComputedStyle(wmOverlay);
      const mbCs = window.getComputedStyle(movingBadge);
      if (
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        Number(cs.opacity) < 0.5 ||
        !wmOverlay.style.backgroundImage ||
        mbCs.display === 'none' ||
        mbCs.visibility === 'hidden' ||
        Number(mbCs.opacity) < 0.5
      ) {
        lockForTampering();
      }
    }
  };

  const observer = new MutationObserver(() => {
    checkIntegrity();
  });
  observer.observe(rootEl, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden', 'data-paid-protected'],
  });
  const integrityTimer = setInterval(checkIntegrity, 2000);

  const blockAction = (e) => {
    e.preventDefault();
    return false;
  };

  const onBlur = () => setShieldActive(true);
  const onFocus = () => {
    if (!document.hidden) setShieldActive(false);
  };
  const onVisibilityChange = () => {
    setShieldActive(document.hidden);
  };
  const onKeyDown = (e) => {
    const k = String(e.key || '').toLowerCase();
    const hasMod = e.ctrlKey || e.metaKey;
    const isInspect =
      e.key === 'F12' ||
      (hasMod && e.shiftKey && ['i', 'j', 'c', 's'].includes(k)) ||
      (hasMod && ['s', 'p', 'u'].includes(k)) ||
      (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(k));
    const isCopyInsideReader =
      hasMod && k === 'c' && rootEl.contains(document.activeElement);

    if (e.key === 'PrintScreen' || isInspect || isCopyInsideReader) {
      e.preventDefault();
      setShieldActive(true);
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!document.hidden && document.hasFocus()) setShieldActive(false);
      }, 1500);
    }
  };

  rootEl.addEventListener('contextmenu', blockAction);
  rootEl.addEventListener('copy', blockAction);
  rootEl.addEventListener('cut', blockAction);
  rootEl.addEventListener('dragstart', blockAction);
  rootEl.addEventListener('selectstart', blockAction);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('keydown', onKeyDown, true);

  return () => {
    cleanedUp = true;
    clearTimeout(blurTimer);
    clearInterval(integrityTimer);
    clearInterval(movingTimer);
    observer.disconnect();
    rootEl.removeEventListener('contextmenu', blockAction);
    rootEl.removeEventListener('copy', blockAction);
    rootEl.removeEventListener('cut', blockAction);
    rootEl.removeEventListener('dragstart', blockAction);
    rootEl.removeEventListener('selectstart', blockAction);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('keydown', onKeyDown, true);
  };
}
