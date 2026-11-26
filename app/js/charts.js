// Graphiques détaillés (Chart.js, chargé globalement).
import { day, dayTime, num, startOfDay, time } from './ui.js';

const charts = new Set();
const DAY = 86_400_000;
const HOUR = 3_600_000;

export function destroyAll() {
  for (const c of charts) c.destroy();
  charts.clear();
}

export function destroy(c) {
  if (!c) return;
  c.destroy();
  charts.delete(c);
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function alpha(color, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Garde les points dans [min, max] (+ un point de part et d'autre pour la continuité). */
function clip(points, min, max) {
  let a = 0;
  while (a < points.length && points[a].x < min) a++;
  let b = points.length - 1;
  while (b >= 0 && points[b].x > max) b--;
  return points.slice(Math.max(0, a - 1), Math.min(points.length, b + 2));
}

/* Ligne verticale « maintenant », zone passée grisée et zones surlignées. */
const overlayPlugin = {
  id: 'overlay',
  beforeDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea: a, scales } = chart;
    const x = scales.x;
    if (!x || x.type !== 'linear') return;
    ctx.save();
    for (const b of opts.bands || []) {
      const x0 = Math.max(x.getPixelForValue(b.from), a.left);
      const x1 = Math.min(x.getPixelForValue(b.to), a.right);
      if (x1 <= x0) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
    }
    const now = Date.now();
    if (opts.shadePast && now > x.min) {
      const xn = Math.min(x.getPixelForValue(now), a.right);
      ctx.fillStyle = opts.pastColor;
      ctx.fillRect(a.left, a.top, xn - a.left, a.bottom - a.top);
    }
    ctx.restore();
  },
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea: a, scales } = chart;
    const x = scales.x;
    if (!x || x.type !== 'linear' || !opts.nowLine) return;
    const now = Date.now();
    if (now < x.min || now > x.max) return;
    const px = x.getPixelForValue(now);
    ctx.save();
    ctx.strokeStyle = opts.nowColor;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, a.top);
    ctx.lineTo(px, a.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = opts.nowColor;
    ctx.font = '600 10px -apple-system, system-ui, sans-serif';
    ctx.textAlign = px > a.right - 70 ? 'right' : 'left';
    ctx.fillText('maintenant', px + (ctx.textAlign === 'left' ? 4 : -4), a.top + 10);
    ctx.restore();
  },
};

function tooltipStyle() {
  return {
    backgroundColor: css('--surface-2'),
    titleColor: css('--text'),
    bodyColor: css('--text'),
    borderColor: css('--border'),
    borderWidth: 1,
    padding: 10,
  };
}

/** Options communes aux courbes temporelles. Graduation par jour, ou par heures si la fenêtre est courte. */
function baseOptions({ min, max }) {
  const grid = css('--grid');
  const text = css('--text-2');
  const short = max - min <= 3 * DAY;
  const step = short ? (max - min <= 26 * HOUR ? 3 * HOUR : 6 * HOUR) : DAY;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    parsing: false,
    normalized: true,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 4, right: 4 } },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { color: text, boxWidth: 14, boxHeight: 2, padding: 12, font: { size: 11 } },
      },
      tooltip: { ...tooltipStyle(), callbacks: { title: (items) => (items.length ? dayTime(items[0].parsed.x) : '') } },
      overlay: { nowLine: true, nowColor: css('--text-2'), shadePast: true, pastColor: css('--past'), bands: [] },
    },
    scales: {
      x: {
        type: 'linear',
        min,
        max,
        grid: { color: (c) => (c.tick?.major ? css('--grid-strong') : grid) },
        border: { display: false },
        ticks: {
          color: text,
          font: { size: 11 },
          autoSkip: true,
          maxRotation: 0,
          callback: (v) => {
            if (!short) return day(v);
            return new Date(v).getHours() === 0 ? day(v) : time(v).replace(':00', 'h');
          },
        },
        afterBuildTicks(axis) {
          const ticks = [];
          if (short) {
            // Heures locales rondes (0 h, 3 h, 6 h…).
            const stepH = step / HOUR;
            const d = new Date(axis.min);
            d.setMinutes(0, 0, 0);
            if (d.getTime() < axis.min) d.setHours(d.getHours() + 1);
            while (d.getHours() % stepH) d.setHours(d.getHours() + 1);
            for (; d.getTime() <= axis.max; d.setHours(d.getHours() + stepH))
              ticks.push({ value: d.getTime(), major: d.getHours() === 0 });
          } else {
            for (let t = startOfDay(axis.min) + DAY; t <= axis.max; t += DAY) ticks.push({ value: startOfDay(t + 3 * HOUR) });
          }
          axis.ticks = ticks;
        },
      },
    },
  };
}

