/**
 * Full-Screen Pure-Black Gesture Image Viewer (WhatsApp / Google Photos / ChatGPT style)
 *
 * Features:
 * - Pure black (#000) full-screen overlay displaying only the centered fit-to-screen image
 * - Two-finger pinch-to-zoom anchored between fingers (1x–4x with rubber-band & snap)
 * - One-finger pan/drag when zoomed with strict boundary clamping & natural inertia
 * - Double-tap (mobile) & double-click (desktop) focal zoom (2.5x <-> 1x)
 * - Horizontal swipe navigation between multiple images with live 3-slide track & preloading
 * - Vertical swipe-down to dismiss at 1x zoom
 * - Desktop mouse wheel / trackpad pinch zoom, mouse drag pan/swipe, keyboard controls (Esc, Arrows)
 * - Minimal floating Close (X) button; restores exact page & scroll position on close
 */

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const SLIDE_GAP = 24;

let activeViewerCleanup = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getTouchDistance(t1, t2) {
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return Math.hypot(dx, dy);
}

function getTouchMidpoint(t1, t2) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  };
}

function normalizeImages(images) {
  const seen = [];
  for (const item of images || []) {
    if (!item) continue;
    const src = typeof item === 'string' ? item : item.src;
    if (!src) continue;
    seen.push({
      src,
      alt: (typeof item === 'object' ? item.title || item.alt : '') || '',
    });
  }
  return seen;
}

