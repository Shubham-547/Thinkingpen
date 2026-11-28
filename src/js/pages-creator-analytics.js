import {
  apiFetch,
  CONTENT_TYPES,
  esc,
  formatDate,
  formatDateTime,
  formatInr,
  getResponsiveImageSources,
  renderStatusLabel,
  showToast,
} from './api.js';

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last 90 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_year', label: 'This Year' },
  { value: 'custom', label: 'Custom Date Range' },
];

export const analyticsUiState = {
  range: '30d',
  startDate: '',
  endDate: '',
  chartMetric: 'views', // 'views' | 'likes' | 'sales' | 'earnings'
  pubChartMetric: 'views',
  orderStatus: 'all', // 'all' | 'captured' | 'failed' | 'refunded'
  salesPage: 1,
  earningsPage: 1,
  allQuery: '',
  allContentType: 'all',
  allTier: 'all',
  allSort: 'views',
  allPage: 1,
  showAllReferrers: false,
  lastAnalyticsReturnHash: '#/creator/analytics',
};

const CARD_CLS =
  'bg-white dark:bg-[#131C31] border border-[#E5E8F6] dark:border-[#1E2B45] rounded-2xl shadow-[0_2px_10px_rgba(30,27,75,0.03)] dark:shadow-none';

function getRangeOptionLabel(val, fallback) {
  const found = RANGE_OPTIONS.find((o) => o.value === val);
  return found ? found.label : fallback || 'Last 30 Days';
}

function buildRangeQueryParams() {
  const qs = new URLSearchParams();
  qs.set('range', analyticsUiState.range || '30d');
  if (analyticsUiState.range === 'custom' && analyticsUiState.startDate && analyticsUiState.endDate) {
    qs.set('startDate', analyticsUiState.startDate);
    qs.set('endDate', analyticsUiState.endDate);
  }
  return qs;
}

export function buildAnalyticsApiUrl(subMode, subId) {
  const qs = buildRangeQueryParams();
  if (subMode === 'views') return `/api/creator/analytics/views?${qs.toString()}`;
  if (subMode === 'likes') return `/api/creator/analytics/likes?${qs.toString()}`;
  if (subMode === 'sales') {
    qs.set('orderStatus', analyticsUiState.orderStatus || 'all');
    qs.set('page', String(analyticsUiState.salesPage || 1));
    qs.set('limit', '10');
    return `/api/creator/analytics/sales?${qs.toString()}`;
  }
  if (subMode === 'earnings') {
    qs.set('page', String(analyticsUiState.earningsPage || 1));
    qs.set('limit', '10');
    return `/api/creator/analytics/earnings?${qs.toString()}`;
  }
  if (subMode === 'all') {
    qs.set('metric', subId || 'overview');
    if (analyticsUiState.allQuery) qs.set('q', analyticsUiState.allQuery);
    if (analyticsUiState.allContentType && analyticsUiState.allContentType !== 'all') {
      qs.set('contentType', analyticsUiState.allContentType);
    }
    if (analyticsUiState.allTier && analyticsUiState.allTier !== 'all') {
      qs.set('tier', analyticsUiState.allTier);
    }
    qs.set('sort', analyticsUiState.allSort || 'views');
    qs.set('page', String(analyticsUiState.allPage || 1));
    qs.set('limit', '12');
    return `/api/creator/analytics/publications?${qs.toString()}`;
  }
  if (subMode === 'publication' && subId) {
    return `/api/creator/analytics/publications/${encodeURIComponent(subId)}?${qs.toString()}`;
  }
  return `/api/creator/analytics?${qs.toString()}`;
}

// Reusable exact-match SVG Icons
function renderBarsIconSvg(cls = 'w-6 h-6') {
  return `
    <svg class="${cls} shrink-0 text-[#6D28D9] dark:text-[#8B5CF6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" aria-hidden="true">
      <rect x="3" y="13" width="4" height="8" rx="1.4"/>
      <rect x="10" y="4" width="4" height="17" rx="1.4"/>
      <rect x="17" y="9" width="4" height="12" rx="1.4"/>
    </svg>
  `;
}

function renderSolidBarsIconSvg(cls = 'w-5 h-5') {
  return `
    <svg class="${cls} shrink-0 text-[#6D28D9] dark:text-[#8B5CF6]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="3" y="12" width="4.2" height="9" rx="1.5" opacity="0.65"/>
      <rect x="9.9" y="4" width="4.2" height="17" rx="1.5"/>
      <rect x="16.8" y="8.5" width="4.2" height="12.5" rx="1.5" opacity="0.85"/>
    </svg>
  `;
}

function renderTrendIconSvg(cls = 'w-5 h-5') {
  return `
    <svg class="${cls} shrink-0 text-[#6D28D9] dark:text-[#8B5CF6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 17l6-6 4 4 8-8"/>
      <path d="M17 7h4v4"/>
    </svg>
  `;
}

function renderStarSvg(cls = 'w-4 h-4') {
  return `
    <svg class="${cls} shrink-0 text-[#F59E0B]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.4l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.3l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95L12 2.4z"/>
    </svg>
  `;
}

function renderTrophySvg(cls = 'w-5 h-5') {
  return `
    <svg class="${cls} shrink-0 text-[#F59E0B]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 4h-2V3a1 1 0 00-1-1H8a1 1 0 00-1 1v1H5a2 2 0 00-2 2v2a4 4 0 004 4h.2A5.01 5.01 0 0011 15.9V19H8a1 1 0 000 2h8a1 1 0 000-2h-3v-3.1A5.01 5.01 0 0016.8 12H17a4 4 0 004-4V6a2 2 0 00-2-2zM5 8V6h2v4a2 2 0 01-2-2zm14 0a2 2 0 01-2 2V6h2v2z"/>
    </svg>
  `;
}

function renderBulbSvg(cls = 'w-5 h-5') {
  return `
    <svg class="${cls} shrink-0 text-[#F59E0B]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
    </svg>
  `;
}

function renderBackCircleBtn(href = '#/creator/analytics') {
  return `
    <a href="${esc(href)}" class="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#ECECFC] dark:bg-[#1E2742] hover:bg-[#E1E2FA] dark:hover:bg-[#273355] text-[#1E1B4B] dark:text-slate-100 inline-flex items-center justify-center shrink-0 transition-colors" aria-label="Back to Analytics">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
    </a>
  `;
}

function renderViewAllBtn(href) {
  return `
    <a href="${esc(href)}" class="inline-flex items-center gap-1 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full border border-[#D8DCF2] dark:border-[#2B3959] bg-[#F7F8FE] dark:bg-[#1A243E] hover:bg-[#EEEFFB] dark:hover:bg-[#243152] text-[11px] sm:text-xs font-semibold text-[#1E1B4B] dark:text-slate-200 transition-colors whitespace-nowrap shrink-0">
      <span>View All</span>
      <span aria-hidden="true">→</span>
    </a>
  `;
}

function renderDeltaText(pct, suffix = 'vs previous period', { compact = false } = {}) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) {
    return `<div class="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">${compact ? 'No prior data' : 'No prior period'}</div>`;
  }
  const num = Number(pct);
  const arrow = num > 0 ? '↑' : num < 0 ? '↓' : '•';
  const color =
    num > 0
      ? 'text-[#10B981] dark:text-[#34D399]'
      : num < 0
      ? 'text-[#EF4444] dark:text-[#FB7185]'
      : 'text-slate-500 dark:text-slate-400';
  const absStr = `${Math.abs(num).toFixed(1).replace(/\.0$/, '')}%`;
  return `
    <div class="text-[10px] sm:text-[11px] font-semibold ${color} mt-0.5 tabular-nums truncate">
      ${arrow} ${absStr}${compact ? '' : ` <span class="font-normal text-slate-500 dark:text-slate-400">${esc(suffix)}</span>`}
    </div>
  `;
}

function renderThumbHtml(coverUrl, title, sizeClass = 'w-11 h-9 sm:w-12 sm:h-9', badgeText = '') {
  const inner = !coverUrl
    ? `<div class="w-full h-full bg-gradient-to-br from-[#1d2d6b] via-[#3730a3] to-[#1e1b4b] text-white text-[10px] font-bold flex items-center justify-center">SP</div>`
    : `<img src="${esc(getResponsiveImageSources(coverUrl, 240)?.fallbackSrc || coverUrl)}" alt="${esc(title)}" loading="lazy" class="w-full h-full object-cover bg-slate-100 dark:bg-slate-900" />`;
  return `
    <div class="${sizeClass} relative rounded-lg overflow-hidden border border-[#E5E8F6] dark:border-slate-700 shrink-0">
      ${inner}
      ${
        badgeText
          ? `<span class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-[#6D28D9] text-white text-[9px] font-bold leading-none shadow-sm">${esc(badgeText)}</span>`
          : ''
      }
    </div>
  `;
}

function renderContentTypeBadge(contentType) {
  const t = String(contentType || 'Notes');
  const low = t.toLowerCase();
  let cls = 'bg-[#EDE9FE] text-[#6D28D9] dark:bg-[#2E1E59] dark:text-[#C4B5FD]';
  if (low.includes('pdf')) {
    cls = 'bg-[#FCE7F3] text-[#DB2777] dark:bg-[#471936] dark:text-[#F472B6]';
  } else if (low.includes('article') || low.includes('research')) {
    cls = 'bg-[#DBEAFE] text-[#2563EB] dark:bg-[#172E54] dark:text-[#60A5FA]';
  } else if (low.includes('video')) {
    cls = 'bg-[#DCFCE7] text-[#15803D] dark:bg-[#143528] dark:text-[#34D399]';
  } else if (low.includes('poem') || low.includes('story')) {
    cls = 'bg-[#FEF3C7] text-[#B45309] dark:bg-[#3A2812] dark:text-[#FBBF24]';
  }
  const shortLabel = low === 'pdf book' ? 'PDF' : t;
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${cls}">${esc(shortLabel)}</span>`;
}

// Smooth cubic bezier wave sparkline SVG matching reference KPI cards
function renderSparklineSvg(values = [], strokeHex = '#6D28D9', idSuffix = 's') {
  const pts =
    Array.isArray(values) && values.length >= 2
      ? values.map((v) => Number(v || 0))
      : [0, 0, 0, 0];
  const minVal = Math.min(...pts);
  const maxVal = Math.max(...pts);
  const span = maxVal - minVal;
  const w = 88;
  const h = 34;
  const padY = 4;

  const coords = pts.map((val, idx) => {
    const x = (idx / Math.max(1, pts.length - 1)) * w;
    const y =
      span === 0
        ? h - padY - 4
        : h - padY - ((val - minVal) / span) * (h - padY * 2);
    return [Number(x.toFixed(1)), Number(y.toFixed(1))];
  });

  // Build smooth path
  let linePath = `M${coords[0][0]},${coords[0][1]}`;
  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1];
    const [x1, y1] = coords[i];
    const cx = Number(((x0 + x1) / 2).toFixed(1));
    linePath += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  const areaPath = `${linePath} L${w},${h} L0,${h} Z`;
  const gradId = `sp-sp-${idSuffix}-${Math.random().toString(36).slice(2, 7)}`;

  return `
    <svg viewBox="0 0 ${w} ${h}" class="w-12 sm:w-20 h-7 sm:h-9 shrink-0 overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${strokeHex}" stop-opacity="0.28" />
          <stop offset="100%" stop-color="${strokeHex}" stop-opacity="0.01" />
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#${gradId})" />
      <path d="${linePath}" fill="none" stroke="${strokeHex}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

// 5-bar ascending mini chart SVG matching Sales Analytics KPI cards
function renderFiveBarsSvg(palette = 'purple') {
  const palettes = {
    purple: ['#DDD6FE', '#C4B5FD', '#A78BFA', '#8B5CF6', '#6D28D9'],
    emerald: ['#BBF7D0', '#86EFAC', '#4ADE80', '#22C55E', '#16A34A'],
    rose: ['#FBCFE8', '#F9A8D4', '#F472B6', '#EC4899', '#E11D48'],
    amber: ['#FDE68A', '#FCD34D', '#FBBF24', '#F59E0B', '#D97706'],
  };
  const colors = palettes[palette] || palettes.purple;
  const heights = [10, 14, 18, 22, 28];
  return `
    <svg viewBox="0 0 36 30" class="w-8 sm:w-10 h-6 sm:h-8 shrink-0" aria-hidden="true">
      ${heights
        .map(
          (bh, idx) =>
            `<rect x="${idx * 7 + 1}" y="${30 - bh}" width="4.8" height="${bh}" rx="1.6" fill="${colors[idx]}" />`
        )
        .join('')}
    </svg>
  `;
}

function formatAxisVal(val, isCurrency = false) {
  const n = Number(val || 0);
  if (isCurrency) {
    if (n >= 100000) return `₹${(n / 100000).toFixed(1).replace(/\.0$/, '')}L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return `₹${Math.round(n)}`;
  }
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(Math.round(n));
}