function yAxis(color, { position = 'left', title, grid = true, min, max, beginAtZero = false, digits = 0, type = 'linear' } = {}) {
  return {
    type,
    position,
    min,
    max,
    beginAtZero,
    grace: type === 'linear' ? '5%' : undefined,
    grid: { display: grid, color: css('--grid') },
    border: { display: false },
    title: title ? { display: true, text: title, color, font: { size: 11, weight: '600' } } : undefined,
    ticks: {
      color,
      font: { size: 11 },
      maxTicksLimit: type === 'logarithmic' ? 8 : 6,
      callback: (v) => {
        if (type === 'logarithmic') {
          // N'affiche que 1, 2, 5 × 10^n.
          const m = v / 10 ** Math.floor(Math.log10(v));
          if (![1, 2, 5].some((k) => Math.abs(m - k) < 1e-6)) return '';
          return num(v, v < 1 ? (v < 0.1 ? 2 : 1) : 0);
        }
        return num(v, digits);
      },
    },
  };
}

function make(canvas, config) {
  if (!canvas || !window.Chart) return null;
  const c = new window.Chart(canvas, { ...config, plugins: [overlayPlugin, ...(config.plugins || [])] });
  charts.add(c);
  return c;
}

const line = (label, data, color, extra = {}) => ({
  label,
  data,
  borderColor: color,
  backgroundColor: color,
  borderWidth: 2,
  pointRadius: 0,
  pointHoverRadius: 3,
  tension: 0.25,
  spanGaps: true,
  ...extra,
});

const hourly = (fc, key, range) =>
  clip(
    fc.hourly.time.map((t, i) => ({ x: t, y: fc.hourly[key][i] })),
    range.min,
    range.max
  );

/* ---------- Pression ---------- */

export function pressureChart(canvas, fc, events, range) {
  const color = css('--c-pressure');
  const opts = baseOptions(range);
  opts.plugins.legend.display = false;
  opts.plugins.tooltip.callbacks.label = (it) => ` ${num(it.parsed.y, 1)} hPa`;
  opts.plugins.overlay.bands = events.map((e) => ({
    from: e.debut,
    to: e.fin,
    color: alpha(e.sign < 0 ? css('--c-down') : css('--c-up'), e.kind === 'brutale' ? 0.2 : 0.11),
  }));
  opts.scales.y = yAxis(css('--text-2'), { title: 'hPa' });
  return make(canvas, {
    type: 'line',
    data: { datasets: [line('Pression (hPa)', hourly(fc, 'pressure_msl', range), color)] },
    options: opts,
  });
}

/* ---------- Température & vent ---------- */

export function tempWindChart(canvas, fc, range) {
  const opts = baseOptions(range);
  const tc = css('--c-temp');
  const wc = css('--c-wind');
  opts.scales.y = yAxis(tc, { title: '°C' });
  opts.scales.y2 = yAxis(wc, { position: 'right', title: 'km/h', grid: false, beginAtZero: true });
  opts.plugins.tooltip.callbacks.label = (it) => ` ${it.dataset.label} : ${num(it.parsed.y, it.datasetIndex === 0 ? 1 : 0)}`;
  return make(canvas, {
    type: 'line',
    data: {
      datasets: [
        line('Température (°C)', hourly(fc, 'temperature_2m', range), tc),
        line('Vent (km/h)', hourly(fc, 'wind_speed_10m', range), wc, { yAxisID: 'y2', borderWidth: 1.5 }),
        line('Rafales (km/h)', hourly(fc, 'wind_gusts_10m', range), wc, { yAxisID: 'y2', borderWidth: 1, borderDash: [3, 3] }),
      ],
    },
    options: opts,
  });
}

/* ---------- Nuages & UV ---------- */

