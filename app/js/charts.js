// Graphiques détaillés (Chart.js, chargé globalement).
import { day, dayTime, num, startOfDay } from './ui.js';

const charts = new Set();
const DAY = 86_400_000;

export function destroyAll() {
  for (const c of charts) c.destroy();
  charts.clear();
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function alpha(color, a) {
  // Accepte #rrggbb.
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* Ligne verticale « maintenant » et zones surlignées. */
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
    // Zone « passé » légèrement grisée.
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

function baseOptions({ min, max }) {
  const grid = css('--grid');
  const text = css('--text-2');
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
      tooltip: {
        backgroundColor: css('--surface-2'),
        titleColor: css('--text'),
        bodyColor: css('--text'),
        borderColor: css('--border'),
        borderWidth: 1,
        padding: 10,
        callbacks: { title: (items) => (items.length ? dayTime(items[0].parsed.x) : '') },
      },
      overlay: {
        nowLine: true,
        nowColor: css('--text-2'),
        shadePast: true,
        pastColor: css('--past'),
        bands: [],
      },
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
          callback: (v) => day(v),
        },
        afterBuildTicks(axis) {
          const ticks = [];
          for (let t = startOfDay(axis.min) + DAY; t <= axis.max; t += DAY) {
            // Recalage sur minuit local (changements d'heure).
            ticks.push({ value: startOfDay(t + 3 * 3_600_000) });
          }
          axis.ticks = ticks;
        },
      },
    },
  };
}

function yAxis(color, { position = 'left', title, grid = true, min, beginAtZero = false, digits = 0 } = {}) {
  return {
    type: 'linear',
    position,
    min,
    beginAtZero,
    grace: '5%',
    grid: { display: grid, color: css('--grid') },
    border: { display: false },
    title: title ? { display: true, text: title, color, font: { size: 11, weight: '600' } } : undefined,
    ticks: { color, font: { size: 11 }, maxTicksLimit: 6, callback: (v) => num(v, digits) },
  };
}

function make(canvas, config) {
  const c = new window.Chart(canvas, { ...config, plugins: [overlayPlugin] });
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

/* ---------- Pression ---------- */

export function pressureChart(canvas, fc, events) {
  const { time, pressure_msl: p } = fc.hourly;
  const color = css('--c-pressure');
  const data = time.map((t, i) => ({ x: t, y: p[i] }));
  const opts = baseOptions({ min: time[0], max: time[time.length - 1] });
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
    data: { datasets: [line('Pression (hPa)', data, color, { fill: false })] },
    options: opts,
  });
}

/* ---------- Température & vent ---------- */

export function tempWindChart(canvas, fc) {
  const h = fc.hourly;
  const opts = baseOptions({ min: h.time[0], max: h.time[h.time.length - 1] });
  const tc = css('--c-temp');
  const wc = css('--c-wind');
  opts.scales.y = yAxis(tc, { title: '°C' });
  opts.scales.y2 = yAxis(wc, { position: 'right', title: 'km/h', grid: false, beginAtZero: true });
  opts.plugins.tooltip.callbacks.label = (it) =>
    ` ${it.dataset.label} : ${num(it.parsed.y, it.datasetIndex === 0 ? 1 : 0)}`;
  return make(canvas, {
    type: 'line',
    data: {
      datasets: [
        line('Température (°C)', h.time.map((t, i) => ({ x: t, y: h.temperature_2m[i] })), tc),
        line('Vent (km/h)', h.time.map((t, i) => ({ x: t, y: h.wind_speed_10m[i] })), wc, {
          yAxisID: 'y2',
          borderWidth: 1.5,
        }),
        line('Rafales (km/h)', h.time.map((t, i) => ({ x: t, y: h.wind_gusts_10m[i] })), wc, {
          yAxisID: 'y2',
          borderWidth: 1,
          borderDash: [3, 3],
        }),
      ],
    },
    options: opts,
  });
}

/* ---------- Nuages & UV ---------- */

export function cloudUvChart(canvas, fc) {
  const h = fc.hourly;
  const opts = baseOptions({ min: h.time[0], max: h.time[h.time.length - 1] });
  const cc = css('--c-cloud');
  const uc = css('--c-uv');
  opts.scales.y = yAxis(cc, { title: 'nuages %', min: 0, beginAtZero: true });
  opts.scales.y.max = 100;
  opts.scales.y2 = yAxis(uc, { position: 'right', title: 'UV', grid: false, beginAtZero: true });
  opts.plugins.tooltip.callbacks.label = (it) =>
    ` ${it.dataset.label} : ${num(it.parsed.y, it.datasetIndex === 0 ? 0 : 1)}`;
  return make(canvas, {
    type: 'line',
    data: {
      datasets: [
        line('Couverture nuageuse (%)', h.time.map((t, i) => ({ x: t, y: h.cloud_cover[i] })), cc, {
          fill: 'origin',
          backgroundColor: alpha(cc, 0.18),
          borderWidth: 1,
          tension: 0.3,
        }),
        line('Indice UV', h.time.map((t, i) => ({ x: t, y: h.uv_index[i] })), uc, { yAxisID: 'y2' }),
      ],
    },
    options: opts,
  });
}

/* ---------- Pluie (cumuls journaliers + cumul horaire) ---------- */

