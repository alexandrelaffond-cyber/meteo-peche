// Mise en forme et petits composants d'affichage.

const LOCALE = 'fr-FR';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function num(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '–';
  const f = 10 ** digits;
  const r = Math.round(v * f) / f || 0; // évite « -0 »
  return r.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signed(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '–';
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  if (r === 0) return '±' + num(0, digits);
  return (r > 0 ? '+' : '−') + num(Math.abs(r), digits);
}

const fDay = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric' });
const fDayLong = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
const fTime = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const fHour = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit' });

export const day = (ms) => fDay.format(ms);
export const dayLong = (ms) => fDayLong.format(ms);
export const time = (ms) => (ms == null ? '–' : fTime.format(ms));
export const dayTime = (ms) => `${fDay.format(ms)} ${fTime.format(ms)}`;
export const dayHour = (ms) => `${fDay.format(ms)} ${fHour.format(ms).replace(/\s/g, '')}`;

export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `le ${dayTime(ms)}`;
}

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
export const windDir = (deg) => (deg == null ? '' : DIRS[Math.round(deg / 22.5) % 16]);

/** Flèche indiquant où souffle le vent (il vient de `deg`). */
export function windArrow(deg, size = 14) {
  if (deg == null) return '';
  return `<svg class="wind-arrow" width="${size}" height="${size}" viewBox="0 0 24 24" style="transform:rotate(${
    deg + 180
  }deg)" aria-hidden="true"><path d="M12 3l6 14-6-3.5L6 17z" fill="currentColor"/></svg>`;
}

/** Flèche de tendance : niveau -3..3 (baisse rapide → hausse rapide). */
export function trendArrow(level) {
  const rot = { 3: -60, 2: -45, 1: -25, 0: 0, '-1': 25, '-2': 45, '-3': 60 }[level] ?? 0;
  const cls = level <= -2 ? 'down-strong' : level >= 2 ? 'up-strong' : level < 0 ? 'down' : level > 0 ? 'up' : 'flat';
  return `<svg class="trend ${cls}" width="16" height="16" viewBox="0 0 24 24" style="transform:rotate(${rot}deg)" aria-hidden="true"><path d="M4 12h13m-5-5l5 5-5 5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

const WMO = {
  0: ['☀️', 'Ciel clair'],
  1: ['🌤️', 'Peu nuageux'],
  2: ['⛅', 'Éclaircies'],
  3: ['☁️', 'Couvert'],
  45: ['🌫️', 'Brouillard'],
  48: ['🌫️', 'Brouillard givrant'],
  51: ['🌦️', 'Bruine faible'],
  53: ['🌦️', 'Bruine'],
  55: ['🌧️', 'Bruine forte'],
  56: ['🌧️', 'Bruine verglaçante'],
  57: ['🌧️', 'Bruine verglaçante'],
  61: ['🌦️', 'Pluie faible'],
  63: ['🌧️', 'Pluie'],
  65: ['🌧️', 'Pluie forte'],
  66: ['🌧️', 'Pluie verglaçante'],
  67: ['🌧️', 'Pluie verglaçante'],
  71: ['🌨️', 'Neige faible'],
  73: ['🌨️', 'Neige'],
  75: ['❄️', 'Neige forte'],
  77: ['🌨️', 'Grains de neige'],
  80: ['🌦️', 'Averses'],
  81: ['🌧️', 'Averses'],
  82: ['🌧️', 'Fortes averses'],
  85: ['🌨️', 'Averses de neige'],
  86: ['🌨️', 'Averses de neige'],
  95: ['⛈️', 'Orage'],
  96: ['⛈️', 'Orage et grêle'],
  99: ['⛈️', 'Orage et grêle'],
};
export const wmo = (code) => WMO[code] || ['·', '—'];
export const isStorm = (code) => code === 95 || code === 96 || code === 99;

export function uvLabel(uv) {
  if (uv == null) return '';
  if (uv < 3) return 'faible';
  if (uv < 6) return 'modéré';
  if (uv < 8) return 'élevé';
  if (uv < 11) return 'très élevé';
  return 'extrême';
}

export const VIGI = {
  1: { nom: 'verte', cls: 'v1' },
  2: { nom: 'jaune', cls: 'v2' },
  3: { nom: 'orange', cls: 'v3' },
  4: { nom: 'rouge', cls: 'v4' },
};

export const PHENOMENES = {
  1: 'Vent violent',
  2: 'Pluie-inondation',
  3: 'Orages',
  4: 'Crues',
  5: 'Neige-verglas',
  6: 'Canicule',
  7: 'Grand froid',
  8: 'Avalanches',
  9: 'Vagues-submersion',
};

/** Mini-courbe SVG. points : [[x, y], …] ; marque la position `nowX`. */
export function sparkline(points, { width = 120, height = 34, nowX = null, cls = '' } = {}) {
  const pts = points.filter((p) => p[1] != null);
  if (pts.length < 2) return '';
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  if (y1 - y0 < 1e-6) {
    y0 -= 1;
    y1 += 1;
  }
  const X = (x) => ((x - x0) / (x1 - x0)) * width;
  const Y = (y) => height - 3 - ((y - y0) / (y1 - y0)) * (height - 6);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const now =
    nowX != null && nowX > x0 && nowX < x1
      ? `<line x1="${X(nowX).toFixed(1)}" x2="${X(nowX).toFixed(1)}" y1="0" y2="${height}" class="spark-now"/>`
      : '';
  return `<svg class="spark ${cls}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" aria-hidden="true">${now}<path d="${d}" fill="none"/></svg>`;
}

export function slug(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