export function cloudUvChart(canvas, fc, range) {
  const opts = baseOptions(range);
  const cc = css('--c-cloud');
  const uc = css('--c-uv');
  opts.scales.y = yAxis(cc, { title: 'nuages %', min: 0, max: 100 });
  opts.scales.y2 = yAxis(uc, { position: 'right', title: 'UV', grid: false, beginAtZero: true });
  opts.plugins.tooltip.callbacks.label = (it) => ` ${it.dataset.label} : ${num(it.parsed.y, it.datasetIndex === 0 ? 0 : 1)}`;
  return make(canvas, {
    type: 'line',
    data: {
      datasets: [
        line('Couverture nuageuse (%)', hourly(fc, 'cloud_cover', range), cc, {
          fill: 'origin',
          backgroundColor: alpha(cc, 0.18),
          borderWidth: 1,
          tension: 0.3,
        }),
        line('Indice UV', hourly(fc, 'uv_index', range), uc, { yAxisID: 'y2' }),
      ],
    },
    options: opts,
  });
}

/* ---------- Pluie heure par heure (mode Pêche) ---------- */

export function rainHourlyChart(canvas, fc, range) {
  const opts = baseOptions(range);
  const rc = css('--c-rain');
  opts.plugins.legend.display = false;
  opts.scales.y = yAxis(rc, { title: 'mm/h', beginAtZero: true, digits: 1 });
  opts.plugins.tooltip.callbacks.label = (it) => ` ${num(it.parsed.y, 1)} mm`;
  return make(canvas, {
    type: 'bar',
    data: {
      datasets: [
        {
          label: 'Pluie (mm/h)',
          data: hourly(fc, 'precipitation', range),
          backgroundColor: alpha(rc, 0.8),
          barPercentage: 1,
          categoryPercentage: 1,
          borderRadius: 2,
          minBarLength: 0,
        },
      ],
    },
    options: opts,
  });
}

/* ---------- Pluie par jour ---------- */