function renderInteractiveLineChart({
  chartId,
  points,
  primaryKey,
  primaryLabel,
  primaryColor = '#6D28D9',
  primaryCurrency = false,
  secondaryKey = null,
  secondaryLabel = '',
  secondaryColor = '#0EA5E9',
  secondaryCurrency = false,
  showLegend = true,
  showPeakCallout = false,
}) {
  const data = Array.isArray(points) && points.length ? points : [{ label: '—', [primaryKey]: 0 }];
  const allVals = [];
  for (const d of data) {
    allVals.push(Number(d[primaryKey] || 0));
    if (secondaryKey && primaryCurrency === secondaryCurrency) {
      allVals.push(Number(d[secondaryKey] || 0));
    }
  }
  const rawMax = Math.max(1, ...allVals);
  const pow = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceStep = Math.max(1, pow / 2);
  const maxY = Math.max(4, Math.ceil(rawMax / niceStep) * niceStep);

  const secRawMax = secondaryKey
    ? Math.max(1, ...data.map((d) => Number(d[secondaryKey] || 0)))
    : 1;
  const normalizeSecondary = secondaryKey && primaryCurrency !== secondaryCurrency;

  const vw = 680;
  const vh = 215;
  const padL = 44;
  const padR = 16;
  const padT = 18;
  const padB = 28;
  const plotW = vw - padL - padR;
  const plotH = vh - padT - padB;

  const xFor = (i) =>
    data.length <= 1 ? padL + plotW / 2 : padL + (i / (data.length - 1)) * plotW;
  const yForPrimary = (v) => padT + plotH - (Math.max(0, Number(v || 0)) / maxY) * plotH;
  const yForSecondary = (v) => {
    const val = Number(v || 0);
    if (normalizeSecondary) {
      return padT + plotH - (Math.max(0, val) / secRawMax) * (plotH * 0.85);
    }
    return yForPrimary(val);
  };

  const pCoords = data.map((d, i) => ({
    x: Number(xFor(i).toFixed(1)),
    y: Number(yForPrimary(d[primaryKey]).toFixed(1)),
    val: Number(d[primaryKey] || 0),
    secVal: secondaryKey ? Number(d[secondaryKey] || 0) : null,
    secY: secondaryKey ? Number(yForSecondary(d[secondaryKey]).toFixed(1)) : null,
    label: d.label || '',
  }));

  const pPath = pCoords.map((c, idx) => `${idx === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ');
  const pArea = `${pPath} L${pCoords[pCoords.length - 1].x},${padT + plotH} L${pCoords[0].x},${padT + plotH} Z`;
  const sPath = secondaryKey
    ? pCoords.map((c, idx) => `${idx === 0 ? 'M' : 'L'}${c.x},${c.secY}`).join(' ')
    : '';
  const sArea = secondaryKey
    ? `${sPath} L${pCoords[pCoords.length - 1].x},${padT + plotH} L${pCoords[0].x},${padT + plotH} Z`
    : '';

  const gradPrimaryId = `g-p-${chartId}-${Math.random().toString(36).slice(2, 6)}`;
  const gradSecondaryId = `g-s-${chartId}-${Math.random().toString(36).slice(2, 6)}`;

  const yTicks = [0, 0.33, 0.66, 1].map((t) => ({
    y: Number((padT + plotH - t * plotH).toFixed(1)),
    label: formatAxisVal(Math.round(t * maxY), primaryCurrency),
  }));

  const maxXLabels = 7;
  const stepX = Math.max(1, Math.ceil(data.length / maxXLabels));
  const formatMetricValue = (v, isCurr) =>
    isCurr ? formatInr(v) : Number(v || 0).toLocaleString('en-IN');

  // Peak / latest point for Publication Performance Graph default callout
  let peakPt = pCoords[pCoords.length - 1];
  for (const pt of pCoords) {
    if (pt.val >= peakPt.val) peakPt = pt;
  }
  const latestPt = pCoords[pCoords.length - 1];
  const calloutPt = latestPt.val > 0 ? latestPt : peakPt;
  const calloutText = `${formatMetricValue(calloutPt.val, primaryCurrency)} ${primaryLabel}`;

  return `
    <div class="relative select-none" data-sp-chart-wrap="${esc(chartId)}">
      ${
        showLegend
          ? `<div class="flex flex-wrap items-center gap-4 text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 mb-2">
               <span class="inline-flex items-center gap-1.5 font-medium">
                 <span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${primaryColor}"></span>
                 ${esc(primaryLabel)}
               </span>
               ${
                 secondaryKey
                   ? `<span class="inline-flex items-center gap-1.5 font-medium">
                        <span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${secondaryColor}"></span>
                        ${esc(secondaryLabel)}
                      </span>`
                   : ''
               }
             </div>`
          : ''
      }

      <div class="relative w-full overflow-hidden">
        ${
          showPeakCallout && calloutPt
            ? `<div id="sp-peak-badge-${esc(chartId)}" class="pointer-events-none absolute right-2 top-0.5 z-10 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1E1B4B] dark:bg-[#0F172A] text-white text-[10px] sm:text-xs font-semibold shadow-md border border-[#312E81] tabular-nums">
                 <span class="w-1.5 h-1.5 rounded-full bg-[#A78BFA]"></span>
                 <span>${esc(calloutText)}</span>
               </div>`
            : ''
        }
        <svg viewBox="0 0 ${vw} ${vh}" class="w-full h-44 sm:h-56 overflow-visible">
          <defs>
            <linearGradient id="${gradPrimaryId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${primaryColor}" stop-opacity="0.22" />
              <stop offset="100%" stop-color="${primaryColor}" stop-opacity="0.01" />
            </linearGradient>
            <linearGradient id="${gradSecondaryId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${secondaryColor}" stop-opacity="0.18" />
              <stop offset="100%" stop-color="${secondaryColor}" stop-opacity="0.01" />
            </linearGradient>
          </defs>

          <!-- Vertical faint gridlines at displayed X ticks -->
          ${pCoords
            .map((c, i) =>
              i === 0 || i === pCoords.length - 1 || i % stepX === 0
                ? `<line x1="${c.x}" y1="${padT}" x2="${c.x}" y2="${padT + plotH}" stroke="currentColor" class="text-slate-200/60 dark:text-slate-800/70" stroke-width="1" />`
                : ''
            )
            .join('')}

          <!-- Horizontal gridlines & Y labels -->
          ${yTicks
            .map(
              (tk) => `
            <line x1="${padL}" y1="${tk.y}" x2="${vw - padR}" y2="${tk.y}" stroke="currentColor" class="text-slate-200/80 dark:text-slate-800" stroke-width="1" />
            <text x="${padL - 8}" y="${tk.y + 4}" text-anchor="end" class="fill-slate-500 dark:fill-slate-400 text-[10.5px] font-medium">${esc(tk.label)}</text>
          `
            )
            .join('')}

          <!-- X axis labels -->
          ${pCoords
            .map((c, i) =>
              i === 0 || i === pCoords.length - 1 || i % stepX === 0
                ? `<text x="${c.x}" y="${vh - 7}" text-anchor="middle" class="fill-slate-500 dark:fill-slate-400 text-[10.5px]">${esc(c.label)}</text>`
                : ''
            )
            .join('')}

          <path d="${pArea}" fill="url(#${gradPrimaryId})" />
          ${secondaryKey ? `<path d="${sArea}" fill="url(#${gradSecondaryId})" />` : ''}

          <path d="${pPath}" fill="none" stroke="${primaryColor}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
          ${
            secondaryKey
              ? `<path d="${sPath}" fill="none" stroke="${secondaryColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />`
              : ''
          }

          ${pCoords
            .map((c, idx) => {
              const tipPrimary = formatMetricValue(c.val, primaryCurrency);
              const tipSecondary = secondaryKey ? formatMetricValue(c.secVal, secondaryCurrency) : '';
              return `
                <g class="sp-chart-pt cursor-pointer" data-chart-id="${esc(chartId)}" data-idx="${idx}" data-label="${esc(c.label)}" data-p-label="${esc(primaryLabel)}" data-p-val="${esc(tipPrimary)}" data-s-label="${esc(secondaryLabel)}" data-s-val="${esc(tipSecondary)}" data-x-pct="${((c.x / vw) * 100).toFixed(1)}" data-y-pct="${((c.y / vh) * 100).toFixed(1)}">
                  ${
                    data.length <= 35 || idx % 2 === 0 || idx === pCoords.length - 1
                      ? `<circle cx="${c.x}" cy="${c.y}" r="3.8" class="fill-white dark:fill-[#131C31]" stroke="${primaryColor}" stroke-width="2.2" />`
                      : ''
                  }
                  ${
                    secondaryKey && (data.length <= 35 || idx % 2 === 0 || idx === pCoords.length - 1)
                      ? `<circle cx="${c.x}" cy="${c.secY}" r="3.5" class="fill-white dark:fill-[#131C31]" stroke="${secondaryColor}" stroke-width="2.1" />`
                      : ''
                  }
                  <rect x="${Math.max(padL, c.x - plotW / Math.max(2, data.length * 2))}" y="${padT}" width="${Math.max(12, plotW / Math.max(1, data.length))}" height="${plotH}" fill="transparent" />
                </g>
              `;
            })
            .join('')}
        </svg>

        <div id="sp-chart-tip-${esc(chartId)}" class="hidden pointer-events-none absolute z-20 px-3 py-1.5 rounded-lg bg-[#1E1B4B] dark:bg-slate-800 text-white text-[11px] shadow-lg border border-[#312E81] dark:border-slate-700 whitespace-nowrap tabular-nums"></div>
      </div>
    </div>
  `;
}

function wireInteractiveChartTooltips(rootEl) {
  rootEl.querySelectorAll('.sp-chart-pt').forEach((pt) => {
    const showTip = () => {
      const chartId = pt.dataset.chartId;
      const tip = document.getElementById(`sp-chart-tip-${chartId}`);
      if (!tip) return;
      const xPct = Number(pt.dataset.xPct || 50);
      const yPct = Number(pt.dataset.yPct || 25);
      tip.innerHTML = `
        <div class="font-semibold text-indigo-200 mb-0.5">${esc(pt.dataset.label)}</div>
        <div>${esc(pt.dataset.pLabel)}: <strong class="font-mono text-white">${esc(pt.dataset.pVal)}</strong></div>
        ${
          pt.dataset.sLabel
            ? `<div>${esc(pt.dataset.sLabel)}: <strong class="font-mono text-sky-300">${esc(pt.dataset.sVal)}</strong></div>`
            : ''
        }
      `;
      tip.style.left = `${Math.min(82, Math.max(14, xPct))}%`;
      tip.style.top = `${Math.max(4, Math.min(72, yPct - 18))}%`;
      tip.style.transform = 'translateX(-50%)';
      tip.classList.remove('hidden');
    };
    const hideTip = () => {
      const tip = document.getElementById(`sp-chart-tip-${pt.dataset.chartId}`);
      tip?.classList.add('hidden');
    };
    pt.addEventListener('mouseenter', showTip);
    pt.addEventListener('click', showTip);
    pt.addEventListener('mouseleave', hideTip);
  });
}

// Compact inline Date Filter Pill matching screenshots (avoids mobile 16px select bloat)
function renderDateFilterBar(filter, prefix = 'an') {
  const curRange = filter?.range || analyticsUiState.range || '30d';
  const curLabel = filter?.rangeLabel || getRangeOptionLabel(curRange);
  return `
    <div class="relative shrink-0">
      <button type="button" id="${prefix}-date-pill-btn" aria-haspopup="listbox" aria-expanded="false" class="h-8 sm:h-9 px-2.5 sm:px-3.5 rounded-full bg-white dark:bg-[#131C31] border border-[#E0E4F6] dark:border-[#24324E] shadow-[0_2px_8px_rgba(90,31,216,0.06)] dark:shadow-none inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-[#1E1B4B] dark:text-slate-100 hover:border-[#6D28D9]/50 transition-colors whitespace-nowrap">
        <svg class="w-3.5 h-3.5 text-[#4338CA] dark:text-[#A78BFA] shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        <span>${esc(curLabel)}</span>
        <svg class="w-3 h-3 text-slate-500 dark:text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
      </button>

      <div id="${prefix}-date-menu" class="hidden absolute right-0 mt-1.5 w-48 py-1.5 rounded-2xl bg-white dark:bg-[#131C31] border border-[#E2E6F6] dark:border-[#24324E] shadow-xl z-30">
        ${RANGE_OPTIONS.map(
          (o) => `
          <button type="button" data-range-opt="${o.value}" class="${prefix}-range-opt-btn w-full text-left px-3.5 py-2 text-xs flex items-center justify-between transition-colors ${
            curRange === o.value
              ? 'bg-[#F3EFFE] dark:bg-[#231B4B] text-[#6D28D9] dark:text-[#C4B5FD] font-semibold'
              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/70'
          }">
            <span>${esc(o.label)}</span>
            ${curRange === o.value ? '<span class="w-1.5 h-1.5 rounded-full bg-[#6D28D9]"></span>' : ''}
          </button>
        `
        ).join('')}
      </div>
    </div>
  `;
}

function renderCustomDateDrawer(filter, prefix = 'an') {
  const curRange = filter?.range || analyticsUiState.range || '30d';
  const startVal = analyticsUiState.startDate || filter?.startDate || '';
  const endVal = analyticsUiState.endDate || filter?.endDate || '';
  return `
    <div id="${prefix}-custom-date-bar" class="${curRange === 'custom' ? 'flex' : 'hidden'} flex-wrap items-center justify-end gap-2 p-2.5 rounded-xl bg-white dark:bg-[#131C31] border border-[#E5E8F6] dark:border-[#1E2B45] text-xs">
      <input type="date" id="${prefix}-start-date" value="${esc(startVal)}" aria-label="Start date" class="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100" />
      <span class="text-slate-400">to</span>
      <input type="date" id="${prefix}-end-date" value="${esc(endVal)}" aria-label="End date" class="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100" />
      <button type="button" id="${prefix}-apply-custom-btn" class="px-3 py-1.5 rounded-lg bg-[#6D28D9] hover:bg-[#5B21B6] text-white font-semibold transition-colors">Apply</button>
    </div>
  `;
}

function renderTrendQuickPills(curRange) {
  const pills = [
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
    { key: '90d', label: '90D' },
    { key: 'custom', label: 'Custom' },
  ];
  return `
    <div class="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-[#F3F4FB] dark:bg-[#0B1120] border border-[#E5E8F6] dark:border-[#1E2B45] shrink-0">
      ${pills
        .map(
          (p) => `
        <button type="button" data-quick-range="${p.key}" class="an-quick-range-btn px-2.5 sm:px-3 py-1 rounded-full text-[11px] sm:text-xs font-semibold transition-colors ${
          curRange === p.key
            ? 'bg-[#6D28D9] text-white shadow-sm'
            : 'text-[#1E1B4B] dark:text-slate-300 hover:text-[#6D28D9] dark:hover:text-white'
        }">${p.label}</button>
      `
        )
        .join('')}
    </div>
  `;
}

// Single-row compact horizontal publications table matching Main Dashboard & View All screenshots
function renderTopPublicationsTableHtml(items, { showViewAnalytics = true } = {}) {
  if (!items || !items.length) {
    return `
      <div class="py-8 px-4 text-center space-y-2.5">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">No publications yet</div>
        <p class="text-xs text-slate-500 dark:text-slate-400">Upload notes, PDFs, articles, or videos to view publication analytics.</p>
        <a href="#/creator/upload" class="inline-flex items-center px-4 py-2 text-xs font-semibold rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white transition-colors">Upload Content</a>
      </div>
    `;
  }

  return `
    <div class="overflow-x-auto touch-scroll-x -mx-1 px-1">
      <table class="w-full min-w-[490px] sm:min-w-0 text-left border-collapse">
        <thead class="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800/80">
          <tr>
            <th class="pb-2 pr-2 font-medium">Publication</th>
            <th class="pb-2 px-1.5 font-medium text-center">Type</th>
            <th class="pb-2 px-1.5 font-medium text-right">Views</th>
            <th class="pb-2 px-1.5 font-medium text-center">Likes</th>
            <th class="pb-2 px-1.5 font-medium text-center">Sales</th>
            <th class="pb-2 px-1.5 font-medium text-right">Conversion</th>
            <th class="pb-2 px-1.5 font-medium text-right">Earnings</th>
            ${showViewAnalytics ? '<th class="pb-2 pl-2 font-medium text-right"><span class="sr-only">Action</span></th>' : ''}
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800/70">
          ${items
            .map((p) => {
              const convText =
                p.conversionRate !== null && p.conversionRate !== undefined
                  ? `${Number(p.conversionRate).toFixed(2)}%`
                  : '0.00%';
              const displayViews = p.views > 0 ? p.views : p.lifetimeViews || 0;
              const displayLikes = p.likes > 0 ? p.likes : p.lifetimeLikes || 0;
              return `
                <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors">
                  <td class="py-2.5 pr-2 max-w-[155px] sm:max-w-[240px]">
                    <div class="flex items-center gap-2 sm:gap-2.5 min-w-0">
                      ${renderThumbHtml(p.coverImageUrl, p.title, 'w-11 h-8 sm:w-13 sm:h-9')}
                      <a href="#/creator/analytics/publication/${p.id}" class="text-[11px] sm:text-xs font-semibold text-[#0F172A] dark:text-slate-100 hover:text-[#6D28D9] dark:hover:text-[#A78BFA] leading-tight line-clamp-2">${esc(p.title)}</a>
                    </div>
                  </td>
                  <td class="py-2.5 px-1.5 text-center">${renderContentTypeBadge(p.contentType)}</td>
                  <td class="py-2.5 px-1.5 text-right text-[11px] sm:text-xs font-semibold text-[#0F172A] dark:text-slate-100 tabular-nums whitespace-nowrap">${Number(displayViews).toLocaleString('en-IN')}</td>
                  <td class="py-2.5 px-1.5 text-center whitespace-nowrap">
                    <span class="inline-flex items-center gap-1 text-[11px] sm:text-xs font-semibold text-[#0F172A] dark:text-slate-100 tabular-nums">
                      <svg class="w-3 h-3 text-[#EC4899] shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                      ${Number(displayLikes).toLocaleString('en-IN')}
                    </span>
                  </td>
                  <td class="py-2.5 px-1.5 text-center whitespace-nowrap">
                    <span class="inline-flex items-center gap-1 text-[11px] sm:text-xs font-semibold text-[#0F172A] dark:text-slate-100 tabular-nums">
                      <svg class="w-3 h-3 text-[#16A34A] shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                      ${Number(p.sales || 0).toLocaleString('en-IN')}
                    </span>
                  </td>
                  <td class="py-2.5 px-1.5 text-right text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">${convText}</td>
                  <td class="py-2.5 px-1.5 text-right text-[11px] sm:text-xs font-bold text-[#0F172A] dark:text-white tabular-nums whitespace-nowrap">${formatInr(p.earningsInr || 0)}</td>
                  ${
                    showViewAnalytics
                      ? `<td class="py-2.5 pl-2 text-right">
                           <a href="#/creator/analytics/publication/${p.id}" class="inline-flex items-center justify-center px-2 sm:px-2.5 py-1 rounded-lg border border-[#C4B5FD] dark:border-[#4C1D95] bg-[#FAF8FF] dark:bg-[#1B173B] text-[10px] sm:text-xs font-semibold text-[#5B21B6] dark:text-[#C4B5FD] hover:bg-[#EFEAFF] dark:hover:bg-[#272052] leading-tight text-center transition-colors">
                             View<br class="sm:hidden" /><span class="hidden sm:inline">&nbsp;</span>Analytics
                           </a>
                         </td>`
                      : ''
                  }
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

// =========================================================================
// 1. Main Content Performance Analytics Dashboard (Light + Dark Screenshots)
// =========================================================================
function renderAnalyticsOverviewHtml(payload) {
  const k = payload?.kpis || {};
  const filter = payload?.filter || {};
  const series = payload?.series || [];
  const metric = analyticsUiState.chartMetric || 'views';

  const chartCfgMap = {
    views: {
      key: 'views',
      label: 'Views',
      color: '#6D28D9',
      currency: false,
      secondaryKey: 'sales',
      secondaryLabel: 'Paid Sales',
      secondaryColor: '#0EA5E9',
      secondaryCurrency: false,
    },
    likes: {
      key: 'likes',
      label: 'Likes',
      color: '#EC4899',
      currency: false,
    },
    sales: {
      key: 'sales',
      label: 'Paid Sales',
      color: '#10B981',
      currency: false,
    },
    earnings: {
      key: 'earningsInr',
      label: 'Creator Earnings (₹)',
      color: '#F59E0B',
      currency: true,
    },
  };
  const activeChartCfg = chartCfgMap[metric] || chartCfgMap.views;

  return `
    <div class="space-y-3 sm:space-y-4">
      <!-- Top Header Row -->
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-start gap-2 sm:gap-2.5 min-w-0">
          <div class="mt-0.5">${renderBarsIconSvg('w-6 h-6 sm:w-7 sm:h-7')}</div>
          <div class="min-w-0">
            <h1 class="text-[17px] sm:text-2xl font-bold text-[#0F172A] dark:text-white leading-tight truncate">Content Performance Analytics</h1>
            <p class="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 mt-0.5">Track your content performance and growth.</p>
          </div>
        </div>
        ${renderDateFilterBar(filter)}
      </div>
      ${renderCustomDateDrawer(filter)}

      <!-- 2x2 KPI Grid -->
      <div class="grid grid-cols-2 gap-2.5 sm:gap-4">
        <!-- Total Views -->
        <a href="#/creator/analytics/views" class="${CARD_CLS} p-2.5 sm:p-4 hover:border-[#6D28D9]/50 dark:hover:border-[#8B5CF6]/50 transition-colors block">
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="w-9 h-9 sm:w-12 sm:h-12 rounded-xl bg-[#ECEBFF] dark:bg-[#23264D] text-[#5B21B6] dark:text-[#818CF8] flex items-center justify-center shrink-0">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 11.5a4.5 4.5 0 110-9 4.5 4.5 0 010 9zm0-7.2a2.7 2.7 0 100 5.4 2.7 2.7 0 000-5.4z"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0"></span>
                <span class="truncate">Total Views</span>
              </div>
              <div class="flex items-end justify-between gap-1 mt-0.5">
                <div class="text-lg sm:text-2xl font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${Number(k.totalViews?.value || 0).toLocaleString('en-IN')}</div>
                ${renderSparklineSvg(k.totalViews?.sparkline, '#4F46E5', 'views')}
              </div>
              ${renderDeltaText(k.totalViews?.growthPct, filter.comparisonLabel)}
            </div>
          </div>
        </a>

        <!-- Total Likes -->
        <a href="#/creator/analytics/likes" class="${CARD_CLS} p-2.5 sm:p-4 hover:border-pink-400/60 transition-colors block">
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="w-9 h-9 sm:w-12 sm:h-12 rounded-xl bg-[#FCE7F3] dark:bg-[#3A1B35] text-[#EC4899] dark:text-[#F472B6] flex items-center justify-center shrink-0">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0"></span>
                <span class="truncate">Total Likes</span>
              </div>
              <div class="flex items-end justify-between gap-1 mt-0.5">
                <div class="text-lg sm:text-2xl font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${Number(k.totalLikes?.value || 0).toLocaleString('en-IN')}</div>
                ${renderSparklineSvg(k.totalLikes?.sparkline, '#EC4899', 'likes')}
              </div>
              ${renderDeltaText(k.totalLikes?.growthPct, filter.comparisonLabel)}
            </div>
          </div>
        </a>

        <!-- Paid Sales -->
        <a href="#/creator/analytics/sales" class="${CARD_CLS} p-2.5 sm:p-4 hover:border-emerald-400/60 transition-colors block">
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="w-9 h-9 sm:w-12 sm:h-12 rounded-xl bg-[#DCFCE7] dark:bg-[#133529] text-[#16A34A] dark:text-[#34D399] flex items-center justify-center shrink-0">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0"></span>
                <span class="truncate">Paid Sales</span>
              </div>
              <div class="flex items-end justify-between gap-1 mt-0.5">
                <div class="text-lg sm:text-2xl font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${Number(k.paidSales?.value || 0).toLocaleString('en-IN')}</div>
                ${renderSparklineSvg(k.paidSales?.sparkline, '#10B981', 'sales')}
              </div>
              ${renderDeltaText(k.paidSales?.growthPct, filter.comparisonLabel)}
            </div>
          </div>
        </a>

        <!-- Creator Earnings -->
        <a href="#/creator/analytics/earnings" class="${CARD_CLS} p-2.5 sm:p-4 hover:border-amber-400/60 transition-colors block">
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="w-9 h-9 sm:w-12 sm:h-12 rounded-xl bg-[#FEF3C7] dark:bg-[#382914] text-[#D97706] dark:text-[#FBBF24] flex items-center justify-center shrink-0">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M21 7H5a2 2 0 00-2 2v8a3 3 0 003 3h15a1 1 0 001-1V8a1 1 0 00-1-1zm-1 8h-3a2 2 0 010-4h3v4zM4 6.5A2.5 2.5 0 016.5 4H19a1 1 0 010 2H6.5a.5.5 0 000 1H19v1H5a2 2 0 01-1-.5z"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0"></span>
                <span class="truncate">Creator Earnings</span>
              </div>
              <div class="flex items-end justify-between gap-1 mt-0.5">
                <div class="text-lg sm:text-2xl font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${formatInr(k.creatorEarnings?.value || 0)}</div>
                ${renderSparklineSvg(k.creatorEarnings?.sparkline, '#F59E0B', 'earn')}
              </div>
              <div class="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">After platform commission</div>
            </div>
          </div>
        </a>
      </div>

      <!-- Performance Over Time Chart -->
      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-2.5">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            ${renderBarsIconSvg('w-5 h-5')}
            <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Performance Over Time</h2>
          </div>
          <div class="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-[#F3F4FB] dark:bg-[#0B1120] border border-[#E5E8F6] dark:border-[#1E2B45]">
            ${[
              { id: 'views', label: 'Views' },
              { id: 'likes', label: 'Likes' },
              { id: 'sales', label: 'Sales' },
              { id: 'earnings', label: 'Earnings' },
            ]
              .map(
                (t) => `
              <button type="button" data-chart-tab="${t.id}" class="an-chart-tab-btn px-2.5 sm:px-3.5 py-1 rounded-full text-[11px] sm:text-xs font-semibold transition-colors ${
                metric === t.id
                  ? 'bg-[#6D28D9] text-white shadow-sm'
                  : 'text-[#1E1B4B] dark:text-slate-300 hover:text-[#6D28D9] dark:hover:text-white'
              }">${t.label}</button>
            `
              )
              .join('')}
          </div>
        </div>
        ${renderInteractiveLineChart({
          chartId: 'overview-main',
          points: series,
          primaryKey: activeChartCfg.key,
          primaryLabel: activeChartCfg.label,
          primaryColor: activeChartCfg.color,
          primaryCurrency: activeChartCfg.currency,
          secondaryKey: activeChartCfg.secondaryKey || null,
          secondaryLabel: activeChartCfg.secondaryLabel || '',
          secondaryColor: activeChartCfg.secondaryColor || '#0EA5E9',
          secondaryCurrency: Boolean(activeChartCfg.secondaryCurrency),
          showLegend: true,
        })}
      </section>

      <!-- Top Performing Publications -->
      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            ${renderStarSvg('w-5 h-5')}
            <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Top Performing Publications</h2>
          </div>
          ${renderViewAllBtn('#/creator/analytics/all/overview')}
        </div>
        ${renderTopPublicationsTableHtml(payload?.topPublications || [])}
      </section>
    </div>
  `;
}

// =========================================================================
// 2. Views Analytics Page (Aligned to same visual system)
// =========================================================================
function renderViewsAnalyticsHtml(payload) {
  const s = payload?.summary || {};
  const filter = payload?.filter || {};

  return `
    <div class="space-y-3 sm:space-y-4">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-start gap-2.5 min-w-0">
          ${renderBackCircleBtn('#/creator/analytics')}
          <div class="min-w-0">
            <h1 class="text-[17px] sm:text-2xl font-bold text-[#0F172A] dark:text-white leading-tight truncate">Views Analytics</h1>
            <p class="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 mt-0.5">Track total views and unique readers across your content.</p>
          </div>
        </div>
        ${renderDateFilterBar(filter)}
      </div>
      ${renderCustomDateDrawer(filter)}

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <div class="${CARD_CLS} p-3 sm:p-4">
          <div class="text-[11px] sm:text-xs font-medium text-slate-600 dark:text-slate-300">Total Views</div>
          <div class="text-xl sm:text-2xl font-extrabold text-[#0F172A] dark:text-white mt-0.5 tabular-nums">${Number(s.totalViews || 0).toLocaleString('en-IN')}</div>
          ${renderDeltaText(s.growthPct, filter.comparisonLabel)}
        </div>
        <div class="${CARD_CLS} p-3 sm:p-4">
          <div class="text-[11px] sm:text-xs font-medium text-slate-600 dark:text-slate-300">Unique Viewers</div>
          <div class="text-xl sm:text-2xl font-extrabold text-[#6D28D9] dark:text-[#A78BFA] mt-0.5 tabular-nums">${Number(s.uniqueViewers || 0).toLocaleString('en-IN')}</div>
          ${renderDeltaText(s.uniqueGrowthPct, filter.comparisonLabel)}
        </div>
        <div class="${CARD_CLS} p-3 sm:p-4">
          <div class="text-[11px] sm:text-xs font-medium text-slate-600 dark:text-slate-300">Avg Views / Day</div>
          <div class="text-xl sm:text-2xl font-extrabold text-[#0F172A] dark:text-white mt-0.5 tabular-nums">${Number(s.avgViewsPerDay || 0).toLocaleString('en-IN')}</div>
          <div class="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">${Number(filter.spanDays || 30)} day window</div>
        </div>
        <div class="${CARD_CLS} p-3 sm:p-4">
          <div class="text-[11px] sm:text-xs font-medium text-slate-600 dark:text-slate-300">Lifetime Views</div>
          <div class="text-xl sm:text-2xl font-extrabold text-[#0F172A] dark:text-white mt-0.5 tabular-nums">${Number(s.lifetimeViews || 0).toLocaleString('en-IN')}</div>
          <div class="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">${Number(s.repeatViews || 0).toLocaleString('en-IN')} repeat views</div>
        </div>
      </div>

      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-3">
        <div class="flex items-start justify-between gap-2 flex-wrap">
          <div class="flex items-start gap-2">
            ${renderTrendIconSvg('w-5 h-5 mt-0.5')}
            <div>
              <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Views Trend</h2>
              <p class="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">Daily views &amp; unique readers over the selected period</p>
            </div>
          </div>
          ${renderTrendQuickPills(filter.range)}
        </div>
        ${renderInteractiveLineChart({
          chartId: 'views-trend',
          points: payload?.series || [],
          primaryKey: 'views',
          primaryLabel: 'Total Views',
          primaryColor: '#6D28D9',
          secondaryKey: 'uniqueViewers',
          secondaryLabel: 'Unique Viewers',
          secondaryColor: '#0EA5E9',
        })}
      </section>

      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            ${renderTrophySvg('w-5 h-5')}
            <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Top Viewed Publications</h2>
          </div>
          ${renderViewAllBtn('#/creator/analytics/all/views')}
        </div>
        ${
          (payload?.topPublications || []).length
            ? `<div class="divide-y divide-slate-100 dark:divide-slate-800/70">
                ${payload.topPublications
                  .map(
                    (p) => `
                  <a href="#/creator/analytics/publication/${p.id}" class="py-2.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3 group">
                    <div class="flex items-center gap-2.5 min-w-0">
                      ${renderThumbHtml(p.coverImageUrl, p.title)}
                      <div class="min-w-0">
                        <div class="text-xs sm:text-sm font-semibold text-[#0F172A] dark:text-white group-hover:text-[#6D28D9] truncate">${esc(p.title)}</div>
                        <div class="text-[11px] text-slate-500 dark:text-slate-400">${esc(p.contentType)} • ${Number(p.uniqueViewers || 0).toLocaleString('en-IN')} unique</div>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <span class="text-xs sm:text-sm font-bold text-[#6D28D9] dark:text-[#A78BFA] tabular-nums">${Number(p.views > 0 ? p.views : p.lifetimeViews || 0).toLocaleString('en-IN')} views</span>
                      <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
                    </div>
                  </a>
                `
                  )
                  .join('')}
              </div>`
            : `<p class="text-xs text-slate-500 text-center py-6">No publication views recorded in this date range.</p>`
        }
      </section>
    </div>
  `;
}

// =========================================================================
// 3. Likes Analytics Page (Exact Match to Likes Analytics Screenshot)
// =========================================================================
function renderLikesAnalyticsHtml(payload) {
  const s = payload?.summary || {};
  const filter = payload?.filter || {};

  const growthText =
    s.growthPct === null || s.growthPct === undefined
      ? '—'
      : `${Number(s.growthPct) > 0 ? '+' : ''}${Number(s.growthPct).toFixed(1).replace(/\.0$/, '')}%`;

  return `
    <div class="space-y-3 sm:space-y-4">
      <!-- Header -->
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-start gap-2.5 min-w-0">
          ${renderBackCircleBtn('#/creator/analytics')}
          <div class="min-w-0">
            <h1 class="text-[17px] sm:text-2xl font-bold text-[#0F172A] dark:text-white leading-tight truncate">Likes Analytics</h1>
            <p class="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 mt-0.5">Track likes on your content and find what your audience loves.</p>
          </div>
        </div>
        ${renderDateFilterBar(filter)}
      </div>
      ${renderCustomDateDrawer(filter)}

      <!-- Hero Total Likes Card -->
      <div class="relative overflow-hidden rounded-2xl border border-[#E5E8F6] dark:border-[#242C4A] bg-gradient-to-r from-white via-white to-[#EFEAFF] dark:from-[#131C31] dark:via-[#131C31] dark:to-[#1F1B44] p-3.5 sm:p-5 shadow-[0_2px_10px_rgba(30,27,75,0.03)]">
        <!-- Decorative watermark -->
        <svg class="pointer-events-none absolute right-5 -bottom-4 w-28 h-24 text-[#6D28D9]/[0.07] dark:text-[#A78BFA]/[0.08]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        <div class="flex items-start justify-between gap-3 relative z-10">
          <div class="flex items-center gap-3.5 sm:gap-4">
            <div class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#FCE7F3] dark:bg-[#3A1B35] text-[#EC4899] flex items-center justify-center shrink-0">
              <svg class="w-6 h-6 sm:w-7 sm:h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            </div>
            <div>
              <div class="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300">Total Likes</div>
              <div class="text-2xl sm:text-3xl font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums mt-0.5">${Number(s.totalLikes || 0).toLocaleString('en-IN')}</div>
              ${renderDeltaText(s.growthPct, filter.comparisonLabel)}
            </div>
          </div>
          <div class="pt-0.5">${renderBarsIconSvg('w-5 h-5 sm:w-6 sm:h-6')}</div>
        </div>
      </div>

      <!-- Likes Trend Card -->
      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-2.5">
        <div class="flex items-start justify-between gap-2 flex-wrap">
          <div class="flex items-start gap-2">
            ${renderTrendIconSvg('w-5 h-5 mt-0.5')}
            <div>
              <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Likes Trend</h2>
              <p class="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">Daily likes over the selected period</p>
            </div>
          </div>
          ${renderTrendQuickPills(filter.range)}
        </div>
        ${renderInteractiveLineChart({
          chartId: 'likes-trend',
          points: payload?.series || [],
          primaryKey: 'likes',
          primaryLabel: 'Likes',
          primaryColor: '#6D28D9',
          showLegend: false,
        })}
      </section>

      <!-- Insights Card (3 horizontal sub-cards matching screenshot) -->
      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-3">
        <div class="flex items-center gap-2">
          ${renderBulbSvg('w-5 h-5')}
          <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Insights</h2>
        </div>
        <div class="grid grid-cols-3 gap-2 sm:gap-3">
          <div class="p-2 sm:p-3.5 rounded-xl bg-[#FAFBFD] dark:bg-[#0E1629] border border-[#E6E9F6] dark:border-[#1E2B45] flex items-start gap-2 sm:gap-3">
            <div class="w-7 h-7 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-[#ECEBFF] dark:bg-[#23264D] text-[#6D28D9] dark:text-[#A78BFA] flex items-center justify-center shrink-0">
              ${renderTrendIconSvg('w-4 h-4 sm:w-5 sm:h-5')}
            </div>
            <div class="min-w-0">
              <div class="text-sm sm:text-lg font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${esc(growthText)}</div>
              <div class="text-[10px] sm:text-xs font-semibold text-[#1E1B4B] dark:text-slate-200 mt-0.5 truncate">Growth</div>
              <div class="text-[9px] sm:text-[11px] text-slate-500 dark:text-slate-400 truncate">${esc(filter.comparisonLabel || 'vs previous period')}</div>
            </div>
          </div>

          <div class="p-2 sm:p-3.5 rounded-xl bg-[#FAFBFD] dark:bg-[#0E1629] border border-[#E6E9F6] dark:border-[#1E2B45] flex items-start gap-2 sm:gap-3">
            <div class="w-7 h-7 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-[#ECEBFF] dark:bg-[#23264D] text-[#6D28D9] dark:text-[#A78BFA] flex items-center justify-center shrink-0">
              <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            </div>
            <div class="min-w-0">
              <div class="text-sm sm:text-lg font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${s.engagementRate !== null && s.engagementRate !== undefined ? `${Number(s.engagementRate).toFixed(1)}%` : '—'}</div>
              <div class="text-[10px] sm:text-xs font-semibold text-[#1E1B4B] dark:text-slate-200 mt-0.5 truncate">Engagement Rate</div>
              <div class="text-[9px] sm:text-[11px] text-slate-500 dark:text-slate-400 truncate">(Likes / Views)</div>
            </div>
          </div>

          <div class="p-2 sm:p-3.5 rounded-xl bg-[#FAFBFD] dark:bg-[#0E1629] border border-[#E6E9F6] dark:border-[#1E2B45] flex items-start gap-2 sm:gap-3">
            <div class="w-7 h-7 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-[#FEF3C7] dark:bg-[#382914] text-[#F59E0B] flex items-center justify-center shrink-0">
              ${renderStarSvg('w-4 h-4 sm:w-5 sm:h-5')}
            </div>
            <div class="min-w-0">
              <div class="text-sm sm:text-lg font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${s.avgRating !== null ? Number(s.avgRating).toFixed(1) : '—'}</div>
              <div class="text-[10px] sm:text-xs font-semibold text-[#1E1B4B] dark:text-slate-200 mt-0.5 truncate">Avg Rating</div>
              <div class="text-[9px] sm:text-[11px] text-slate-500 dark:text-slate-400 truncate">${Number(s.reviewsCount || 0) > 0 ? 'from liked content' : 'no ratings yet'}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Top Liked Content -->
      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-2.5">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            ${renderTrophySvg('w-5 h-5')}
            <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Top Liked Content</h2>
          </div>
          ${renderViewAllBtn('#/creator/analytics/all/likes')}
        </div>
        ${
          (payload?.topPublications || []).length
            ? `<div class="divide-y divide-slate-100 dark:divide-slate-800/70">
                ${payload.topPublications
                  .map(
                    (p) => `
                  <a href="#/creator/analytics/publication/${p.id}" class="py-2.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3 group">
                    <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
                      ${renderThumbHtml(p.coverImageUrl, p.title, 'w-12 h-9 sm:w-14 sm:h-10')}
                      <div class="min-w-0">
                        <div class="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white group-hover:text-[#6D28D9] truncate">${esc(p.title)}</div>
                        <div class="text-[11px] text-slate-500 dark:text-slate-400">${esc(p.contentType)} • ${p.isFree ? 'Free' : 'Paid'}</div>
                      </div>
                    </div>
                    <div class="flex items-center gap-2.5 shrink-0">
                      <span class="inline-flex items-center gap-1 text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white tabular-nums">
                        <svg class="w-4 h-4 text-[#6D28D9] dark:text-[#A78BFA]" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                        ${Number(p.likes > 0 ? p.likes : p.lifetimeLikes || 0).toLocaleString('en-IN')}
                      </span>
                      <svg class="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
                    </div>
                  </a>
                `
                  )
                  .join('')}
              </div>`
            : `<p class="text-xs text-slate-500 text-center py-6">No likes recorded in this date range.</p>`
        }
      </section>
    </div>
  `;
}

// =========================================================================
// 4. Sales Analytics Page (Exact Match to Sales Analytics Screenshot)
// =========================================================================
function renderSalesAnalyticsHtml(payload) {
  const k = payload?.kpis || {};
  const filter = payload?.filter || {};
  const bd = payload?.breakdown || {};
  const activeStatus = payload?.orderStatus || analyticsUiState.orderStatus || 'all';
  const orders = payload?.orders || [];
  const pg = payload?.ordersPagination || { page: 1, totalPages: 1, total: 0 };

  const paidOrdersCount = Number(bd.paidOrdersCount || 0);
  const freeDownloadsCount = Number(bd.freeDownloadsCount || 0);
  const breakdownTotal = paidOrdersCount + freeDownloadsCount;
  const paidPct = Number(bd.paidSharePct || 0);
  const freePct = Number(bd.freeSharePct || 0);

  const r = 36;
  const circumference = 2 * Math.PI * r;
  const paidArc = breakdownTotal > 0 ? (paidPct / 100) * circumference : 0;
  const freeArc = breakdownTotal > 0 ? Math.max(0, circumference - paidArc) : 0;

  return `
    <div class="space-y-3 sm:space-y-4">
      <!-- Header -->
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-start gap-2 sm:gap-2.5 min-w-0">
          ${renderBackCircleBtn('#/creator/analytics')}
          <div class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-[#6D28D9] dark:text-[#8B5CF6] shrink-0 mt-0.5">
            <svg class="w-6 h-6 sm:w-7 sm:h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0020 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>
          </div>
          <div class="min-w-0">
            <h1 class="text-[17px] sm:text-2xl font-bold text-[#0F172A] dark:text-white leading-tight truncate">Sales Analytics</h1>
            <p class="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 mt-0.5">Track your sales and conversion performance.</p>
          </div>
        </div>
        ${renderDateFilterBar(filter)}
      </div>
      ${renderCustomDateDrawer(filter)}

      <!-- 2x2 Clickable Filter KPI Grid -->
      <div class="grid grid-cols-2 gap-2.5 sm:gap-4">
        <button type="button" data-order-status="all" class="an-order-filter-btn ${CARD_CLS} text-left p-2.5 sm:p-4 transition-colors ${
    activeStatus === 'all' ? 'ring-1 ring-[#6D28D9]/40 border-[#6D28D9]/60' : ''
  }">
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="w-9 h-9 sm:w-12 sm:h-12 rounded-xl bg-[#ECEBFF] dark:bg-[#23264D] text-[#6D28D9] dark:text-[#A78BFA] flex items-center justify-center shrink-0">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0"></span>
                <span class="truncate">Total Sales</span>
              </div>
              <div class="flex items-end justify-between gap-1 mt-0.5">
                <div class="text-lg sm:text-2xl font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${Number(k.totalSales?.value || 0).toLocaleString('en-IN')}</div>
                ${renderFiveBarsSvg('purple')}
              </div>
              ${renderDeltaText(k.totalSales?.growthPct, filter.comparisonLabel)}
            </div>
          </div>
        </button>

        <button type="button" data-order-status="captured" class="an-order-filter-btn ${CARD_CLS} text-left p-2.5 sm:p-4 transition-colors ${
    activeStatus === 'captured' ? 'ring-1 ring-emerald-500/40 border-emerald-500/60' : ''
  }">
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="w-9 h-9 sm:w-12 sm:h-12 rounded-xl bg-[#DCFCE7] dark:bg-[#133529] text-[#16A34A] flex items-center justify-center shrink-0">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1.2 14.2l-3.7-3.7 1.4-1.4 2.3 2.3 4.8-4.8 1.4 1.4-6.2 6.2z"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0"></span>
                <span class="truncate">Successful Orders</span>
              </div>
              <div class="flex items-end justify-between gap-1 mt-0.5">
                <div class="text-lg sm:text-2xl font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${Number(k.successfulOrders?.value || 0).toLocaleString('en-IN')}</div>
                ${renderFiveBarsSvg('emerald')}
              </div>
              ${renderDeltaText(k.successfulOrders?.growthPct, filter.comparisonLabel)}
            </div>
          </div>
        </button>

        <button type="button" data-order-status="failed" class="an-order-filter-btn ${CARD_CLS} text-left p-2.5 sm:p-4 transition-colors ${
    activeStatus === 'failed' ? 'ring-1 ring-rose-500/40 border-rose-500/60' : ''
  }">
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="w-9 h-9 sm:w-12 sm:h-12 rounded-xl bg-[#F3E8FF] dark:bg-[#321C4A] text-[#7C3AED] flex items-center justify-center shrink-0">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm3.5 12.1L14.1 15.5 12 13.4l-2.1 2.1-1.4-1.4L10.6 12 8.5 9.9l1.4-1.4L12 10.6l2.1-2.1 1.4 1.4L13.4 12l2.1 2.1z"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0"></span>
                <span class="truncate">Cancelled Orders</span>
              </div>
              <div class="flex items-end justify-between gap-1 mt-0.5">
                <div class="text-lg sm:text-2xl font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${Number(k.cancelledOrders?.value || 0).toLocaleString('en-IN')}</div>
                ${renderFiveBarsSvg('rose')}
              </div>
              ${renderDeltaText(k.cancelledOrders?.growthPct, filter.comparisonLabel)}
            </div>
          </div>
        </button>

        <button type="button" data-order-status="refunded" class="an-order-filter-btn ${CARD_CLS} text-left p-2.5 sm:p-4 transition-colors ${
    activeStatus === 'refunded' ? 'ring-1 ring-amber-500/40 border-amber-500/60' : ''
  }">
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="w-9 h-9 sm:w-12 sm:h-12 rounded-xl bg-[#E0F2FE] dark:bg-[#152D4A] text-[#0284C7] dark:text-[#38BDF8] flex items-center justify-center shrink-0">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0"></span>
                <span class="truncate">Refunded Orders</span>
              </div>
              <div class="flex items-end justify-between gap-1 mt-0.5">
                <div class="text-lg sm:text-2xl font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${Number(k.refundedOrders?.value || 0).toLocaleString('en-IN')}</div>
                ${renderFiveBarsSvg('amber')}
              </div>
              ${renderDeltaText(k.refundedOrders?.growthPct, filter.comparisonLabel)}
            </div>
          </div>
        </button>
      </div>

      <!-- Sales Trend Chart Card -->
      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-2.5">
        <div class="flex items-start justify-between gap-2 flex-wrap">
          <div class="flex items-start gap-2">
            ${renderSolidBarsIconSvg('w-5 h-5 mt-0.5')}
            <div>
              <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Sales Trend</h2>
              <p class="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">Daily sales over the selected period</p>
            </div>
          </div>
          ${renderTrendQuickPills(filter.range)}
        </div>
        ${renderInteractiveLineChart({
          chartId: 'sales-trend',
          points: payload?.series || [],
          primaryKey: 'orders',
          primaryLabel: 'Orders',
          primaryColor: '#6D28D9',
          primaryCurrency: false,
          secondaryKey: 'salesAmountInr',
          secondaryLabel: 'Sales Amount (₹)',
          secondaryColor: '#0EA5E9',
          secondaryCurrency: true,
        })}
      </section>

      <!-- Bottom Side-by-Side: Sales Breakdown + Top Selling Publications -->
      <div class="grid grid-cols-1 min-[460px]:grid-cols-12 gap-3 sm:gap-4">
        <section class="min-[460px]:col-span-5 ${CARD_CLS} p-3.5 sm:p-5 flex flex-col justify-between space-y-3">
          <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Sales Breakdown</h2>
          <div class="flex items-center gap-3 sm:gap-4 my-auto py-1">
            <div class="relative w-24 h-24 sm:w-28 sm:h-28 shrink-0">
              <svg viewBox="0 0 96 96" class="w-full h-full -rotate-90">
                <circle cx="48" cy="48" r="${r}" fill="none" stroke="currentColor" class="text-slate-200 dark:text-slate-800" stroke-width="13" />
                ${
                  breakdownTotal > 0 && freePct > 0
                    ? `<circle cx="48" cy="48" r="${r}" fill="none" stroke="#0EA5E9" stroke-width="13" stroke-dasharray="${freeArc.toFixed(1)} ${circumference.toFixed(1)}" stroke-dashoffset="-${paidArc.toFixed(1)}" />`
                    : ''
                }
                ${
                  breakdownTotal > 0 && paidPct > 0
                    ? `<circle cx="48" cy="48" r="${r}" fill="none" stroke="#6D28D9" stroke-width="13" stroke-dasharray="${paidArc.toFixed(1)} ${circumference.toFixed(1)}" />`
                    : ''
                }
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">
                <span class="text-sm sm:text-base font-extrabold text-[#0F172A] dark:text-white tabular-nums">${Number(breakdownTotal).toLocaleString('en-IN')}</span>
                <span class="text-[9px] sm:text-[10px] font-medium text-slate-500 dark:text-slate-400">Total Sales</span>
              </div>
            </div>

            <div class="space-y-3 text-[11px] sm:text-xs flex-1 min-w-0">
              <div>
                <div class="inline-flex items-center gap-1.5 font-semibold text-[#0F172A] dark:text-slate-100">
                  <span class="w-2.5 h-2.5 rounded-full bg-[#6D28D9] shrink-0"></span>
                  <span class="truncate">Paid Content</span>
                </div>
                <div class="pl-4 text-slate-600 dark:text-slate-400 tabular-nums font-medium">${paidPct.toFixed(0)}% (${paidOrdersCount})</div>
              </div>
              <div>
                <div class="inline-flex items-center gap-1.5 font-semibold text-[#0F172A] dark:text-slate-100">
                  <span class="w-2.5 h-2.5 rounded-full bg-[#0EA5E9] shrink-0"></span>
                  <span class="truncate">Free Content</span>
                </div>
                <div class="pl-4 text-slate-600 dark:text-slate-400 tabular-nums font-medium">${freePct.toFixed(0)}% (${freeDownloadsCount})</div>
              </div>
            </div>
          </div>
        </section>

        <section class="min-[460px]:col-span-7 ${CARD_CLS} p-3.5 sm:p-5 space-y-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 sm:gap-2 min-w-0">
              ${renderTrophySvg('w-4 h-4 sm:w-5 sm:h-5')}
              <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white truncate">Top Selling Publications</h2>
            </div>
            ${renderViewAllBtn('#/creator/analytics/all/sales')}
          </div>
          ${
            (payload?.topSelling || []).length
              ? `<div class="divide-y divide-slate-100 dark:divide-slate-800/70">
                  ${payload.topSelling
                    .slice(0, 5)
                    .map(
                      (p) => `
                    <a href="#/creator/analytics/publication/${p.id}" class="py-2.5 first:pt-1 last:pb-1 flex items-center justify-between gap-2.5 group">
                      <div class="flex items-center gap-2.5 min-w-0">
                        ${renderThumbHtml(p.coverImageUrl, p.title, 'w-11 h-8 sm:w-12 sm:h-9')}
                        <div class="min-w-0">
                          <div class="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white group-hover:text-[#6D28D9] truncate">${esc(p.title)}</div>
                          <div class="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400">${esc(p.contentType)} • ${p.isFree ? 'Free' : 'Paid'}</div>
                        </div>
                      </div>
                      <div class="text-right shrink-0">
                        <div class="text-[11px] sm:text-xs font-bold text-[#6D28D9] dark:text-[#A78BFA] tabular-nums whitespace-nowrap">${Number(p.sales || 0)} Sales</div>
                        <div class="text-[11px] sm:text-xs font-bold text-[#10B981] dark:text-[#34D399] tabular-nums whitespace-nowrap">${formatInr(p.earningsInr || 0)}</div>
                      </div>
                    </a>
                  `
                    )
                    .join('')}
                </div>`
              : `<p class="text-xs text-slate-500 text-center py-6">No paid sales recorded in this date range.</p>`
          }
        </section>
      </div>

      <!-- Sanitized Order Details Ledger (Zero Buyer PII) -->
      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Order Details</h2>
            <p class="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">Sanitized order ledger (${esc(activeStatus === 'all' ? 'All orders' : activeStatus)})</p>
          </div>
          <div class="text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">${Number(pg.total || 0)} order(s)</div>
        </div>
        ${
          orders.length
            ? `<div class="overflow-x-auto touch-scroll-x">
                <table class="w-full min-w-[540px] text-left text-xs sm:text-sm">
                  <thead class="text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <tr>
                      <th class="py-2 pr-3 font-medium">Date</th>
                      <th class="py-2 px-3 font-medium">Receipt</th>
                      <th class="py-2 px-3 font-medium">Publication</th>
                      <th class="py-2 px-3 font-medium text-right">Amount</th>
                      <th class="py-2 pl-3 font-medium text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 dark:divide-slate-800/70">
                    ${orders
                      .map(
                        (o) => `
                      <tr>
                        <td class="py-2.5 pr-3 text-[11px] text-slate-500 whitespace-nowrap">${esc(formatDateTime(o.createdAt))}</td>
                        <td class="py-2.5 px-3 font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-nowrap">${esc(o.receiptNumber)}</td>
                        <td class="py-2.5 px-3">
                          <a href="#/creator/analytics/publication/${o.contentId}" class="text-xs sm:text-sm font-semibold text-[#0F172A] dark:text-slate-100 hover:text-[#6D28D9]">${esc(o.contentTitle)}</a>
                        </td>
                        <td class="py-2.5 px-3 text-right font-semibold tabular-nums">${formatInr(o.amountInr)}</td>
                        <td class="py-2.5 pl-3 text-right">${renderStatusLabel(o.status)}</td>
                      </tr>
                    `
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>
              ${
                pg.totalPages > 1
                  ? `<div class="flex items-center justify-between pt-2 text-xs">
                       <button type="button" data-sales-page="${pg.page - 1}" ${pg.page <= 1 ? 'disabled' : ''} class="an-sales-page-btn px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40">← Previous</button>
                       <span class="text-slate-500 tabular-nums">Page ${pg.page} of ${pg.totalPages}</span>
                       <button type="button" data-sales-page="${pg.page + 1}" ${pg.page >= pg.totalPages ? 'disabled' : ''} class="an-sales-page-btn px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40">Next →</button>
                     </div>`
                  : ''
              }`
            : `<p class="text-xs text-slate-500 text-center py-6">No orders matching "${esc(activeStatus)}" in this date range.</p>`
        }
      </section>
    </div>
  `;
}

// =========================================================================
// 5. Earnings Analytics Page (Exact Match to Earnings Analytics Screenshot)
// =========================================================================
function renderEarningsAnalyticsHtml(payload, { showBackButton = true } = {}) {
  const k = payload?.kpis || {};
  const fb = payload?.financialBreakdown || {};
  const w = payload?.wallet || {};
  const filter = payload?.filter || {};
  const history = payload?.history || [];
  const pg = payload?.historyPagination || { page: 1, totalPages: 1, total: 0 };

  return `
    <div class="space-y-3 sm:space-y-4">
      <!-- Header -->
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-start gap-2 sm:gap-2.5 min-w-0">
          ${showBackButton ? renderBackCircleBtn('#/creator/analytics') : ''}
          <div class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-[#6D28D9] dark:text-[#8B5CF6] shrink-0 mt-0.5">
            <svg class="w-6 h-6 sm:w-7 sm:h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M21 7H5a2 2 0 00-2 2v8a3 3 0 003 3h15a1 1 0 001-1V8a1 1 0 00-1-1zm-1 8h-3a2 2 0 010-4h3v4zM4 6.5A2.5 2.5 0 016.5 4H19a1 1 0 010 2H6.5a.5.5 0 000 1H19v1H5a2 2 0 01-1-.5z"/></svg>
          </div>
          <div class="min-w-0">
            <h1 class="text-[17px] sm:text-2xl font-bold text-[#0F172A] dark:text-white leading-tight truncate">Earnings Analytics</h1>
            <p class="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 mt-0.5">Track your earnings and revenue growth.</p>
          </div>
        </div>
        ${renderDateFilterBar(filter)}
      </div>
      ${renderCustomDateDrawer(filter)}

      <!-- 2x2 Financial KPI Grid -->
      <div class="grid grid-cols-2 gap-2.5 sm:gap-4">
        <div class="${CARD_CLS} p-2.5 sm:p-4">
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="w-9 h-9 sm:w-12 sm:h-12 rounded-xl bg-[#ECEBFF] dark:bg-[#23264D] text-[#6D28D9] dark:text-[#A78BFA] flex items-center justify-center shrink-0">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M21 7H5a2 2 0 00-2 2v8a3 3 0 003 3h15a1 1 0 001-1V8a1 1 0 00-1-1zm-1 8h-3a2 2 0 010-4h3v4z"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0"></span>
                <span class="truncate">Total Earnings</span>
              </div>
              <div class="flex items-end justify-between gap-1 mt-0.5">
                <div class="text-lg sm:text-2xl font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${formatInr(k.creatorEarnings?.value || 0)}</div>
                ${renderSparklineSvg(k.creatorEarnings?.sparkline, '#6D28D9', 'earn-net')}
              </div>
              ${renderDeltaText(k.creatorEarnings?.growthPct, filter.comparisonLabel)}
            </div>
          </div>
        </div>

        <div class="${CARD_CLS} p-2.5 sm:p-4">
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="w-9 h-9 sm:w-12 sm:h-12 rounded-xl bg-[#F3E8FF] dark:bg-[#321C4A] text-[#7C3AED] dark:text-[#C4B5FD] flex items-center justify-center shrink-0">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0"></span>
                <span class="truncate">Total Sales</span>
              </div>
              <div class="flex items-end justify-between gap-1 mt-0.5">
                <div class="text-lg sm:text-2xl font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${Number(k.paidSales?.value || 0).toLocaleString('en-IN')}</div>
                ${renderSparklineSvg(k.paidSales?.sparkline, '#7C3AED', 'earn-sales')}
              </div>
              ${renderDeltaText(k.paidSales?.growthPct, filter.comparisonLabel)}
            </div>
          </div>
        </div>

        <div class="${CARD_CLS} p-2.5 sm:p-4">
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="w-9 h-9 sm:w-12 sm:h-12 rounded-xl bg-[#DBEAFE] dark:bg-[#172E54] text-[#0284C7] dark:text-[#38BDF8] flex items-center justify-center shrink-0">
              <span class="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#0EA5E9] text-white text-xs sm:text-sm font-extrabold flex items-center justify-center">%</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0"></span>
                <span class="truncate">Conversion Rate</span>
              </div>
              <div class="flex items-end justify-between gap-1 mt-0.5">
                <div class="text-lg sm:text-2xl font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate">${k.conversionRate?.value !== null && k.conversionRate?.value !== undefined ? `${Number(k.conversionRate.value).toFixed(2)}%` : '—'}</div>
                ${renderSparklineSvg([1, 2, 1.8, 2.5, 2.2, 3], '#10B981', 'earn-conv')}
              </div>
              <div class="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                ${
                  k.conversionRate?.deltaPoints !== null && k.conversionRate?.deltaPoints !== undefined
                    ? `<span class="${Number(k.conversionRate.deltaPoints) >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'} font-semibold">${Number(k.conversionRate.deltaPoints) >= 0 ? '↑' : '↓'} ${Math.abs(Number(k.conversionRate.deltaPoints)).toFixed(2)}%</span> ${esc(filter.comparisonLabel || 'vs previous period')}`
                    : 'Paid sales / tracked views'
                }
              </div>
            </div>
          </div>
        </div>

        <a href="#/creator/wallet" class="${CARD_CLS} p-2.5 sm:p-4 hover:border-[#6D28D9]/40 transition-colors block">
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="w-9 h-9 sm:w-12 sm:h-12 rounded-xl bg-[#FEF3C7] dark:bg-[#382914] text-[#D97706] flex items-center justify-center shrink-0">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C7.58 2 4 3.57 4 5.5S7.58 9 12 9s8-1.57 8-3.5S16.42 2 12 2zm0 9c-4.42 0-8-1.57-8-3.5v3C4 12.43 7.58 14 12 14s8-1.57 8-3.5v-3c0 1.93-3.58 3.5-8 3.5zm0 5c-4.42 0-8-1.57-8-3.5v3c0 1.93 3.58 3.5 8 3.5s8-1.57 8-3.5v-3c0 1.93-3.58 3.5-8 3.5z"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300 truncate">Pending Earnings</div>
                  <div class="text-lg sm:text-2xl font-extrabold text-[#0F172A] dark:text-white leading-tight tabular-nums truncate mt-0.5">${formatInr(w.pendingEarningsInr || 0)}</div>
                </div>
                <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#ECEBFF] dark:bg-[#23264D] text-[#6D28D9] dark:text-[#A78BFA] flex items-center justify-center shrink-0">
                  <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                </div>
              </div>
              <div class="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate" title="Available balance: ${esc(formatInr(w.availableBalanceInr || 0))}">Next payout cycle · Avail: ${formatInr(w.availableBalanceInr || 0)}</div>
            </div>
          </div>
        </a>
      </div>

      <!-- Earnings Trend Chart Card -->
      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-2.5">
        <div class="flex items-start justify-between gap-2 flex-wrap">
          <div class="flex items-start gap-2">
            ${renderSolidBarsIconSvg('w-5 h-5 mt-0.5')}
            <div>
              <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Earnings Trend</h2>
              <p class="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">Your earnings over the selected period</p>
            </div>
          </div>
          ${renderTrendQuickPills(filter.range)}
        </div>
        ${renderInteractiveLineChart({
          chartId: 'earnings-trend',
          points: payload?.series || [],
          primaryKey: 'grossInr',
          primaryLabel: 'Total Earnings',
          primaryColor: '#6D28D9',
          primaryCurrency: true,
          secondaryKey: 'creatorEarningsInr',
          secondaryLabel: 'Creator Share',
          secondaryColor: '#0EA5E9',
          secondaryCurrency: true,
        })}
      </section>

      <!-- Top Earning Publications -->
      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            ${renderTrophySvg('w-5 h-5')}
            <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Top Earning Publications</h2>
          </div>
          ${renderViewAllBtn('#/creator/analytics/all/earnings')}
        </div>
        ${
          (payload?.topEarning || []).length
            ? `<div class="divide-y divide-slate-100 dark:divide-slate-800/70">
                ${payload.topEarning
                  .map(
                    (p) => `
                  <div class="py-2.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
                      ${renderThumbHtml(p.coverImageUrl, p.title, 'w-12 h-9 sm:w-14 sm:h-10')}
                      <div class="min-w-0">
                        <div class="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white truncate">${esc(p.title)}</div>
                        <div class="text-[11px] text-slate-500 dark:text-slate-400">${esc(p.contentType)} • ${p.isFree ? 'Free' : 'Paid'}</div>
                      </div>
                    </div>
                    <div class="flex items-center gap-2.5 sm:gap-3 shrink-0">
                      <div class="text-right">
                        <div class="text-xs sm:text-sm font-extrabold text-[#0F172A] dark:text-white tabular-nums">${formatInr(p.earningsInr || 0)}</div>
                        <div class="text-[11px] font-semibold text-[#10B981] dark:text-[#34D399] tabular-nums">${Number(p.sales || 0)} sales</div>
                      </div>
                      <a href="#/creator/analytics/publication/${p.id}" class="px-2.5 sm:px-3 py-1.5 rounded-xl border border-[#D8DCF2] dark:border-[#2B3959] bg-white dark:bg-[#1A243E] text-[11px] sm:text-xs font-semibold text-[#1E1B4B] dark:text-slate-200 hover:bg-[#F3EFFE] dark:hover:bg-[#272052] whitespace-nowrap transition-colors">View Details</a>
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>`
            : `<p class="text-xs text-slate-500 text-center py-6">No paid earnings recorded in this period.</p>`
        }
      </section>

      <!-- Commission & Wallet Summary -->
      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Commission &amp; Wallet Summary</h2>
          <div class="flex items-center gap-3 text-xs">
            <span class="text-slate-500 dark:text-slate-400">Commission: <strong class="font-semibold text-[#0F172A] dark:text-white">${Number(fb.effectiveCommissionRate || 10)}%</strong></span>
            <a href="#/creator/wallet" class="font-semibold text-[#6D28D9] dark:text-[#A78BFA] hover:underline">Manage Wallet →</a>
          </div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div class="p-3 rounded-xl bg-[#FAFBFD] dark:bg-[#0E1629] border border-[#E6E9F6] dark:border-[#1E2B45]">
            <div class="text-slate-500 dark:text-slate-400">Gross Sales</div>
            <div class="text-base sm:text-lg font-bold text-[#0F172A] dark:text-white mt-0.5 tabular-nums">${formatInr(fb.grossSalesInr || 0)}</div>
          </div>
          <div class="p-3 rounded-xl bg-[#FAFBFD] dark:bg-[#0E1629] border border-[#E6E9F6] dark:border-[#1E2B45]">
            <div class="text-slate-500 dark:text-slate-400">Platform Commission</div>
            <div class="text-base sm:text-lg font-bold text-slate-600 dark:text-slate-300 mt-0.5 tabular-nums">−${formatInr(fb.platformCommissionInr || 0)}</div>
          </div>
          <div class="p-3 rounded-xl bg-[#FAFBFD] dark:bg-[#0E1629] border border-[#E6E9F6] dark:border-[#1E2B45]">
            <div class="text-slate-500 dark:text-slate-400">Available Balance</div>
            <div class="text-base sm:text-lg font-bold text-[#10B981] dark:text-[#34D399] mt-0.5 tabular-nums">${formatInr(w.availableBalanceInr || 0)}</div>
          </div>
          <div class="p-3 rounded-xl bg-[#FAFBFD] dark:bg-[#0E1629] border border-[#E6E9F6] dark:border-[#1E2B45]">
            <div class="text-slate-500 dark:text-slate-400">Withdrawn</div>
            <div class="text-base sm:text-lg font-bold text-[#0F172A] dark:text-white mt-0.5 tabular-nums">${formatInr(w.withdrawnAmountInr || 0)}</div>
          </div>
        </div>
      </section>

      <!-- Earnings & Commission History -->
      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Earnings &amp; Commission History</h2>
          <span class="text-xs text-slate-500 tabular-nums">${Number(pg.total || 0)} record(s)</span>
        </div>
        ${
          history.length
            ? `<div class="overflow-x-auto touch-scroll-x">
                <table class="w-full min-w-[600px] text-left text-xs sm:text-sm">
                  <thead class="text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <tr>
                      <th class="py-2 pr-3 font-medium">Date</th>
                      <th class="py-2 px-3 font-medium">Publication</th>
                      <th class="py-2 px-3 font-medium text-right">Sale Price</th>
                      <th class="py-2 px-3 font-medium text-right">Commission</th>
                      <th class="py-2 px-3 font-medium text-right">Your Earnings</th>
                      <th class="py-2 pl-3 font-medium text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 dark:divide-slate-800/70">
                    ${history
                      .map(
                        (cm) => `
                      <tr>
                        <td class="py-2.5 pr-3 text-[11px] text-slate-500 whitespace-nowrap">${esc(formatDate(cm.createdAt))}</td>
                        <td class="py-2.5 px-3">
                          <a href="#/creator/analytics/publication/${cm.contentId}" class="font-semibold text-[#0F172A] dark:text-slate-100 hover:text-[#6D28D9]">${esc(cm.contentTitle)}</a>
                        </td>
                        <td class="py-2.5 px-3 text-right tabular-nums">${formatInr(cm.grossAmountInr)}</td>
                        <td class="py-2.5 px-3 text-right text-[11px] text-slate-500 tabular-nums">${formatInr(cm.platformCommissionInr)} (${Number(cm.commissionRate)}%)</td>
                        <td class="py-2.5 px-3 text-right font-bold tabular-nums ${cm.status === 'reversed' ? 'text-rose-600 line-through' : 'text-[#10B981] dark:text-[#34D399]'}">${formatInr(cm.creatorEarningsInr)}</td>
                        <td class="py-2.5 pl-3 text-right">${renderStatusLabel(cm.status)}</td>
                      </tr>
                    `
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>
              ${
                pg.totalPages > 1
                  ? `<div class="flex items-center justify-between pt-2 text-xs">
                       <button type="button" data-earnings-page="${pg.page - 1}" ${pg.page <= 1 ? 'disabled' : ''} class="an-earnings-page-btn px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40">← Previous</button>
                       <span class="text-slate-500 tabular-nums">Page ${pg.page} of ${pg.totalPages}</span>
                       <button type="button" data-earnings-page="${pg.page + 1}" ${pg.page >= pg.totalPages ? 'disabled' : ''} class="an-earnings-page-btn px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40">Next →</button>
                     </div>`
                  : ''
              }`
            : `<p class="text-xs text-slate-500 text-center py-6">No earnings records in this date range.</p>`
        }
      </section>
    </div>
  `;
}

// =========================================================================
// 6. Publication Performance Details Page (Exact Match to Screenshot)
// =========================================================================
export function renderPublicationAnalyticsDetailHtml(payload, { backHash = '#/creator/analytics' } = {}) {
  const pub = payload?.publication || {};
  const k = payload?.kpis || {};
  const ins = payload?.insights || {};
  const filter = payload?.filter || {};
  const series = payload?.series || [];
  const refObj = payload?.topReferrers || { available: false, items: [] };
  const activeTab = analyticsUiState.pubChartMetric || 'views';

  const tabMap = {
    views: { key: 'views', label: 'Views', color: '#6D28D9', currency: false },
    likes: { key: 'likes', label: 'Likes', color: '#6D28D9', currency: false },
    sales: { key: 'sales', label: 'Paid Sales', color: '#6D28D9', currency: false },
    earnings: { key: 'earningsInr', label: 'Earnings (₹)', color: '#6D28D9', currency: true },
  };
  const cfg = tabMap[activeTab] || tabMap.views;

  // Honest performance tier rating derived strictly from real backend fields
  const tier = pub.performanceTier;
  let perfHeadline = 'Collecting Data';
  let perfSub = 'New publication';
  let perfColor = 'text-[#6D28D9] dark:text-[#A78BFA]';
  if (tier) {
    const pct = (tier.rank / Math.max(1, tier.total)) * 100;
    if (pct <= 20) {
      perfHeadline = 'Excellent';
      perfColor = 'text-[#10B981] dark:text-[#34D399]';
    } else if (pct <= 50) {
      perfHeadline = 'Strong';
      perfColor = 'text-[#10B981] dark:text-[#34D399]';
    } else {
      perfHeadline = 'Growing';
      perfColor = 'text-[#0EA5E9] dark:text-[#38BDF8]';
    }
    perfSub = `Rank #${tier.rank} of ${tier.total} among your content`;
  } else if (Number(k.totalViews?.lifetimeValue || 0) > 0) {
    perfHeadline = 'Active';
    perfColor = 'text-[#10B981] dark:text-[#34D399]';
    perfSub = 'Based on live publication stats';
  }

  const allRefs = Array.isArray(refObj.items) ? refObj.items : [];
  const visibleRefs = analyticsUiState.showAllReferrers ? allRefs : allRefs.slice(0, 4);

  const referrerStyle = (sourceRaw) => {
    const s = String(sourceRaw || '').toLowerCase();
    if (s === 'direct') {
      return {
        bg: 'bg-[#2563EB]',
        bar: '#6D28D9',
        icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>',
      };
    }
    if (s === 'search' || s === 'google' || s === 'explore') {
      return {
        bg: 'bg-[#0EA5E9]',
        bar: '#0EA5E9',
        icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z"/>',
      };
    }
    if (s === 'social') {
      return {
        bg: 'bg-[#10B981]',
        bar: '#10B981',
        icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>',
      };
    }
    return {
      bg: 'bg-[#CBD5E1] dark:bg-slate-600',
      bar: '#CBD5E1',
      icon: '<circle cx="8" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="16" cy="12" r="1.4" fill="currentColor"/>',
    };
  };

  const rangeSentence = String(filter.rangeLabel || 'Last 30 Days').toLowerCase();

  return `
    <div class="space-y-3 sm:space-y-4">
      <!-- Header -->
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-start gap-2.5 min-w-0">
          ${renderBackCircleBtn(backHash)}
          <div class="min-w-0">
            <h1 class="text-[17px] sm:text-2xl font-bold text-[#0F172A] dark:text-white leading-tight truncate">Publication Performance Details</h1>
            <p class="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 mt-0.5">Detailed analytics for your selected publication</p>
          </div>
        </div>
        ${renderDateFilterBar(filter)}
      </div>
      ${renderCustomDateDrawer(filter)}

      <!-- Unified Publication Header + Overall Performance Card -->
      <section class="${CARD_CLS} p-3.5 sm:p-5 flex flex-col sm:flex-row sm:items-stretch justify-between gap-3.5">
        <div class="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
          ${renderThumbHtml(pub.coverImageUrl, pub.title, 'w-20 h-20 sm:w-24 sm:h-24', String(pub.contentType || 'PDF').toLowerCase() === 'pdf book' ? 'PDF' : pub.contentType || '')}
          <div class="min-w-0 flex-1">
            <h2 class="text-sm sm:text-lg font-bold text-[#0F172A] dark:text-white leading-snug line-clamp-2">${esc(pub.title || 'Publication')}</h2>
            <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span class="px-2 py-0.5 rounded-full bg-[#F3E8FF] dark:bg-[#2E1E59] text-[#6D28D9] dark:text-[#C4B5FD] text-[10px] sm:text-[11px] font-semibold">${esc(String(pub.contentType || 'Notes').toLowerCase() === 'pdf book' ? 'PDF' : pub.contentType || 'Notes')}</span>
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#DCFCE7] dark:bg-[#133529] text-[#15803D] dark:text-[#34D399] text-[10px] sm:text-[11px] font-semibold">
                ${pub.isFree ? 'Free' : '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm0 2h14v2H5v-2z"/></svg> Paid'}
              </span>
              ${pub.classLevel ? `<span class="px-2 py-0.5 rounded-full bg-[#E0F2FE] dark:bg-[#152D4A] text-[#0369A1] dark:text-[#7DD3FC] text-[10px] sm:text-[11px] font-semibold">${esc(pub.classLevel)}</span>` : ''}
              ${pub.subjectName || pub.categoryName ? `<span class="px-2 py-0.5 rounded-full bg-[#EDE9FE] dark:bg-[#23254A] text-[#5B21B6] dark:text-[#A5B4FC] text-[10px] sm:text-[11px] font-semibold">${esc(pub.subjectName || pub.categoryName)}</span>` : ''}
            </div>
            ${
              pub.shortDescription
                ? `<p class="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 mt-1.5 line-clamp-2 leading-relaxed">${esc(pub.shortDescription)}</p>`
                : ''
            }
          </div>
        </div>

        <div class="bg-[#F6F7FD] dark:bg-[#19233D] border border-[#E5E8F6] dark:border-[#24304D] rounded-xl px-4 py-3 sm:min-w-[205px] flex flex-col justify-center shrink-0">
          <div class="flex items-center gap-1.5 text-xs font-semibold text-[#1E1B4B] dark:text-slate-200">
            ${renderSolidBarsIconSvg('w-4 h-4')}
            <span>Overall Performance</span>
          </div>
          <div class="flex items-center gap-1.5 mt-1">
            ${renderStarSvg('w-4 h-4')}
            <span class="text-sm sm:text-base font-extrabold ${perfColor}">${esc(perfHeadline)}</span>
          </div>
          <div class="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">${esc(perfSub)}</div>
        </div>
      </section>

      <!-- 5 KPI Cards Row -->
      <div class="grid grid-cols-2 min-[460px]:grid-cols-5 gap-2 sm:gap-3">
        <div class="${CARD_CLS} p-2.5 sm:p-3.5">
          <div class="flex items-center gap-1.5">
            <span class="w-6 h-6 rounded-lg bg-[#ECEBFF] dark:bg-[#23264D] text-[#6D28D9] dark:text-[#A78BFA] inline-flex items-center justify-center shrink-0">
              <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 11.5a4.5 4.5 0 110-9 4.5 4.5 0 010 9z"/></svg>
            </span>
            <span class="text-[10px] sm:text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">Total Views</span>
          </div>
          <div class="text-base sm:text-xl font-extrabold text-[#0F172A] dark:text-white mt-1.5 tabular-nums">${Number(k.totalViews?.value || 0).toLocaleString('en-IN')}</div>
          ${renderDeltaText(k.totalViews?.growthPct, '', { compact: true })}
        </div>

        <div class="${CARD_CLS} p-2.5 sm:p-3.5">
          <div class="flex items-center gap-1.5">
            <span class="w-6 h-6 rounded-lg bg-[#ECEBFF] dark:bg-[#23264D] text-[#6D28D9] dark:text-[#A78BFA] inline-flex items-center justify-center shrink-0">
              <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            </span>
            <span class="text-[10px] sm:text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">Unique Viewers</span>
          </div>
          <div class="text-base sm:text-xl font-extrabold text-[#0F172A] dark:text-white mt-1.5 tabular-nums">${Number(k.uniqueViewers?.value || 0).toLocaleString('en-IN')}</div>
          ${renderDeltaText(k.uniqueViewers?.growthPct, '', { compact: true })}
        </div>

        <div class="${CARD_CLS} p-2.5 sm:p-3.5">
          <div class="flex items-center gap-1.5">
            <span class="w-6 h-6 rounded-lg bg-[#FCE7F3] dark:bg-[#3A1B35] text-[#EC4899] inline-flex items-center justify-center shrink-0">
              <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            </span>
            <span class="text-[10px] sm:text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">Likes</span>
          </div>
          <div class="text-base sm:text-xl font-extrabold text-[#0F172A] dark:text-white mt-1.5 tabular-nums">${Number(k.likes?.value || 0).toLocaleString('en-IN')}</div>
          ${renderDeltaText(k.likes?.growthPct, '', { compact: true })}
        </div>

        <div class="${CARD_CLS} p-2.5 sm:p-3.5">
          <div class="flex items-center gap-1.5">
            <span class="w-6 h-6 rounded-lg bg-[#DCFCE7] dark:bg-[#133529] text-[#16A34A] inline-flex items-center justify-center shrink-0">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17"/></svg>
            </span>
            <span class="text-[10px] sm:text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">Paid Sales</span>
          </div>
          <div class="text-base sm:text-xl font-extrabold text-[#0F172A] dark:text-white mt-1.5 tabular-nums">${Number(k.paidSales?.value || 0).toLocaleString('en-IN')}</div>
          ${renderDeltaText(k.paidSales?.growthPct, '', { compact: true })}
        </div>

        <div class="col-span-2 min-[460px]:col-span-1 ${CARD_CLS} p-2.5 sm:p-3.5">
          <div class="flex items-center gap-1.5">
            <span class="w-6 h-6 rounded-lg bg-[#ECEBFF] dark:bg-[#23264D] text-[#6D28D9] dark:text-[#A78BFA] inline-flex items-center justify-center shrink-0">
              <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M21 7H5a2 2 0 00-2 2v8a3 3 0 003 3h15a1 1 0 001-1V8a1 1 0 00-1-1z"/></svg>
            </span>
            <span class="text-[10px] sm:text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">Earnings</span>
          </div>
          <div class="text-base sm:text-xl font-extrabold text-[#0F172A] dark:text-white mt-1.5 tabular-nums">${formatInr(k.creatorEarnings?.value || 0)}</div>
          ${renderDeltaText(k.creatorEarnings?.growthPct, '', { compact: true })}
        </div>
      </div>

      <!-- Performance Graph Card -->
      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-2.5">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            ${renderTrendIconSvg('w-5 h-5')}
            <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Performance Graph</h2>
          </div>
          <div class="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-[#F3F4FB] dark:bg-[#0B1120] border border-[#E5E8F6] dark:border-[#1E2B45]">
            ${[
              { id: 'views', label: 'Views' },
              { id: 'likes', label: 'Likes' },
              { id: 'sales', label: 'Sales' },
              { id: 'earnings', label: 'Earnings' },
            ]
              .map(
                (t) => `
              <button type="button" data-pub-chart-tab="${t.id}" class="an-pub-chart-tab px-2.5 sm:px-3.5 py-1 rounded-full text-[11px] sm:text-xs font-semibold transition-colors ${
                activeTab === t.id
                  ? 'bg-[#6D28D9] text-white shadow-sm'
                  : 'text-[#1E1B4B] dark:text-slate-300 hover:text-[#6D28D9]'
              }">${t.label}</button>
            `
              )
              .join('')}
          </div>
        </div>
        ${renderInteractiveLineChart({
          chartId: 'pub-detail',
          points: series,
          primaryKey: cfg.key,
          primaryLabel: cfg.label,
          primaryColor: cfg.color,
          primaryCurrency: cfg.currency,
          showLegend: false,
          showPeakCallout: true,
        })}
      </section>

      <!-- Side-by-side: Content Insights + Top Referrers -->
      <div class="grid grid-cols-1 min-[500px]:grid-cols-2 gap-3 sm:gap-4">
        <!-- Content Insights (2x2 internal grid with hairline borders) -->
        <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-3">
          <div class="flex items-center gap-2">
            ${renderBulbSvg('w-5 h-5')}
            <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Content Insights</h2>
          </div>
          <div class="grid grid-cols-2 border-t border-slate-100 dark:border-slate-800/80 pt-1">
            <div class="p-2.5 border-r border-b border-slate-100 dark:border-slate-800/80 flex items-start gap-2.5">
              <div class="w-8 h-8 rounded-full bg-[#ECEBFF] dark:bg-[#23264D] text-[#6D28D9] dark:text-[#A78BFA] flex items-center justify-center shrink-0 mt-0.5">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 11.5a4.5 4.5 0 110-9 4.5 4.5 0 010 9z"/></svg>
              </div>
              <div class="min-w-0">
                <div class="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 leading-snug">Average Views<br/>(per day)</div>
                <div class="text-sm sm:text-base font-extrabold text-[#0F172A] dark:text-white mt-0.5 tabular-nums">${Number(ins.avgViewsPerDay || 0).toLocaleString('en-IN')}</div>
              </div>
            </div>

            <div class="p-2.5 border-b border-slate-100 dark:border-slate-800/80 flex items-start gap-2.5">
              <div class="w-8 h-8 rounded-full bg-[#DCFCE7] dark:bg-[#133529] text-[#16A34A] flex items-center justify-center shrink-0 mt-0.5">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M2 21h4V9H2v12zm20-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L13.17 1 6.59 7.59C6.22 7.95 6 8.45 6 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>
              </div>
              <div class="min-w-0">
                <div class="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 leading-snug">Engagement Rate<br/>(Likes / Views)</div>
                <div class="text-sm sm:text-base font-extrabold text-[#0F172A] dark:text-white mt-0.5 tabular-nums">${ins.engagementRate !== null && ins.engagementRate !== undefined ? `${Number(ins.engagementRate).toFixed(2)}%` : '0.00%'}</div>
              </div>
            </div>

            <div class="p-2.5 border-r border-slate-100 dark:border-slate-800/80 flex items-start gap-2.5">
              <div class="w-8 h-8 rounded-full bg-[#E0F2FE] dark:bg-[#152D4A] text-[#0284C7] flex items-center justify-center shrink-0 mt-0.5">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17"/></svg>
              </div>
              <div class="min-w-0">
                <div class="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 leading-snug">Conversion Rate<br/>(Sales / Views)</div>
                <div class="text-sm sm:text-base font-extrabold text-[#0F172A] dark:text-white mt-0.5 tabular-nums">${ins.conversionRate !== null && ins.conversionRate !== undefined ? `${Number(ins.conversionRate).toFixed(2)}%` : '0.00%'}</div>
              </div>
            </div>

            <div class="p-2.5 flex items-start gap-2.5">
              <div class="w-8 h-8 rounded-full bg-[#F3E8FF] dark:bg-[#321C4A] text-[#6D28D9] dark:text-[#A78BFA] flex items-center justify-center shrink-0 mt-0.5">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.4l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.3l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95L12 2.4z"/></svg>
              </div>
              <div class="min-w-0">
                <div class="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 leading-snug">Average Rating</div>
                <div class="text-sm sm:text-base font-extrabold text-[#0F172A] dark:text-white mt-1 tabular-nums">${ins.avgRating !== null ? `${Number(ins.avgRating).toFixed(1)}/5` : 'No ratings'}</div>
              </div>
            </div>
          </div>
        </section>

        <!-- Top Referrers -->
        <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <svg class="w-5 h-5 text-[#6D28D9] dark:text-[#A78BFA] shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
              <h2 class="text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">Top Referrers</h2>
            </div>
            ${
              allRefs.length > 4
                ? `<button type="button" id="an-toggle-referrers-btn" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#D8DCF2] dark:border-[#2B3959] bg-[#F7F8FE] dark:bg-[#1A243E] text-[11px] font-semibold text-[#1E1B4B] dark:text-slate-200">${analyticsUiState.showAllReferrers ? 'Show Top 4' : 'View All →'}</button>`
                : ''
            }
          </div>

          ${
            refObj.available && visibleRefs.length
              ? `<div class="space-y-2.5">
                  ${visibleRefs
                    .map((r) => {
                      const st = referrerStyle(r.source);
                      return `
                        <div class="flex items-center gap-2.5">
                          <span class="w-7 h-7 rounded-full ${st.bg} text-white flex items-center justify-center shrink-0">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${st.icon}</svg>
                          </span>
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between gap-2 text-[11px] sm:text-xs">
                              <span class="font-semibold text-[#0F172A] dark:text-slate-100 truncate">${esc(r.label)}</span>
                              <span class="font-bold text-[#0F172A] dark:text-white tabular-nums shrink-0">${Number(r.sharePct).toFixed(1)}%</span>
                            </div>
                            <div class="mt-1 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div class="h-full rounded-full" style="width:${Math.max(4, Math.min(100, Number(r.sharePct || 0)))}%;background:${st.bar}"></div>
                            </div>
                          </div>
                        </div>
                      `;
                    })
                    .join('')}
                </div>`
              : `<div class="p-3.5 rounded-xl bg-[#FAFBFD] dark:bg-[#0E1629] border border-[#E6E9F6] dark:border-[#1E2B45] text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                   Referrer tracking data is not available for this period yet. Live reader visits automatically populate Direct Traffic, ScholarPress Search, Google, Social Media, and External sources.
                 </div>`
          }
        </section>
      </div>

      <!-- Bottom Purple Summary Banner -->
      <div class="rounded-2xl bg-gradient-to-r from-[#F4F0FF] via-[#EFEAFF] to-[#E8E1FF] dark:from-[#1B173B] dark:to-[#241E52] border border-[#DDD4FE] dark:border-[#372D6B] p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          ${renderTrophySvg('w-6 h-6')}
          <p class="text-xs sm:text-sm text-[#1E1B4B] dark:text-slate-200 leading-snug">
            This publication has generated <strong class="font-extrabold text-[#0F172A] dark:text-white tabular-nums">${formatInr(k.creatorEarnings?.value || 0)}</strong> in earnings with <strong class="font-extrabold text-[#0F172A] dark:text-white tabular-nums">${Number(k.totalViews?.value || 0).toLocaleString('en-IN')}</strong> views in ${esc(rangeSentence)}.
          </p>
        </div>
        <a href="${esc(backHash)}" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#C4B5FD] dark:border-[#4C1D95] bg-white dark:bg-[#131C31] hover:bg-[#FAF8FF] text-xs font-semibold text-[#1E1B4B] dark:text-slate-100 whitespace-nowrap shadow-xs transition-colors">
          <span>Back to Analytics</span>
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  `;
}

// =========================================================================
// 7. View All Publications Analytics List
// =========================================================================
function renderAllPublicationsAnalyticsHtml(payload) {
  const filter = payload?.filter || {};
  const metric = payload?.metric || 'overview';
  const pg = payload?.pagination || { page: 1, totalPages: 1, total: 0 };

  const backHref =
    metric === 'views' || metric === 'likes' || metric === 'sales' || metric === 'earnings'
      ? `#/creator/analytics/${metric}`
      : '#/creator/analytics';

  return `
    <div class="space-y-3 sm:space-y-4">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-start gap-2.5 min-w-0">
          ${renderBackCircleBtn(backHref)}
          <div class="min-w-0">
            <h1 class="text-[17px] sm:text-2xl font-bold text-[#0F172A] dark:text-white leading-tight truncate">All Publications Analytics</h1>
            <p class="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 mt-0.5">${Number(pg.total || 0)} publication(s) matching filters</p>
          </div>
        </div>
        ${renderDateFilterBar(filter)}
      </div>
      ${renderCustomDateDrawer(filter)}

      <!-- Search, Filters & Sort Controls -->
      <div class="${CARD_CLS} p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div class="relative">
          <input type="search" id="an-all-search" value="${esc(analyticsUiState.allQuery || '')}" placeholder="Search publications..." class="w-full min-h-[38px] pl-9 pr-3 py-1.5 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100" />
          <svg class="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </div>

        <select id="an-all-type" class="min-h-[38px] px-3 py-1.5 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100">
          <option value="all" ${analyticsUiState.allContentType === 'all' ? 'selected' : ''}>All Content Types</option>
          ${CONTENT_TYPES.map((t) => `<option value="${esc(t)}" ${analyticsUiState.allContentType === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>

        <select id="an-all-tier" class="min-h-[38px] px-3 py-1.5 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100">
          <option value="all" ${analyticsUiState.allTier === 'all' ? 'selected' : ''}>All Pricing (Free &amp; Paid)</option>
          <option value="paid" ${analyticsUiState.allTier === 'paid' ? 'selected' : ''}>Paid Only</option>
          <option value="free" ${analyticsUiState.allTier === 'free' ? 'selected' : ''}>Free Only</option>
        </select>

        <select id="an-all-sort" class="min-h-[38px] px-3 py-1.5 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100">
          <option value="views" ${analyticsUiState.allSort === 'views' ? 'selected' : ''}>Sort: Most Viewed</option>
          <option value="likes" ${analyticsUiState.allSort === 'likes' ? 'selected' : ''}>Sort: Most Liked</option>
          <option value="sales" ${analyticsUiState.allSort === 'sales' ? 'selected' : ''}>Sort: Top Selling</option>
          <option value="earnings" ${analyticsUiState.allSort === 'earnings' ? 'selected' : ''}>Sort: Highest Earnings</option>
          <option value="conversion" ${analyticsUiState.allSort === 'conversion' ? 'selected' : ''}>Sort: Conversion Rate</option>
          <option value="latest" ${analyticsUiState.allSort === 'latest' ? 'selected' : ''}>Sort: Latest</option>
        </select>
      </div>

      <section class="${CARD_CLS} p-3.5 sm:p-5 space-y-3">
        ${renderTopPublicationsTableHtml(payload?.items || [])}
        ${
          pg.totalPages > 1
            ? `<div class="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                 <button type="button" data-all-page="${pg.page - 1}" ${!pg.hasPrev ? 'disabled' : ''} class="an-all-page-btn px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 disabled:opacity-40">← Previous</button>
                 <span class="text-slate-500 tabular-nums">Page ${pg.page} of ${pg.totalPages}</span>
                 <button type="button" data-all-page="${pg.page + 1}" ${!pg.hasNext ? 'disabled' : ''} class="an-all-page-btn px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 disabled:opacity-40">Next →</button>
               </div>`
            : ''
        }
      </section>
    </div>
  `;
}

export function resolveAnalyticsSubRoute(activeTab, subId, subView) {
  if (activeTab === 'earnings') {
    return { mode: 'earnings', subId: null, showBackButton: false };
  }
  if (subId === 'views') return { mode: 'views', subId: null, showBackButton: true };
  if (subId === 'likes') return { mode: 'likes', subId: null, showBackButton: true };
  if (subId === 'sales') return { mode: 'sales', subId: null, showBackButton: true };
  if (subId === 'earnings') return { mode: 'earnings', subId: null, showBackButton: true };
  if (subId === 'all') return { mode: 'all', subId: subView || 'overview', showBackButton: true };
  if (subId === 'publication' && subView) return { mode: 'publication', subId: subView, showBackButton: true };
  return { mode: 'overview', subId: null, showBackButton: false };
}

export function renderAnalyticsSectionHtml(activeTab, subId, subView, payload) {
  const route = resolveAnalyticsSubRoute(activeTab, subId, subView);
  if (route.mode !== 'publication' && route.mode !== 'all') {
    analyticsUiState.lastAnalyticsReturnHash = window.location.hash || '#/creator/analytics';
  }
  if (route.mode === 'views') return renderViewsAnalyticsHtml(payload);
  if (route.mode === 'likes') return renderLikesAnalyticsHtml(payload);
  if (route.mode === 'sales') return renderSalesAnalyticsHtml(payload);
  if (route.mode === 'earnings') return renderEarningsAnalyticsHtml(payload, { showBackButton: route.showBackButton });
  if (route.mode === 'all') return renderAllPublicationsAnalyticsHtml(payload);
  if (route.mode === 'publication') {
    return renderPublicationAnalyticsDetailHtml(payload, {
      backHash: analyticsUiState.lastAnalyticsReturnHash || '#/creator/analytics',
    });
  }
  return renderAnalyticsOverviewHtml(payload);
}

let allSearchTimer = null;
let docClickCleanup = null;

export function wireAnalyticsEvents(rootEl, { activeTab, subId, subView, initialPayload }) {
  if (docClickCleanup) {
    docClickCleanup();
    docClickCleanup = null;
  }

  const route = resolveAnalyticsSubRoute(activeTab, subId, subView);
  let currentPayload = initialPayload;

  const reloadView = async () => {
    const bodyEl = document.getElementById('creator-tab-body') || rootEl;
    bodyEl.style.opacity = '0.6';
    try {
      const fresh = await apiFetch(buildAnalyticsApiUrl(route.mode, route.subId), { noCache: true });
      currentPayload = fresh;
      if (fresh?.filter) {
        analyticsUiState.range = fresh.filter.range || analyticsUiState.range;
        analyticsUiState.startDate = fresh.filter.startDate || analyticsUiState.startDate;
        analyticsUiState.endDate = fresh.filter.endDate || analyticsUiState.endDate;
      }
      bodyEl.innerHTML = renderAnalyticsSectionHtml(activeTab, subId, subView, fresh);
      bodyEl.style.opacity = '1';
      wireAnalyticsEvents(bodyEl, { activeTab, subId, subView, initialPayload: fresh });
    } catch (err) {
      bodyEl.style.opacity = '1';
      showToast(err.message || 'Unable to load analytics data.', 'error');
    }
  };

  // Date range pill dropdown menu
  const pillBtn = rootEl.querySelector('#an-date-pill-btn');
  const dateMenu = rootEl.querySelector('#an-date-menu');
  const customBar = rootEl.querySelector('#an-custom-date-bar');
  const startInput = rootEl.querySelector('#an-start-date');
  const endInput = rootEl.querySelector('#an-end-date');

  if (pillBtn && dateMenu) {
    pillBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = dateMenu.classList.contains('hidden');
      dateMenu.classList.toggle('hidden', !isHidden);
      pillBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    });

    const onDocClick = (e) => {
      if (!dateMenu.contains(e.target) && !pillBtn.contains(e.target)) {
        dateMenu.classList.add('hidden');
        pillBtn.setAttribute('aria-expanded', 'false');
      }
    };
    document.addEventListener('click', onDocClick);
    docClickCleanup = () => document.removeEventListener('click', onDocClick);
  }

  rootEl.querySelectorAll('.an-range-opt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.rangeOpt;
      dateMenu?.classList.add('hidden');
      analyticsUiState.range = val;
      analyticsUiState.salesPage = 1;
      analyticsUiState.earningsPage = 1;
      analyticsUiState.allPage = 1;
      if (val === 'custom') {
        customBar?.classList.remove('hidden');
        customBar?.classList.add('flex');
        startInput?.focus();
        return;
      }
      customBar?.classList.add('hidden');
      customBar?.classList.remove('flex');
      reloadView();
    });
  });

  rootEl.querySelector('#an-apply-custom-btn')?.addEventListener('click', () => {
    const s = startInput?.value || '';
    const e = endInput?.value || '';
    if (!s || !e) {
      showToast('Please select both start and end dates.', 'error');
      return;
    }
    if (s > e) {
      showToast('Start date cannot be later than end date.', 'error');
      return;
    }
    analyticsUiState.range = 'custom';
    analyticsUiState.startDate = s;
    analyticsUiState.endDate = e;
    analyticsUiState.salesPage = 1;
    analyticsUiState.earningsPage = 1;
    analyticsUiState.allPage = 1;
    reloadView();
  });

  // Trend quick pills (7D | 30D | 90D | Custom)
  rootEl.querySelectorAll('.an-quick-range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.quickRange;
      analyticsUiState.range = next;
      if (next === 'custom') {
        customBar?.classList.remove('hidden');
        customBar?.classList.add('flex');
        startInput?.focus();
        return;
      }
      customBar?.classList.add('hidden');
      customBar?.classList.remove('flex');
      reloadView();
    });
  });

  // Main Analytics chart metric tabs
  rootEl.querySelectorAll('.an-chart-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextMetric = btn.dataset.chartTab || 'views';
      if (analyticsUiState.chartMetric === nextMetric) return;
      analyticsUiState.chartMetric = nextMetric;
      rootEl.innerHTML = renderAnalyticsSectionHtml(activeTab, subId, subView, currentPayload);
      wireAnalyticsEvents(rootEl, { activeTab, subId, subView, initialPayload: currentPayload });
    });
  });

  // Publication Detail chart metric tabs
  rootEl.querySelectorAll('.an-pub-chart-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextMetric = btn.dataset.pubChartTab || 'views';
      if (analyticsUiState.pubChartMetric === nextMetric) return;
      analyticsUiState.pubChartMetric = nextMetric;
      rootEl.innerHTML = renderAnalyticsSectionHtml(activeTab, subId, subView, currentPayload);
      wireAnalyticsEvents(rootEl, { activeTab, subId, subView, initialPayload: currentPayload });
    });
  });

  // Top Referrers View All toggle
  rootEl.querySelector('#an-toggle-referrers-btn')?.addEventListener('click', () => {
    analyticsUiState.showAllReferrers = !analyticsUiState.showAllReferrers;
    rootEl.innerHTML = renderAnalyticsSectionHtml(activeTab, subId, subView, currentPayload);
    wireAnalyticsEvents(rootEl, { activeTab, subId, subView, initialPayload: currentPayload });
  });

  // Sales KPI cards filter Order Details list
  rootEl.querySelectorAll('.an-order-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      analyticsUiState.orderStatus = btn.dataset.orderStatus || 'all';
      analyticsUiState.salesPage = 1;
      reloadView();
    });
  });

  // Pagination buttons
  rootEl.querySelectorAll('.an-sales-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = Number(btn.dataset.salesPage || 1);
      if (p >= 1) {
        analyticsUiState.salesPage = p;
        reloadView();
      }
    });
  });

  rootEl.querySelectorAll('.an-earnings-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = Number(btn.dataset.earningsPage || 1);
      if (p >= 1) {
        analyticsUiState.earningsPage = p;
        reloadView();
      }
    });
  });

  rootEl.querySelectorAll('.an-all-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = Number(btn.dataset.allPage || 1);
      if (p >= 1) {
        analyticsUiState.allPage = p;
        reloadView();
      }
    });
  });

  // View All Search / Filter / Sort
  const searchInput = rootEl.querySelector('#an-all-search');
  searchInput?.addEventListener('input', () => {
    clearTimeout(allSearchTimer);
    allSearchTimer = setTimeout(() => {
      analyticsUiState.allQuery = searchInput.value.trim();
      analyticsUiState.allPage = 1;
      reloadView();
    }, 320);
  });

  rootEl.querySelector('#an-all-type')?.addEventListener('change', (e) => {
    analyticsUiState.allContentType = e.target.value;
    analyticsUiState.allPage = 1;
    reloadView();
  });

  rootEl.querySelector('#an-all-tier')?.addEventListener('change', (e) => {
    analyticsUiState.allTier = e.target.value;
    analyticsUiState.allPage = 1;
    reloadView();
  });

  rootEl.querySelector('#an-all-sort')?.addEventListener('change', (e) => {
    analyticsUiState.allSort = e.target.value;
    analyticsUiState.allPage = 1;
    reloadView();
  });

  wireInteractiveChartTooltips(rootEl);
}