export function rainChart(canvas, fc, now = Date.now()) {
  const d = fc.daily;
  const today = startOfDay(now);
  const rc = css('--c-rain');
  const labels = d.time.map((t) => (t === today ? "Auj." : day(t)));
  const colors = d.time.map((t) => (t < today ? alpha(rc, 0.55) : t === today ? rc : alpha(rc, 0.9)));
  const borders = d.time.map((t) => (t > today ? rc : 'transparent'));
  const textColor = css('--text-2');
  const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.fillStyle = textColor;
      ctx.font = '600 10px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      meta.data.forEach((bar, i) => {
        const v = d.precipitation_sum[i];
        if (v == null || v < 0.1) return;
        ctx.fillText(num(v, v < 10 ? 1 : 0), bar.x, bar.y - 4);
      });
      ctx.restore();
    },
  };
  const c = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Pluie (mm)',
          data: d.precipitation_sum,
          backgroundColor: colors,
          borderColor: borders,
          borderWidth: 1,
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
          backgroundColor: css('--surface-2'),
          titleColor: css('--text'),
          bodyColor: css('--text'),
          borderColor: css('--border'),
          borderWidth: 1,
          callbacks: {
            title: (it) => day(d.time[it[0].dataIndex]),
            label: (it) => ` ${num(it.parsed.y, 1)} mm${d.time[it.dataIndex] > today ? ' (prévu)' : ''}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: textColor, font: { size: 10 }, maxRotation: 0, autoSkip: false },
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

export function destroy(c) {
  if (!c) return;
  c.destroy();
  charts.delete(c);
}

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

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

/** Cumul de chaque mois (barres) et normale 1991-2020 (points). `onSelect(i)` au clic. */
export function rainMonthsChart(canvas, months, selected, onSelect) {
  const rc = css('--c-rain');
  const nc = css('--text-2');
  const text = css('--text-2');
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
          backgroundColor: months.map((m, i) =>
            i === selected ? rc : m.encours ? alpha(rc, 0.35) : alpha(rc, 0.6)
          ),
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
        legend: {
          position: 'bottom',
          labels: { color: text, boxWidth: 14, boxHeight: 8, padding: 12, font: { size: 11 } },
        },
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
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: text, font: { size: 10 }, maxRotation: 0, autoSkip: true },
        },
        y: yAxis(text, { title: 'mm', beginAtZero: true }),
      },
    },
  });
  charts.add(c);
  return c;
}

/** Pluie jour par jour d'un mois (barres) et cumul (courbe). */
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
    {
      label: 'Pluie du jour (mm)',
      data: vals,
      backgroundColor: alpha(rc, 0.85),
      borderRadius: 2,
      yAxisID: 'y',
      order: 2,
    },
    {
      type: 'line',
      label: 'Cumul du mois (mm)',
      data: cumul,
      borderColor: cc,
      backgroundColor: cc,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.2,
      yAxisID: 'y2',
      order: 1,
    },
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
  const c = new window.Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: text, boxWidth: 14, boxHeight: 8, padding: 12, font: { size: 11 } },
        },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            title: (it) => `${it[0].label} ${MOIS[month.mois]} ${month.annee}`,
            label: (it) => (it.parsed.y == null ? null : ` ${it.dataset.label.replace(' (mm)', '')} : ${num(it.parsed.y, 1)} mm`),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: text, font: { size: 10 }, maxRotation: 0, autoSkip: true },
        },
        y: yAxis(rc, { title: 'mm/jour', beginAtZero: true }),
        y2: yAxis(cc, { position: 'right', title: 'cumul (mm)', grid: false, beginAtZero: true }),
      },
    },
  });
  charts.add(c);
  return c;
}

/* ---------- Hauteur & débit ---------- */

export function hydroChart(canvas, obs) {
  const H = obs.H || [];
  const Q = obs.Q || [];
  const all = [...H, ...Q];
  if (!all.length) return null;
  const min = Math.min(...all.map((p) => p[0]));
  const max = Date.now();
  const opts = baseOptions({ min, max });
  opts.plugins.overlay.shadePast = false;
  opts.plugins.overlay.nowLine = false;
  const lc = css('--c-level');
  const qc = css('--c-flow');
  const datasets = [];
  if (H.length) {
    opts.scales.y = yAxis(lc, { title: 'hauteur (m)', digits: 2 });
    datasets.push(line('Hauteur (m)', H.map(([x, y]) => ({ x, y })), lc, { tension: 0.1 }));
  }
  if (Q.length) {
    const id = H.length ? 'y2' : 'y';
    opts.scales[id] = yAxis(qc, {
      position: H.length ? 'right' : 'left',
      title: 'débit (m³/s)',
      grid: !H.length,
      digits: 1,
    });
    datasets.push(
      line('Débit (m³/s)', Q.map(([x, y]) => ({ x, y })), qc, {
        yAxisID: id,
        tension: 0.1,
        borderWidth: 1.5,
        borderDash: H.length ? [5, 3] : [],
      })
    );
  }
  opts.plugins.tooltip.callbacks.label = (it) =>
    ` ${it.dataset.label} : ${num(it.parsed.y, it.dataset.label.startsWith('Hauteur') ? 2 : 2)}`;
  return make(canvas, { type: 'line', data: { datasets }, options: opts });
}