export function rainChart(canvas, fc, { pastDays = 7, futureDays = 7 } = {}, now = Date.now()) {
  const d = fc.daily;
  const today = startOfDay(now);
  const idx = d.time
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t >= today - pastDays * DAY && t <= today + futureDays * DAY);
  const rc = css('--c-rain');
  const textColor = css('--text-2');
  const values = idx.map(({ i }) => d.precipitation_sum[i]);
  const many = idx.length > 18;
  const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
      if (many && chart.width < 600) return;
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.fillStyle = textColor;
      ctx.font = '600 10px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      meta.data.forEach((bar, k) => {
        const v = values[k];
        if (v == null || v < 0.1) return;
        ctx.fillText(num(v, v < 10 ? 1 : 0), bar.x, bar.y - 4);
      });
      ctx.restore();
    },
  };
  if (!canvas || !window.Chart) return null;
  const c = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: idx.map(({ t }) => (t === today ? 'Auj.' : day(t))),
      datasets: [
        {
          label: 'Pluie (mm)',
          data: values,
          backgroundColor: idx.map(({ t }) => (t < today ? alpha(rc, 0.5) : t === today ? rc : alpha(rc, t - today >= 8 * DAY ? 0.45 : 0.85))),
          borderColor: idx.map(({ t }) => (t > today ? rc : 'transparent')),
          borderWidth: idx.map(({ t }) => (t - today >= 8 * DAY ? 1 : 0)),
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 16 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            title: (it) => day(idx[it[0].dataIndex].t),
            label: (it) => ` ${num(it.parsed.y, 1)} mm${idx[it.dataIndex].t > today ? ' (prévu)' : ''}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: textColor, font: { size: 10 }, maxRotation: 0, autoSkip: true },
        },
        y: yAxis(textColor, { title: 'mm', beginAtZero: true }),
      },
    },
    plugins: [valueLabels],
  });
  charts.add(c);
  return c;
}

/* ---------- Historique mensuel de pluie ---------- */

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function rainMonthsChart(canvas, months, selected, onSelect) {
  const rc = css('--c-rain');
  const nc = css('--text-2');
  const text = css('--text-2');
  if (!canvas || !window.Chart) return null;
  const c = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: months.map((m) => `${MOIS[m.mois]}${m.mois === 0 || m === months[0] ? ' ’' + String(m.annee).slice(2) : ''}`),
      datasets: [
        {
          type: 'line',
          label: 'Normale 1991-2020',
          data: months.map((m) => m.normale),
          borderColor: nc,
          backgroundColor: nc,
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 3,
          pointHoverRadius: 4,
          tension: 0.3,
          order: 0,
        },
        {
          label: 'Pluie du mois (mm)',
          data: months.map((m) => m.total),
          backgroundColor: months.map((m, i) => (i === selected ? rc : m.encours ? alpha(rc, 0.35) : alpha(rc, 0.6))),
          borderColor: months.map((m) => (m.encours ? rc : 'transparent')),
          borderWidth: months.map((m) => (m.encours ? 1.5 : 0)),
          borderRadius: 4,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      onClick: (_e, els) => {
        // Différé : le graphique est recréé par onSelect.
        if (els.length) setTimeout(() => onSelect(els[0].index), 0);
      },
      onHover: (e, els) => {
        e.native.target.style.cursor = els.length ? 'pointer' : 'default';
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: text, boxWidth: 14, boxHeight: 8, padding: 12, font: { size: 11 } } },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            title: (it) => {
              const m = months[it[0].dataIndex];
              return `${MOIS[m.mois]} ${m.annee}${m.encours ? ' (en cours)' : ''}`;
            },
            label: (it) => ` ${it.dataset.label.replace(' (mm)', '')} : ${num(it.parsed.y, 0)} mm`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: text, font: { size: 10 }, maxRotation: 0, autoSkip: true } },
        y: yAxis(text, { title: 'mm', beginAtZero: true }),
      },
    },
  });
  charts.add(c);
  return c;
}

export function rainDailyChart(canvas, month) {
  const rc = css('--c-rain');
  const cc = css('--c-pressure');
  const nc = css('--text-2');
  const text = css('--text-2');
  const labels = [];
  const vals = [];
  const cumul = [];
  let s = 0;
  for (let i = 0; i < month.nbJours; i++) {
    const j = month.jours.find((x) => new Date(x.t).getDate() === i + 1);
    labels.push(String(i + 1));
    vals.push(j ? j.mm : null);
    if (j && j.mm != null) s += j.mm;
    cumul.push(j ? s : null);
  }
  const datasets = [
    { label: 'Pluie du jour (mm)', data: vals, backgroundColor: alpha(rc, 0.85), borderRadius: 2, yAxisID: 'y', order: 2 },
    { type: 'line', label: 'Cumul du mois (mm)', data: cumul, borderColor: cc, backgroundColor: cc, borderWidth: 2, pointRadius: 0, tension: 0.2, yAxisID: 'y2', order: 1 },
  ];
  if (month.normale != null) {
    datasets.push({
      type: 'line',
      label: 'Normale du mois',
      data: labels.map((_, i) => (month.normale * (i + 1)) / month.nbJours),
      borderColor: nc,
      borderWidth: 1,
      borderDash: [4, 3],
      pointRadius: 0,
      yAxisID: 'y2',
      order: 0,
    });
  }
  if (!canvas || !window.Chart) return null;
  const c = new window.Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: text, boxWidth: 14, boxHeight: 8, padding: 12, font: { size: 11 } } },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            title: (it) => `${it[0].label} ${MOIS[month.mois]} ${month.annee}`,
            label: (it) => (it.parsed.y == null ? null : ` ${it.dataset.label.replace(' (mm)', '')} : ${num(it.parsed.y, 1)} mm`),
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: text, font: { size: 10 }, maxRotation: 0, autoSkip: true } },
        y: yAxis(rc, { title: 'mm/jour', beginAtZero: true }),
        y2: yAxis(cc, { position: 'right', title: 'cumul (mm)', grid: false, beginAtZero: true }),
      },
    },
  });
  charts.add(c);
  return c;
}

/* ---------- Hauteur & débit ----------
 * scale :
 *   'zero' : axes partant de 0 → les variations apparaissent à leur vraie proportion ;
 *   'log'  : hauteur depuis 0, débit en échelle logarithmique (variations relatives) ;
 *   'zoom' : axes ajustés aux valeurs → détail fin, mais les variations paraissent grandes.
 */
export function hydroChart(canvas, obs, { scale = 'zero', days = 7, compact = false } = {}) {
  const max = Date.now();
  const min = max - days * DAY;
  const H = clip((obs.H || []).map(([x, y]) => ({ x, y })), min, max);
  const Q = clip((obs.Q || []).map(([x, y]) => ({ x, y: scale === 'log' && y <= 0 ? null : y })), min, max);
  if (!H.length && !Q.length) return null;
  const opts = baseOptions({ min, max });
  opts.plugins.overlay.shadePast = false;
  opts.plugins.overlay.nowLine = false;
  if (compact) opts.plugins.legend.display = false;
  const lc = css('--c-level');
  const qc = css('--c-flow');
  const datasets = [];
  const hMin = H.length ? Math.min(...H.map((p) => p.y)) : 0;
  if (H.length) {
    opts.scales.y = yAxis(lc, {
      title: compact ? 'm' : 'hauteur (m)',
      digits: scale === 'zoom' ? 2 : 1,
      beginAtZero: scale !== 'zoom' && hMin >= 0,
    });
    if (scale !== 'zoom') opts.scales.y.grace = '15%';
    datasets.push(
      line('Hauteur (m)', H, lc, {
        tension: 0.1,
        fill: scale !== 'zoom' ? 'origin' : false,
        backgroundColor: alpha(lc, 0.1),
      })
    );
  }
  if (Q.length) {
    const id = H.length ? 'y2' : 'y';
    opts.scales[id] = yAxis(qc, {
      position: H.length ? 'right' : 'left',
      title: compact ? 'm³/s' : 'débit (m³/s)',
      grid: !H.length,
      digits: 1,
      beginAtZero: scale === 'zero',
      type: scale === 'log' ? 'logarithmic' : 'linear',
    });
    if (scale === 'zero') opts.scales[id].grace = '15%';
    if (scale === 'log') {
      // Échelle log sur au moins une décade, centrée sur les valeurs.
      const qs = Q.map((p) => p.y).filter((v) => v > 0);
      const lo = Math.min(...qs);
      const hi = Math.max(...qs);
      const span = Math.max(10, hi / lo);
      const mid = Math.sqrt(lo * hi);
      opts.scales[id].min = mid / Math.sqrt(span) / 1.3;
      opts.scales[id].max = mid * Math.sqrt(span) * 1.3;
    }
    datasets.push(
      line('Débit (m³/s)', Q, qc, { yAxisID: id, tension: 0.1, borderWidth: 1.5, borderDash: H.length ? [5, 3] : [] })
    );
  }
  opts.plugins.tooltip.callbacks.label = (it) => ` ${it.dataset.label} : ${num(it.parsed.y, 2)}`;
  return make(canvas, { type: 'line', data: { datasets }, options: opts });
}

/** Débit moyen journalier sur 12 mois, avec la plage habituelle (10 %–90 %) et le débit actuel. */
export function flowHistoryChart(canvas, daily, ctx, current, scale = 'zero') {
  if (!daily?.length) return null;
  const qc = css('--c-flow');
  const min = daily[0][0];
  const max = Date.now();
  const opts = baseOptions({ min, max });
  opts.plugins.overlay.shadePast = false;
  opts.plugins.overlay.nowLine = false;
  opts.plugins.tooltip.callbacks.title = (it) => (it.length ? new Date(it[0].parsed.x).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  opts.plugins.tooltip.callbacks.label = (it) => ` ${it.dataset.label} : ${num(it.parsed.y, 2)} m³/s`;
  opts.scales.x.afterBuildTicks = (axis) => {
    const ticks = [];
    const d = new Date(axis.min);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() + 1);
    for (; d.getTime() <= axis.max; d.setMonth(d.getMonth() + 1)) ticks.push({ value: d.getTime(), major: d.getMonth() === 0 });
    axis.ticks = ticks;
  };
  opts.scales.x.ticks.callback = (v) => {
    const d = new Date(v);
    return d.getMonth() === 0 ? String(d.getFullYear()) : MOIS[d.getMonth()];
  };
  const log = scale === 'log';
  opts.scales.y = yAxis(qc, { title: 'débit (m³/s)', type: log ? 'logarithmic' : 'linear', beginAtZero: scale === 'zero', digits: 1 });
  const datasets = [
    line('Débit moyen du jour', daily.map(([x, y]) => ({ x, y: log && y <= 0 ? null : y })), qc, { borderWidth: 1.5, tension: 0.2 }),
  ];
  if (ctx) {
    const flat = (v, label, dash, color) =>
      line(label, [{ x: min, y: v }, { x: max, y: v }], color, { borderWidth: 1, borderDash: dash, pointHoverRadius: 0 });
    datasets.push(flat(ctx.median, 'Médiane 12 mois', [4, 3], css('--text-2')));
  }
  if (current != null) {
    datasets.push({
      label: 'Maintenant',
      data: [{ x: max, y: current }],
      type: 'line',
      showLine: false,
      pointRadius: 5,
      pointHoverRadius: 6,
      borderColor: css('--text'),
      backgroundColor: qc,
      borderWidth: 2,
    });
  }
  return make(canvas, { type: 'line', data: { datasets }, options: opts });
}
