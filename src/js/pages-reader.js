import {
  apiFetch,
  esc,
  formatBytes,
  formatDate,
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

export function cleanupReaderProgress() {
  clearTrackedContent();
  if (activeScrollHandler) {
    window.removeEventListener('scroll', activeScrollHandler);
    activeScrollHandler = null;
  }
  const bar = document.getElementById('reading-progress-bar');
  if (bar) bar.remove();
}

export async function renderContentDetailPage(container, slug) {
  cleanupReaderProgress();
  container.innerHTML = `<div class="max-w-6xl mx-auto px-4 py-14 text-sm text-slate-500">Loading publication...</div>`;

  try {
    const data = await apiFetch(`/api/catalog/contents/${encodeURIComponent(slug)}`);
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
                  <span aria-hidden="true">·</span>
                  <span>${esc(c.contentType)}</span>
                  <span aria-hidden="true">·</span>
                  <span>${esc(c.language)}</span>
                  <span aria-hidden="true">·</span>
                  <span class="tabular-nums">${c.readingTimeMins} min read</span>
                </div>

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

                  <div id="rd-unlocked-content" class="${videoFiles.length > 0 ? '' : 'hidden '}space-y-6 sm:space-y-8">
                    <!-- Video Lecture Player -->
                    ${
                      videoFiles.length
                        ? `<section class="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6">
                            <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
                              <h2 class="font-display text-xl font-semibold text-slate-900 dark:text-white">Video Lecture</h2>
                              <span class="text-xs font-medium text-emerald-700 dark:text-emerald-400">Ready to Watch</span>
                            </div>
                            ${videoFiles
                              .map((vf) => {
                                if (vf.externalVideoUrl) {
                                  const resolved = resolveVideoEmbed(vf.externalVideoUrl);
                                  const embedSrc = resolved ? resolved.embedUrl : vf.externalVideoUrl;
                                  const watchHref = resolved ? resolved.watchUrl : vf.externalVideoUrl;
                                  const providerLabel = resolved ? resolved.provider : 'Video';
                                  return `<div class="space-y-2.5">
                                      <div class="aspect-video w-full rounded-xl overflow-hidden bg-black border border-slate-200 dark:border-slate-800 shadow-sm">
                                        <iframe
                                          src="${esc(embedSrc)}"
                                          title="${esc(vf.originalName || c.title)}"
                                          class="w-full h-full border-0"
                                          loading="lazy"
                                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                          referrerpolicy="strict-origin-when-cross-origin"
                                          allowfullscreen
                                        ></iframe>
                                      </div>
                                      <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                                        <span class="truncate">${esc(vf.originalName || c.title)}</span>
                                        <a href="${esc(watchHref)}" target="_blank" rel="noopener noreferrer" class="font-semibold text-[#5a1fd8] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0">
                                          Open on ${esc(providerLabel)} ↗
                                        </a>
                                      </div>
                                    </div>`;
                                }
                                return `<div class="space-y-2">
                                    <video controls controlsList="nodownload" class="w-full rounded-lg bg-black max-h-[480px]" src="${esc(withAuthParam(vf.accessUrl))}"></video>
                                    <p class="text-xs text-slate-500">${esc(vf.originalName)} · ${formatBytes(vf.sizeBytes)}</p>
                                  </div>`;
                              })
                              .join('')}
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
                                  <div class="overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 h-[380px] sm:h-[520px] lg:h-[600px]">
                                    <iframe id="pdf-viewer-frame" src="${esc(withAuthParam(pf.accessUrl))}#toolbar=1" class="w-full h-full transition-transform origin-top-left" title="${esc(pf.originalName)}"></iframe>
                                  </div>
                                  <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                                    <span class="truncate">${esc(pf.originalName)} · ${formatBytes(pf.sizeBytes)}</span>
                                    <a href="${esc(withAuthParam(`${pf.accessUrl}?download=1`))}" class="font-semibold text-[#0F2547] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0">Download PDF</a>
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
                                  const dlUrl = `${imgFile.accessUrl}${imgFile.accessUrl.includes('?') ? '&' : '?'}download=1`;
                                  return `
                                    <button type="button" data-gallery-src="${esc(imgFullSrc)}" data-gallery-name="${esc(imgFile.originalName)}" data-gallery-dl="${esc(withAuthParam(dlUrl))}" class="rd-gallery-item group text-left rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120] hover:border-[#0F2547] dark:hover:border-sky-400 transition-colors">
                                      <div class="aspect-[4/3] w-full overflow-hidden bg-slate-100 dark:bg-slate-900">
                                        <img src="${esc(imgThumbSrc)}" data-full-src="${esc(imgFullSrc)}" alt="${esc(imgFile.originalName || `Photo ${i + 1}`)}" loading="lazy" decoding="async" class="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200" />
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
                                    <a href="${esc(withAuthParam(`${df.accessUrl}?download=1`))}" class="font-semibold text-[#0F2547] dark:text-sky-400 hover:underline">Download</a>
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
                <span class="font-mono text-2xl font-semibold ${c.isFree ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-white'} tabular-nums">
                  ${c.isFree ? 'Free' : formatInr(c.priceInr)}
                </span>
              </div>
              ${
                c.hasAccess
                  ? `<div class="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs font-medium text-emerald-800 dark:text-emerald-300 mb-3">
                      ${c.hasPurchased ? 'Purchased &amp; unlocked in your library.' : c.isFree ? 'Open-access free publication.' : 'Full preview access (Creator / Admin).'}
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
                <div class="flex justify-between"><dt class="text-slate-500">Format</dt><dd class="font-medium text-slate-900 dark:text-slate-200">${esc(c.contentType)}</dd></div>
                <div class="flex justify-between"><dt class="text-slate-500">Language</dt><dd class="font-medium text-slate-900 dark:text-slate-200">${esc(c.language)}</dd></div>
                <div class="flex justify-between"><dt class="text-slate-500">Est. Study Time</dt><dd class="font-mono text-slate-900 dark:text-slate-200 tabular-nums">${c.readingTimeMins} min</dd></div>
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

        <!-- Related Content -->
        ${
          data.related?.length
            ? `<section class="mt-10 sm:mt-16 pt-8 sm:pt-10 border-t border-slate-200 dark:border-slate-800">
                <h2 class="font-display text-2xl font-semibold text-slate-900 dark:text-white mb-6">Related Publications</h2>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6">
                  ${data.related.map(renderContentCard).join('')}
                </div>
              </section>`
            : ''
        }
      </div>
    `;

    // Wire TOC smooth scroll
    container.querySelectorAll('.toc-link').forEach((link) => {
      link.addEventListener('click', () => {
        document.getElementById(link.dataset.scrollTarget)?.scrollIntoView({ behavior: 'smooth' });
      });
    });

    // Wire Full-Screen Multi-Page Photo Gallery Lightbox
    const galleryBtns = Array.from(container.querySelectorAll('.rd-gallery-item'));
    galleryBtns.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        const inlineImgs = Array.from(container.querySelectorAll('#rd-unlocked-content .reading-prose img'))
          .filter((img) => img.getAttribute('src'))
          .map((img, i) => ({
            src: img.currentSrc || img.getAttribute('src'),
            title: img.getAttribute('alt') || `Content Page ${i + 1}`,
          }));
        const attachedPhotos = galleryBtns
          .filter((b) => b.dataset.gallerySrc)
          .map((b, i) => ({
            src: b.dataset.gallerySrc,
            title: b.dataset.galleryName || `Gallery Photo ${i + 1}`,
            downloadHref: b.dataset.galleryDl || '',
          }));
        const allImages = [...attachedPhotos, ...inlineImgs];
        openImageLightbox({ images: allImages, startIndex: idx });
      });
    });

    // Wire PDF Full Screen viewer modal
    document.getElementById('pdf-fullscreen-btn')?.addEventListener('click', () => {
      const frame = document.getElementById('pdf-viewer-frame');
      const src = frame?.getAttribute('src');
      if (!src) return;
      openModal({
        title: frame.getAttribute('title') || 'PDF Document Viewer',
        widthClass: 'max-w-6xl',
        bodyHtml: `
          <div class="w-full h-[80vh] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950">
            <iframe src="${esc(src)}" class="w-full h-full border-0" title="Full Screen PDF Reader"></iframe>
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
  const commissionCut = Number(((order.amountInr * order.commissionRate) / 100).toFixed(2));
  const creatorNet = Number((order.amountInr - commissionCut).toFixed(2));

  openModal({
    title: 'Secure INR Payment Checkout',
    bodyHtml: `
      <div class="space-y-5">
        <div class="p-4 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 space-y-2 text-sm">
          <div class="flex justify-between gap-4">
            <span class="text-slate-500 dark:text-slate-400">Publication</span>
            <span class="font-semibold text-slate-900 dark:text-white text-right">${esc(order.contentTitle)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500 dark:text-slate-400">Order Reference</span>
            <span class="font-mono text-xs text-slate-700 dark:text-slate-300">${esc(order.orderId)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500 dark:text-slate-400">Receipt Number</span>
            <span class="font-mono text-xs text-slate-700 dark:text-slate-300">${esc(order.receiptNumber)}</span>
          </div>
          <div class="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-baseline">
            <span class="font-semibold text-slate-900 dark:text-white">Total Payable</span>
            <span class="font-mono text-xl font-semibold text-[#0F2547] dark:text-sky-300 tabular-nums">${formatInr(order.amountInr)}</span>
          </div>
        </div>

        ${
          order.mode === 'sandbox'
            ? `<div class="space-y-3">
                <div class="text-xs font-semibold text-slate-700 dark:text-slate-300">Select Payment Method (Instant Sandbox Checkout)</div>
                <div class="grid grid-cols-3 gap-2 text-xs">
                  <button type="button" data-pm="upi" class="chk-pm-btn py-2.5 px-2 rounded-lg border-2 border-[#0F2547] dark:border-sky-400 bg-slate-50 dark:bg-[#0B1120] font-semibold text-slate-900 dark:text-white">UPI / QR</button>
                  <button type="button" data-pm="card" class="chk-pm-btn py-2.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium">Card</button>
                  <button type="button" data-pm="netbanking" class="chk-pm-btn py-2.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium">NetBanking</button>
                </div>
                <button type="button" id="chk-sandbox-pay" class="w-full min-h-[46px] py-3 px-4 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 transition-colors">
                  Pay ${formatInr(order.amountInr)} &amp; Unlock Content
                </button>
                <div class="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                  <span>Sandbox Mode (Add Razorpay keys in env for real money)</span>
                  <button type="button" id="chk-sandbox-fail" class="text-red-600 dark:text-red-400 hover:underline font-medium shrink-0">Test Failure</button>
                </div>
              </div>`
            : `<button type="button" id="chk-razorpay-live" class="w-full min-h-[46px] py-3 px-4 text-sm font-semibold rounded-lg bg-[#0F2547] hover:bg-[#1B3B6F] dark:bg-sky-500 dark:text-slate-950 text-white">
                Pay ${formatInr(order.amountInr)} via Razorpay (UPI / Card / NetBanking)
              </button>`
        }

        <div class="text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
          <p>Creator receives <strong class="font-mono text-slate-800 dark:text-slate-200">${formatInr(creatorNet)}</strong> · Platform fee (${order.commissionRate}%): <strong class="font-mono text-slate-800 dark:text-slate-200">${formatInr(commissionCut)}</strong>.</p>
          <p>Instant lifetime access &amp; verified server-side HMAC-SHA256 settlement.</p>
        </div>
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

      document.getElementById('chk-razorpay-live')?.addEventListener('click', () => {
        const launch = () => {
          const rzp = new window.Razorpay({
            key: order.keyId,
            amount: order.amountPaise,
            currency: 'INR',
            name: 'ScholarPress',
            description: order.contentTitle,
            order_id: order.orderId,
            handler: async (resp) => {
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
                showToast(err.message, 'error');
              }
            },
          });
          rzp.open();
        };

        if (window.Razorpay) {
          launch();
        } else {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = launch;
          script.onerror = () => showToast('Unable to load Razorpay Checkout script.', 'error');
          document.head.appendChild(script);
        }
      });
    },
  });
}