export function openImageLightbox({ images = [], startIndex = 0 } = {}) {
  const validImages = normalizeImages(images);
  if (!validImages.length) return;

  // Close any previous viewer cleanly before opening a new one
  if (typeof activeViewerCleanup === 'function') {
    activeViewerCleanup(true);
  }

  let currentIdx = clamp(Number(startIndex) || 0, 0, validImages.length - 1);
  const hasMultiple = validImages.length > 1;

  // Preserve exact page & scroll position
  const savedScrollX = window.scrollX || window.pageXOffset || 0;
  const savedScrollY = window.scrollY || window.pageYOffset || 0;
  const prevBodyOverflow = document.body.style.overflow;
  const prevHtmlOverscroll = document.documentElement.style.overscrollBehavior;

  document.body.style.overflow = 'hidden';
  document.documentElement.style.overscrollBehavior = 'none';

  // Transform state for active image
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let isClosing = false;
  let isSlideAnimating = false;
  let slideTimer = null;

  // Build pure-black minimal full-screen DOM
  const overlay = document.createElement('div');
  overlay.id = 'sp-image-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Full-screen image viewer');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:9999',
    'background:#000000',
    'overflow:hidden',
    'touch-action:none',
    'overscroll-behavior:none',
    'user-select:none',
    '-webkit-user-select:none',
    '-webkit-touch-callout:none',
    'opacity:0',
    'transition:opacity 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
  ].join(';');

  // Backdrop layer (fades independently during vertical swipe-to-dismiss)
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:absolute;inset:0;background:#000000;pointer-events:none;transition:opacity 180ms ease;';
  overlay.appendChild(backdrop);

  // Stage & 3-slide track ([prev, current, next])
  const stage = document.createElement('div');
  stage.style.cssText =
    'position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;';
  overlay.appendChild(stage);

  const track = document.createElement('div');
  track.style.cssText =
    'position:absolute;inset:0;will-change:transform;transform:translate3d(0,0,0);';
  stage.appendChild(track);

  function createSlide(offsetSign) {
    const slide = document.createElement('div');
    slide.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'width:100%',
      'height:100%',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'overflow:hidden',
      'pointer-events:none',
    ].join(';');
    if (offsetSign !== 0) {
      slide.style.transform = `translate3d(calc(${offsetSign * 100}% + ${offsetSign * SLIDE_GAP}px), 0, 0)`;
    } else {
      slide.style.pointerEvents = 'auto';
    }

    const spinner = document.createElement('div');
    spinner.style.cssText = [
      'position:absolute',
      'width:28px',
      'height:28px',
      'border-radius:9999px',
      'border:2.5px solid rgba(255,255,255,0.2)',
      'border-top-color:rgba(255,255,255,0.9)',
      'animation:spViewerSpin 0.75s linear infinite',
      'opacity:0',
      'pointer-events:none',
      'transition:opacity 140ms ease',
    ].join(';');

    const img = document.createElement('img');
    img.draggable = false;
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.style.cssText = [
      'max-width:100vw',
      'max-height:100dvh',
      'width:auto',
      'height:auto',
      'object-fit:contain',
      'display:block',
      'transform-origin:center center',
      'will-change:transform',
      'user-select:none',
      '-webkit-user-drag:none',
      'opacity:0',
      'transition:opacity 180ms ease',
    ].join(';');

    slide.appendChild(spinner);
    slide.appendChild(img);
    track.appendChild(slide);
    return { slide, img, spinner };
  }

  // Inject single lightweight keyframe rule once for the tiny loading spinner
  if (!document.getElementById('sp-viewer-keyframes')) {
    const styleTag = document.createElement('style');
    styleTag.id = 'sp-viewer-keyframes';
    styleTag.textContent = '@keyframes spViewerSpin { to { transform: rotate(360deg); } }';
    document.head.appendChild(styleTag);
  }

  const prevSlide = createSlide(-1);
  const currSlide = createSlide(0);
  const nextSlide = createSlide(1);

  // Small floating Close (X) button — minimal, unobtrusive, always accessible
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close image viewer');
  closeBtn.style.cssText = [
    'position:fixed',
    'top:max(14px, env(safe-area-inset-top))',
    'right:max(14px, env(safe-area-inset-right))',
    'z-index:20',
    'width:40px',
    'height:40px',
    'border-radius:9999px',
    'border:1px solid rgba(255,255,255,0.16)',
    'background:rgba(0,0,0,0.52)',
    'color:#ffffff',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'cursor:pointer',
    'backdrop-filter:blur(6px)',
    '-webkit-backdrop-filter:blur(6px)',
    'transition:background 150ms ease, transform 150ms ease',
  ].join(';');
  closeBtn.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = 'rgba(255,255,255,0.2)';
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = 'rgba(0,0,0,0.52)';
  });
  overlay.appendChild(closeBtn);

  // Minimal page counter (ONLY shown when multiple images exist)
  let counterEl = null;
  let prevArrowBtn = null;
  let nextArrowBtn = null;

  if (hasMultiple) {
    counterEl = document.createElement('div');
    counterEl.setAttribute('aria-live', 'polite');
    counterEl.style.cssText = [
      'position:fixed',
      'top:max(18px, env(safe-area-inset-top))',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:20',
      'padding:4px 11px',
      'border-radius:9999px',
      'background:rgba(0,0,0,0.48)',
      'color:rgba(255,255,255,0.9)',
      'font-size:12px',
      'font-weight:500',
      'font-variant-numeric:tabular-nums',
      'letter-spacing:0.02em',
      'pointer-events:none',
      'backdrop-filter:blur(6px)',
      '-webkit-backdrop-filter:blur(6px)',
    ].join(';');
    overlay.appendChild(counterEl);

    // Subtle desktop-only navigation arrows (hidden on touch/mobile viewports)
    const makeArrowBtn = (dir) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', dir < 0 ? 'Previous image' : 'Next image');
      btn.className = 'hidden md:flex';
      btn.style.cssText = [
        'position:fixed',
        dir < 0 ? 'left:18px' : 'right:18px',
        'top:50%',
        'transform:translateY(-50%)',
        'z-index:20',
        'width:42px',
        'height:42px',
        'border-radius:9999px',
        'border:1px solid rgba(255,255,255,0.14)',
        'background:rgba(0,0,0,0.45)',
        'color:#ffffff',
        'align-items:center',
        'justify-content:center',
        'cursor:pointer',
        'backdrop-filter:blur(6px)',
        '-webkit-backdrop-filter:blur(6px)',
        'transition:opacity 150ms ease, background 150ms ease',
      ].join(';');
      btn.innerHTML =
        dir < 0
          ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>'
          : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(255,255,255,0.2)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(0,0,0,0.45)';
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateBy(dir);
      });
      overlay.appendChild(btn);
      return btn;
    };

    prevArrowBtn = makeArrowBtn(-1);
    nextArrowBtn = makeArrowBtn(1);
  }

  // Image preloader cache for instant swiping
  const preloadedUrls = new Set();
  function preloadIndex(idx) {
    if (idx < 0 || idx >= validImages.length) return;
    const url = validImages[idx].src;
    if (preloadedUrls.has(url)) return;
    preloadedUrls.add(url);
    const loader = new Image();
    loader.referrerPolicy = 'no-referrer';
    loader.decoding = 'async';
    loader.src = url;
  }

  function fitSlotImage(slot) {
    const img = slot.img;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fitRatio = Math.min(vw / nw, vh / nh);
    img.style.width = `${Math.round(nw * fitRatio)}px`;
    img.style.height = `${Math.round(nh * fitRatio)}px`;
  }

  function setSlideSource(slot, item) {
    if (!item) {
      slot.img.removeAttribute('src');
      slot.img.alt = '';
      slot.img.style.width = 'auto';
      slot.img.style.height = 'auto';
      slot.img.style.opacity = '0';
      slot.spinner.style.opacity = '0';
      slot.slide.style.visibility = 'hidden';
      return;
    }

    slot.slide.style.visibility = 'visible';
    slot.img.alt = item.alt;

    if (slot.img.getAttribute('src') === item.src && slot.img.complete && slot.img.naturalWidth > 0) {
      fitSlotImage(slot);
      slot.img.style.opacity = '1';
      slot.spinner.style.opacity = '0';
      return;
    }

    slot.img.style.width = 'auto';
    slot.img.style.height = 'auto';
    slot.img.style.opacity = '0';
    slot.spinner.style.opacity = '1';

    const onDone = () => {
      fitSlotImage(slot);
      slot.spinner.style.opacity = '0';
      slot.img.style.opacity = '1';
    };
    slot.img.onload = onDone;
    slot.img.onerror = () => {
      slot.spinner.style.opacity = '0';
      slot.img.style.opacity = '1';
    };
    slot.img.src = item.src;

    if (slot.img.complete && slot.img.naturalWidth > 0) {
      onDone();
    }
  }

  // Compute fitted (1x) image dimensions inside current viewport
  function getFittedImageSize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const img = currSlide.img;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;

    if (nw > 0 && nh > 0) {
      const fitRatio = Math.min(vw / nw, vh / nh);
      return { w: nw * fitRatio, h: nh * fitRatio, vw, vh };
    }

    return {
      w: img.offsetWidth || vw,
      h: img.offsetHeight || vh,
      vw,
      vh,
    };
  }

  function getPanBounds(forScale = scale) {
    const { w, h, vw, vh } = getFittedImageSize();
    return {
      maxTx: Math.max(0, (w * forScale - vw) / 2),
      maxTy: Math.max(0, (h * forScale - vh) / 2),
    };
  }

  function clampPosition(nextTx, nextTy, forScale = scale) {
    const { maxTx, maxTy } = getPanBounds(forScale);
    return {
      tx: clamp(nextTx, -maxTx, maxTx),
      ty: clamp(nextTy, -maxTy, maxTy),
    };
  }

  function updateCursor() {
    if (scale > 1.02) {
      stage.style.cursor = mouseState.dragging ? 'grabbing' : 'grab';
    } else {
      stage.style.cursor = 'default';
    }
  }

  function applyImageTransform(animate = false) {
    const img = currSlide.img;
    img.style.transition = animate
      ? 'transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease'
      : 'opacity 180ms ease';
    img.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
    updateCursor();
  }

  function resetTransform(animate = false) {
    scale = 1;
    tx = 0;
    ty = 0;
    applyImageTransform(animate);
  }

  function zoomAroundPoint(targetScale, clientX, clientY, animate = false) {
    const clampedScale = clamp(targetScale, MIN_SCALE, MAX_SCALE);
    if (clampedScale <= 1.01) {
      resetTransform(animate);
      return;
    }

    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const ratio = clampedScale / scale;
    const rawTx = clientX - cx - (clientX - cx - tx) * ratio;
    const rawTy = clientY - cy - (clientY - cy - ty) * ratio;

    scale = clampedScale;
    const clamped = clampPosition(rawTx, rawTy, scale);
    tx = clamped.tx;
    ty = clamped.ty;
    applyImageTransform(animate);
  }

  function toggleDoubleTapZoom(clientX, clientY) {
    if (scale > 1.05) {
      resetTransform(true);
    } else {
      zoomAroundPoint(DOUBLE_TAP_SCALE, clientX, clientY, true);
    }
  }

  function syncSlides() {
    track.style.transition = 'none';
    track.style.transform = 'translate3d(0, 0, 0)';
    scale = 1;
    tx = 0;
    ty = 0;
    currSlide.img.style.transition = 'opacity 180ms ease';
    currSlide.img.style.transform = 'translate3d(0, 0, 0) scale(1)';
    prevSlide.img.style.transform = 'translate3d(0, 0, 0) scale(1)';
    nextSlide.img.style.transform = 'translate3d(0, 0, 0) scale(1)';

    setSlideSource(currSlide, validImages[currentIdx]);
    setSlideSource(prevSlide, currentIdx > 0 ? validImages[currentIdx - 1] : null);
    setSlideSource(nextSlide, currentIdx < validImages.length - 1 ? validImages[currentIdx + 1] : null);

    // Preload 2 steps ahead/behind for effortless swiping
    preloadIndex(currentIdx - 1);
    preloadIndex(currentIdx + 1);
    preloadIndex(currentIdx - 2);
    preloadIndex(currentIdx + 2);

    if (counterEl) {
      counterEl.textContent = `${currentIdx + 1} / ${validImages.length}`;
    }
    if (prevArrowBtn) {
      const canPrev = currentIdx > 0;
      prevArrowBtn.style.opacity = canPrev ? '1' : '0.25';
      prevArrowBtn.style.pointerEvents = canPrev ? 'auto' : 'none';
    }
    if (nextArrowBtn) {
      const canNext = currentIdx < validImages.length - 1;
      nextArrowBtn.style.opacity = canNext ? '1' : '0.25';
      nextArrowBtn.style.pointerEvents = canNext ? 'auto' : 'none';
    }
    updateCursor();
  }

  function navigateBy(delta) {
    if (!hasMultiple || isSlideAnimating) return;
    const targetIdx = currentIdx + delta;
    if (targetIdx < 0 || targetIdx >= validImages.length) {
      // Snap back to center
      track.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
      track.style.transform = 'translate3d(0, 0, 0)';
      return;
    }

    isSlideAnimating = true;
    const shiftX = -delta * (window.innerWidth + SLIDE_GAP);
    track.style.transition = 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1)';
    track.style.transform = `translate3d(${shiftX}px, 0, 0)`;

    clearTimeout(slideTimer);
    slideTimer = setTimeout(() => {
      currentIdx = targetIdx;
      isSlideAnimating = false;
      syncSlides();
    }, 255);
  }

  // ===== TOUCH GESTURE ENGINE (Pinch-to-Zoom, Pan, Swipe Left/Right, Swipe Down to Close, Double-Tap) =====
  const touchState = {
    mode: 'none', // 'none' | 'pinch' | 'pan' | 'swipe-x' | 'swipe-y'
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    vx: 0,
    vy: 0,
    startTx: 0,
    startTy: 0,
    pinchStartDist: 1,
    pinchStartScale: 1,
    pinchOriginImgX: 0,
    pinchOriginImgY: 0,
    moved: false,
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
    suppressClickUntil: 0,
  };

  let inertiaRaf = null;
  function stopInertia() {
    if (inertiaRaf !== null) {
      cancelAnimationFrame(inertiaRaf);
      inertiaRaf = null;
    }
  }

  function startPanInertia(vx, vy) {
    stopInertia();
    if (scale <= 1.02) return;
    let curVx = clamp(vx, -2.5, 2.5);
    let curVy = clamp(vy, -2.5, 2.5);
    if (Math.hypot(curVx, curVy) < 0.15) return;

    let lastTs = performance.now();
    const step = (now) => {
      const dt = Math.min(32, now - lastTs);
      lastTs = now;
      const next = clampPosition(tx + curVx * dt, ty + curVy * dt, scale);
      const hitX = next.tx === tx && Math.abs(curVx) > 0.01;
      const hitY = next.ty === ty && Math.abs(curVy) > 0.01;
      tx = next.tx;
      ty = next.ty;
      applyImageTransform(false);

      const friction = Math.pow(0.92, dt / 16);
      curVx = hitX ? 0 : curVx * friction;
      curVy = hitY ? 0 : curVy * friction;

      if (Math.hypot(curVx, curVy) > 0.03) {
        inertiaRaf = requestAnimationFrame(step);
      } else {
        inertiaRaf = null;
      }
    };
    inertiaRaf = requestAnimationFrame(step);
  }

  function beginPinch(t1, t2) {
    stopInertia();
    const dist = Math.max(10, getTouchDistance(t1, t2));
    const mid = getTouchMidpoint(t1, t2);
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;

    touchState.mode = 'pinch';
    touchState.moved = true;
    touchState.pinchStartDist = dist;
    touchState.pinchStartScale = scale;
    touchState.pinchOriginImgX = (mid.x - cx - tx) / scale;
    touchState.pinchOriginImgY = (mid.y - cy - ty) / scale;

    // Ensure track is centered if pinch starts mid-swipe
    track.style.transition = 'none';
    track.style.transform = 'translate3d(0, 0, 0)';
    backdrop.style.opacity = '1';
  }

  function onTouchStart(e) {
    if (isClosing) return;
    if (e.target && e.target.closest('button')) return;
    e.preventDefault();
    stopInertia();

    const touches = e.touches;
    const now = performance.now();

    if (touches.length >= 2) {
      beginPinch(touches[0], touches[1]);
      return;
    }

    if (touches.length === 1) {
      const t = touches[0];
      touchState.startX = t.clientX;
      touchState.startY = t.clientY;
      touchState.lastX = t.clientX;
      touchState.lastY = t.clientY;
      touchState.lastTime = now;
      touchState.vx = 0;
      touchState.vy = 0;
      touchState.startTx = tx;
      touchState.startTy = ty;
      touchState.moved = false;
      touchState.mode = scale > 1.02 ? 'pan' : 'pending';
    }
  }

  function onTouchMove(e) {
    if (isClosing) return;
    if (e.target && e.target.closest('button')) return;
    e.preventDefault();

    const touches = e.touches;
    const now = performance.now();

    if (touches.length >= 2) {
      if (touchState.mode !== 'pinch') {
        beginPinch(touches[0], touches[1]);
      }
      const dist = Math.max(10, getTouchDistance(touches[0], touches[1]));
      const mid = getTouchMidpoint(touches[0], touches[1]);
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;

      let rawScale = touchState.pinchStartScale * (dist / touchState.pinchStartDist);
      // Gentle rubber-band resistance outside [1, MAX_SCALE]
      if (rawScale < MIN_SCALE) {
        rawScale = MIN_SCALE - (MIN_SCALE - rawScale) * 0.32;
        rawScale = Math.max(0.72, rawScale);
      } else if (rawScale > MAX_SCALE) {
        rawScale = MAX_SCALE + (rawScale - MAX_SCALE) * 0.28;
        rawScale = Math.min(MAX_SCALE + 1.2, rawScale);
      }

      scale = rawScale;
      const nextTx = mid.x - cx - touchState.pinchOriginImgX * scale;
      const nextTy = mid.y - cy - touchState.pinchOriginImgY * scale;

      if (scale >= MIN_SCALE) {
        const clamped = clampPosition(nextTx, nextTy, scale);
        tx = clamped.tx;
        ty = clamped.ty;
      } else {
        tx = nextTx * 0.35;
        ty = nextTy * 0.35;
      }

      applyImageTransform(false);
      return;
    }

    if (touches.length !== 1) return;
    const t = touches[0];
    const dx = t.clientX - touchState.startX;
    const dy = t.clientY - touchState.startY;
    const dt = Math.max(1, now - touchState.lastTime);

    touchState.vx = (t.clientX - touchState.lastX) / dt;
    touchState.vy = (t.clientY - touchState.lastY) / dt;
    touchState.lastX = t.clientX;
    touchState.lastY = t.clientY;
    touchState.lastTime = now;

    if (Math.hypot(dx, dy) > 8) {
      touchState.moved = true;
    }

    // Decide swipe axis when at 1x zoom
    if (touchState.mode === 'pending' && Math.hypot(dx, dy) > 8) {
      if (Math.abs(dx) >= Math.abs(dy) && hasMultiple) {
        touchState.mode = 'swipe-x';
      } else if (dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.15) {
        touchState.mode = 'swipe-y';
      } else if (hasMultiple) {
        touchState.mode = 'swipe-x';
      }
    }

    if (touchState.mode === 'pan') {
      const clamped = clampPosition(touchState.startTx + dx, touchState.startTy + dy, scale);
      tx = clamped.tx;
      ty = clamped.ty;
      applyImageTransform(false);
    } else if (touchState.mode === 'swipe-x' && !isSlideAnimating) {
      let dragX = dx;
      const atStart = currentIdx === 0 && dragX > 0;
      const atEnd = currentIdx === validImages.length - 1 && dragX < 0;
      if (atStart || atEnd) {
        dragX = dragX * 0.28;
      }
      track.style.transition = 'none';
      track.style.transform = `translate3d(${dragX}px, 0, 0)`;
    } else if (touchState.mode === 'swipe-y') {
      const dragY = Math.max(0, dy);
      const progress = clamp(dragY / (window.innerHeight * 0.45), 0, 1);
      const dismissScale = 1 - progress * 0.14;
      currSlide.img.style.transition = 'none';
      currSlide.img.style.transform = `translate3d(${dx * 0.25}px, ${dragY}px, 0) scale(${dismissScale})`;
      backdrop.style.transition = 'none';
      backdrop.style.opacity = String(1 - progress * 0.72);
    }
  }

  function onTouchEnd(e) {
    if (isClosing) return;
    if (e.target && e.target.closest('button')) return;
    e.preventDefault();

    const touches = e.touches;
    const now = performance.now();
    touchState.suppressClickUntil = now + 400;

    // Seamless handoff from 2-finger pinch to 1-finger pan if one finger remains while zoomed
    if (touchState.mode === 'pinch' && touches.length === 1) {
      if (scale > MAX_SCALE) {
        scale = MAX_SCALE;
      }
      if (scale > 1.02) {
        const clamped = clampPosition(tx, ty, scale);
        tx = clamped.tx;
        ty = clamped.ty;
        applyImageTransform(false);
        const remaining = touches[0];
        touchState.mode = 'pan';
        touchState.startX = remaining.clientX;
        touchState.startY = remaining.clientY;
        touchState.lastX = remaining.clientX;
        touchState.lastY = remaining.clientY;
        touchState.startTx = tx;
        touchState.startTy = ty;
        touchState.lastTime = now;
        return;
      }
    }

    if (touches.length > 0) return;

    const prevMode = touchState.mode;
    touchState.mode = 'none';

    if (prevMode === 'pinch') {
      if (scale <= 1.04) {
        resetTransform(true);
      } else {
        scale = clamp(scale, MIN_SCALE, MAX_SCALE);
        const clamped = clampPosition(tx, ty, scale);
        tx = clamped.tx;
        ty = clamped.ty;
        applyImageTransform(true);
      }
      return;
    }

    if (prevMode === 'pan') {
      const clamped = clampPosition(tx, ty, scale);
      tx = clamped.tx;
      ty = clamped.ty;
      applyImageTransform(false);
      startPanInertia(touchState.vx, touchState.vy);
      return;
    }

    if (prevMode === 'swipe-x' && !isSlideAnimating) {
      const dx = touchState.lastX - touchState.startX;
      const threshold = Math.min(window.innerWidth * 0.22, 95);
      const fastFlick = Math.abs(touchState.vx) > 0.36 && Math.abs(dx) > 24;

      if ((dx < -threshold || (fastFlick && touchState.vx < 0)) && currentIdx < validImages.length - 1) {
        navigateBy(1);
      } else if ((dx > threshold || (fastFlick && touchState.vx > 0)) && currentIdx > 0) {
        navigateBy(-1);
      } else {
        track.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
        track.style.transform = 'translate3d(0, 0, 0)';
      }
      return;
    }

    if (prevMode === 'swipe-y') {
      const dy = touchState.lastY - touchState.startY;
      if (dy > 95 || (touchState.vy > 0.45 && dy > 45)) {
        close();
      } else {
        backdrop.style.transition = 'opacity 200ms ease';
        backdrop.style.opacity = '1';
        resetTransform(true);
      }
      return;
    }

    // Double-tap detection
    if (!touchState.moved && e.changedTouches && e.changedTouches.length === 1) {
      const ct = e.changedTouches[0];
      const dtTap = now - touchState.lastTapTime;
      const distTap = Math.hypot(ct.clientX - touchState.lastTapX, ct.clientY - touchState.lastTapY);

      if (dtTap > 0 && dtTap < 290 && distTap < 30) {
        touchState.lastTapTime = 0;
        toggleDoubleTapZoom(ct.clientX, ct.clientY);
      } else {
        touchState.lastTapTime = now;
        touchState.lastTapX = ct.clientX;
        touchState.lastTapY = ct.clientY;
      }
    }
  }

  // ===== DESKTOP MOUSE & TRACKPAD ENGINE =====
  const mouseState = {
    dragging: false,
    mode: 'none', // 'pan' | 'swipe-x'
    startX: 0,
    startY: 0,
    startTx: 0,
    startTy: 0,
    moved: false,
    lastX: 0,
    lastTime: 0,
    vx: 0,
  };

  function onWheel(e) {
    if (isClosing) return;
    e.preventDefault();
    stopInertia();

    // Support both trackpad pinch (ctrlKey) and standard mouse wheel zoom
    const sensitivity = e.ctrlKey ? 0.012 : 0.0022;
    const factor = Math.exp(-e.deltaY * sensitivity);
    const nextScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);

    if (nextScale <= 1.01) {
      resetTransform(false);
    } else {
      zoomAroundPoint(nextScale, e.clientX, e.clientY, false);
    }
  }

  function onMouseDown(e) {
    if (e.button !== 0 || isClosing) return;
    if (e.target && e.target.closest('button')) return;
    e.preventDefault();
    stopInertia();

    mouseState.dragging = true;
    mouseState.moved = false;
    mouseState.startX = e.clientX;
    mouseState.startY = e.clientY;
    mouseState.lastX = e.clientX;
    mouseState.lastTime = performance.now();
    mouseState.vx = 0;
    mouseState.startTx = tx;
    mouseState.startTy = ty;
    mouseState.mode = scale > 1.02 ? 'pan' : hasMultiple ? 'swipe-x' : 'none';
    updateCursor();
  }

  function onMouseMove(e) {
    if (!mouseState.dragging || isClosing) return;
    const dx = e.clientX - mouseState.startX;
    const dy = e.clientY - mouseState.startY;
    const now = performance.now();
    const dt = Math.max(1, now - mouseState.lastTime);
    mouseState.vx = (e.clientX - mouseState.lastX) / dt;
    mouseState.lastX = e.clientX;
    mouseState.lastTime = now;

    if (Math.hypot(dx, dy) > 5) {
      mouseState.moved = true;
    }

    if (mouseState.mode === 'pan') {
      const clamped = clampPosition(mouseState.startTx + dx, mouseState.startTy + dy, scale);
      tx = clamped.tx;
      ty = clamped.ty;
      applyImageTransform(false);
    } else if (mouseState.mode === 'swipe-x' && mouseState.moved && !isSlideAnimating) {
      let dragX = dx;
      if ((currentIdx === 0 && dragX > 0) || (currentIdx === validImages.length - 1 && dragX < 0)) {
        dragX = dragX * 0.28;
      }
      track.style.transition = 'none';
      track.style.transform = `translate3d(${dragX}px, 0, 0)`;
    }
  }

  function onMouseUp(e) {
    if (!mouseState.dragging) return;
    const wasMoved = mouseState.moved;
    const prevMode = mouseState.mode;
    mouseState.dragging = false;
    mouseState.mode = 'none';
    updateCursor();

    if (prevMode === 'swipe-x' && wasMoved && !isSlideAnimating) {
      const dx = e.clientX - mouseState.startX;
      const threshold = Math.min(window.innerWidth * 0.18, 95);
      const fastFlick = Math.abs(mouseState.vx) > 0.35 && Math.abs(dx) > 24;
      if ((dx < -threshold || (fastFlick && mouseState.vx < 0)) && currentIdx < validImages.length - 1) {
        navigateBy(1);
      } else if ((dx > threshold || (fastFlick && mouseState.vx > 0)) && currentIdx > 0) {
        navigateBy(-1);
      } else {
        track.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
        track.style.transform = 'translate3d(0, 0, 0)';
      }
      return;
    }

    // Desktop click on empty pure-black space outside the image closes cleanly
    if (
      !wasMoved &&
      scale <= 1.02 &&
      performance.now() >= touchState.suppressClickUntil &&
      e.target !== currSlide.img &&
      !(e.target && e.target.closest('button'))
    ) {
      close();
    }
  }

  function onDblClick(e) {
    if (isClosing) return;
    if (performance.now() < touchState.suppressClickUntil) return;
    if (e.target && e.target.closest('button')) return;
    e.preventDefault();
    toggleDoubleTapZoom(e.clientX, e.clientY);
  }

  // ===== KEYBOARD & RESIZE =====
  function onKeyDown(e) {
    if (isClosing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowRight' && hasMultiple) {
      e.preventDefault();
      navigateBy(1);
    } else if (e.key === 'ArrowLeft' && hasMultiple) {
      e.preventDefault();
      navigateBy(-1);
    } else if (e.key === '0') {
      e.preventDefault();
      resetTransform(true);
    }
  }

  function onResize() {
    fitSlotImage(prevSlide);
    fitSlotImage(currSlide);
    fitSlotImage(nextSlide);
    if (scale > 1.01) {
      const clamped = clampPosition(tx, ty, scale);
      tx = clamped.tx;
      ty = clamped.ty;
      applyImageTransform(false);
    }
  }

  // ===== CLEANUP & CLOSE (EXACT SCROLL RESTORATION) =====
  function close(immediate = false) {
    if (isClosing) return;
    isClosing = true;
    stopInertia();
    clearTimeout(slideTimer);

    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);

    stage.removeEventListener('touchstart', onTouchStart);
    stage.removeEventListener('touchmove', onTouchMove);
    stage.removeEventListener('touchend', onTouchEnd);
    stage.removeEventListener('touchcancel', onTouchEnd);
    stage.removeEventListener('wheel', onWheel);
    stage.removeEventListener('mousedown', onMouseDown);
    stage.removeEventListener('dblclick', onDblClick);

    const finishRemove = () => {
      overlay.remove();
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overscrollBehavior = prevHtmlOverscroll;
      if (activeViewerCleanup === close) {
        activeViewerCleanup = null;
      }
      window.scrollTo(savedScrollX, savedScrollY);
    };

    if (immediate) {
      finishRemove();
      return;
    }

    overlay.style.opacity = '0';
    currSlide.img.style.transition = 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease';
    currSlide.img.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${Math.max(0.92, scale * 0.96)})`;
    setTimeout(finishRemove, 190);
  }

  activeViewerCleanup = close;

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });

  // Attach listeners
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  stage.addEventListener('touchstart', onTouchStart, { passive: false });
  stage.addEventListener('touchmove', onTouchMove, { passive: false });
  stage.addEventListener('touchend', onTouchEnd, { passive: false });
  stage.addEventListener('touchcancel', onTouchEnd, { passive: false });
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('mousedown', onMouseDown);
  stage.addEventListener('dblclick', onDblClick);

  // Mount & fade in smoothly
  document.body.appendChild(overlay);
  syncSlides();

  currSlide.img.style.transform = 'translate3d(0, 0, 0) scale(0.96)';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (isClosing) return;
      overlay.style.opacity = '1';
      currSlide.img.style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease';
      currSlide.img.style.transform = 'translate3d(0, 0, 0) scale(1)';
    });
  });

  return close;
}
