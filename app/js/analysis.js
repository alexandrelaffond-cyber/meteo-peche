// Analyse des données : tendances de pression, variations brutales, cumuls de pluie, niveaux d'eau, alertes.
import { startOfDay, isStorm, dayHour, day, num, signed, PHENOMENES, VIGI } from './ui.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/* Seuils de pression (hPa) — ajustables ici. */
export const SEUILS = {
  brutale6h: 4, // variation sur 6 h considérée comme brutale
  forte24h: 10, // variation sur 24 h considérée comme forte
  pluieInfo: 5, // mm/jour : signalé
  pluieForte: 15, // mm/jour : mis en avant
  montee24h: 0.2, // m : montée des eaux signalée sur le tableau de bord
};

export function nowIndex(times, now = Date.now()) {
  let i = 0;
  while (i + 1 < times.length && times[i + 1] <= now) i++;
  return i;
}

function valueAgo(times, values, i, hours) {
  const j = i - hours;
  if (j < 0 || values[i] == null || values[j] == null) return null;
  return values[i] - values[j];
}

/* ---------- Pression ---------- */

export function pressureTrend(delta3h) {
  if (delta3h == null) return { level: 0, label: '–' };
  const a = Math.abs(delta3h);
  const s = delta3h < 0 ? -1 : 1;
  if (a < 0.5) return { level: 0, label: 'Stable' };
  if (a < 1.6) return { level: s, label: s < 0 ? 'Baisse lente' : 'Hausse lente' };
  if (a < 3.6) return { level: 2 * s, label: s < 0 ? 'Baisse' : 'Hausse' };
  return { level: 3 * s, label: s < 0 ? 'Baisse rapide' : 'Hausse rapide' };
}

export function pressureNow(fc) {
  const { time, pressure_msl: p } = fc.hourly;
  const i = nowIndex(time);
  const d3 = valueAgo(time, p, i, 3);
  return {
    value: p[i],
    d3,
    d24: valueAgo(time, p, i, 24),
    trend: pressureTrend(d3),
  };
}

/** Repère les variations brutales de pression (passées et prévues). */
export function pressureEvents(fc) {
  const { time: t, pressure_msl: p } = fc.hourly;
  const found = [];

  const scan = (win, thr, kind) => {
    let cur = null;
    const close = () => {
      if (!cur) return;
      let { i0, i1, sign } = cur;
      // Resserre l'épisode autour de la vraie variation.
      while (i0 + 1 < i1 && (sign < 0 ? p[i0 + 1] >= p[i0] : p[i0 + 1] <= p[i0])) i0++;
      while (i1 - 1 > i0 && (sign < 0 ? p[i1 - 1] <= p[i1] : p[i1 - 1] >= p[i1])) i1--;
      found.push({ kind, sign, debut: t[i0], fin: t[i1], delta: p[i1] - p[i0] });
      cur = null;
    };
    for (let i = win; i < p.length; i++) {
      if (p[i] == null || p[i - win] == null) {
        close();
        continue;
      }
      const d = p[i] - p[i - win];
      const sign = d <= -thr ? -1 : d >= thr ? 1 : 0;
      if (sign && cur && cur.sign === sign) cur.i1 = i;
      else {
        close();
        if (sign) cur = { sign, i0: i - win, i1: i };
      }
    }
    close();
  };

  scan(6, SEUILS.brutale6h, 'brutale');
  const brutales = found.slice();
  scan(24, SEUILS.forte24h, 'forte');

  const events = found.filter(
    (e) =>
      e.kind === 'brutale' ||
      !brutales.some((b) => b.sign === e.sign && b.debut <= e.fin && b.fin >= e.debut)
  );
  for (const e of events) {
    e.titre =
      e.kind === 'brutale'
        ? e.sign < 0
          ? 'Chute brutale de pression'
          : 'Hausse brutale de pression'
        : e.sign < 0
          ? 'Forte baisse de pression'
          : 'Forte hausse de pression';
  }
  return events.sort((a, b) => a.debut - b.debut);
}

/* ---------- Pluie ---------- */

function sumHourly(fc, from, to) {
  const { time, precipitation: pr } = fc.hourly;
  let s = 0;
  for (let i = 0; i < time.length; i++) if (time[i] >= from && time[i] < to) s += pr[i] || 0;
  return s;
}

export function rainSummary(fc, now = Date.now()) {
  const d = fc.daily;
  const today = startOfDay(now);
  const iToday = d.time.findIndex((x) => x >= today);
  return {
    passe7j: sumHourly(fc, now - 7 * DAY, now),
    passe14j: sumHourly(fc, now - 14 * DAY, now),
    derniereHeure: sumHourly(fc, now - HOUR, now),
    prochaines6h: sumHourly(fc, now, now + 6 * HOUR),
    prochaines24h: sumHourly(fc, now, now + DAY),
    futur14j: sumHourly(fc, now, now + 14 * DAY),
    passe24h: sumHourly(fc, now - DAY, now),
    prochaines48h: sumHourly(fc, now, now + 2 * DAY),
    futur7j: sumHourly(fc, now, now + 7 * DAY),
    iToday,
  };
}

/* ---------- Historique mensuel de pluie ---------- */

/**
 * Regroupe l'historique journalier par mois (12 mois passés + mois en cours).
 * Les jours manquants dans les archives sont complétés par les données récentes
 * du modèle ; aujourd'hui = pluie tombée depuis minuit.
 */
export function rainMonths(hist, fc, normals, now = Date.now()) {
  const [y, m, d] = hist.debut.split('-').map(Number);
  const fcDaily = new Map(fc ? fc.daily.time.map((t, i) => [t, fc.daily.precipitation_sum[i]]) : []);
  const days = hist.jours.map((mm, i) => {
    const t = new Date(y, m - 1, d + i).getTime();
    return { t, mm: mm ?? fcDaily.get(t) ?? null };
  });
  const today = startOfDay(now);
  const nextDay = (t) => {
    const dt = new Date(t);
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1).getTime();
  };
  // Jours entre la fin des archives et aujourd'hui (si les archives ont du retard).
  const last = days.length ? days[days.length - 1].t : today - DAY;
  for (let t = nextDay(last); t < today; t = nextDay(t)) days.push({ t, mm: fcDaily.get(t) ?? null });
  if (fc) days.push({ t: today, mm: sumHourly(fc, today, now), partiel: true });

  const byKey = new Map();
  for (const day of days) {
    const dt = new Date(day.t);
    const key = dt.getFullYear() * 12 + dt.getMonth();
    if (!byKey.has(key)) {
      byKey.set(key, {
        annee: dt.getFullYear(),
        mois: dt.getMonth(),
        debut: new Date(dt.getFullYear(), dt.getMonth(), 1).getTime(),
        nbJours: new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate(),
        jours: [],
      });
    }
    byKey.get(key).jours.push(day);
  }

  const curKey = new Date(now).getFullYear() * 12 + new Date(now).getMonth();
  return [...byKey.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, mo]) => {
      const vals = mo.jours.filter((j) => j.mm != null);
      const total = vals.reduce((s, j) => s + j.mm, 0);
      const max = vals.reduce((a, j) => (j.mm > (a?.mm ?? -1) ? j : a), null);
      const normale = normals ? normals[mo.mois] : null;
      const encours = key === curKey;
      const joursEcoules = encours ? new Date(now).getDate() : mo.nbJours;
      return {
        ...mo,
        encours,
        total,
        joursPluie: vals.filter((j) => j.mm >= 1).length,
        max,
        normale,
        normaleADate: normale != null ? (normale * joursEcoules) / mo.nbJours : null,
        complet: vals.length >= (encours ? joursEcoules : mo.nbJours) - 1,
      };
    });
}

/* ---------- Niveaux d'eau ---------- */

export function seriesDelta(serie, hours = 24) {
  if (!serie || !serie.length) return null;
  const last = serie[serie.length - 1];
  const target = last[0] - hours * HOUR;
  let ref = null;
  for (const pt of serie) {
    if (pt[0] <= target) ref = pt;
    else break;
  }
  return {
    t: last[0],
    value: last[1],
    delta: ref ? last[1] - ref[1] : null,
    min: Math.min(...serie.map((p) => p[1])),
    max: Math.max(...serie.map((p) => p[1])),
  };
}

export function levelTrend(deltaM) {
  if (deltaM == null) return { level: 0, label: '–' };
  const a = Math.abs(deltaM);
  const s = deltaM < 0 ? -1 : 1;
  if (a < 0.03) return { level: 0, label: 'Stable' };
  if (a < 0.15) return { level: s, label: s < 0 ? 'Décrue lente' : 'Montée lente' };
  if (a < 0.4) return { level: 2 * s, label: s < 0 ? 'Décrue' : 'Montée' };
  return { level: 3 * s, label: s < 0 ? 'Décrue rapide' : 'Montée rapide' };
}

export function flowTrend(serie) {
  const d = seriesDelta(serie);
  if (!d || d.delta == null || !d.value) return { level: 0, label: '–' };
  const rel = d.delta / Math.max(d.value - d.delta, 0.01);
  const s = rel < 0 ? -1 : 1;
  const a = Math.abs(rel);
  if (a < 0.05) return { level: 0, label: 'Stable' };
  if (a < 0.25) return { level: s, label: s < 0 ? 'En baisse' : 'En hausse' };
  if (a < 0.6) return { level: 2 * s, label: s < 0 ? 'Forte baisse' : 'Forte hausse' };
  return { level: 3 * s, label: s < 0 ? 'Très forte baisse' : 'Très forte hausse' };
}

export function vigicruesFor(vc, stationCode) {
  if (!vc || !vc.stations) return null;
  const tr = vc.stations[stationCode];
  if (!tr || !vc.troncons?.[tr]) return null;
  return { code: tr, ...vc.troncons[tr] };
}

export function vigiMeteoFor(mf, dep) {
  if (!mf || !mf.deps || !dep) return null;
  return mf.deps[dep] || null;
}

/* ---------- Orages ---------- */

export function stormDays(fc, now = Date.now(), horizon = 7 * DAY) {
  const { time, weather_code: wc } = fc.hourly;
  const days = new Map();
  for (let i = 0; i < time.length; i++) {
    if (time[i] < now - HOUR || time[i] > now + horizon || !isStorm(wc[i])) continue;
    const d = startOfDay(time[i]);
    const e = days.get(d) || { jour: d, debut: time[i], fin: time[i], grele: false };
    e.fin = time[i];
    if (wc[i] !== 95) e.grele = true;
    days.set(d, e);
  }
  return [...days.values()];
}

/* ---------- Alertes pour le tableau de bord ---------- */

export function collectAlerts({ place, fc, hydro = [], vc, mf }, now = Date.now(), horizon = 7 * DAY) {
  const out = [];
  const lieu = place.nom;

  if (fc) {
    for (const e of pressureEvents(fc)) {
      if (e.fin < now || e.debut > now + horizon) continue;
      out.push({
        t: Math.max(e.debut, now),
        niveau: e.kind === 'brutale' ? 'fort' : 'moyen',
        icone: e.sign < 0 ? '↘' : '↗',
        titre: e.titre,
        detail: `${signed(e.delta)} hPa · ${e.debut <= now ? 'en cours' : dayHour(e.debut)} → ${dayHour(e.fin)}`,
        lieu,
        code: place.code,
      });
    }

    const d = fc.daily;
    const today = startOfDay(now);
    for (let i = 0; i < d.time.length; i++) {
      if (d.time[i] < today || d.time[i] > now + horizon) continue;
      const mm = d.precipitation_sum[i];
      if (mm == null || mm < SEUILS.pluieInfo) continue;
      out.push({
        t: Math.max(d.time[i], now),
        niveau: mm >= SEUILS.pluieForte ? 'moyen' : 'info',
        icone: '🌧',
        titre: `Pluie ${num(mm, 0)} mm`,
        detail: d.time[i] === today ? "aujourd'hui" : day(d.time[i]),
        lieu,
        code: place.code,
      });
    }

    for (const s of stormDays(fc, now, horizon)) {
      out.push({
        t: Math.max(s.debut, now),
        niveau: 'moyen',
        icone: '⚡',
        titre: s.grele ? 'Orage (risque de grêle)' : 'Orage possible',
        detail: `${day(s.jour)} vers ${dayHour(s.debut).split(' ').pop()}`,
        lieu,
        code: place.code,
      });
    }
  }

  for (const { station, obs } of hydro) {
    if (!obs) continue;
    const h = seriesDelta(obs.H);
    if (h && h.delta != null && Math.abs(h.delta) >= SEUILS.montee24h) {
      out.push({
        t: now,
        niveau: h.delta > 0 ? 'moyen' : 'info',
        icone: h.delta > 0 ? '🌊' : '↘',
        titre: h.delta > 0 ? 'Montée des eaux' : 'Décrue marquée',
        detail: `${station.libelle} : ${signed(h.delta * 100, 0)} cm en 24 h`,
        lieu,
        code: place.code,
      });
    }
    const v = vigicruesFor(vc, station.code);
    if (v && v.niveau >= 2) {
      out.push({
        t: now,
        niveau: v.niveau >= 3 ? 'fort' : 'moyen',
        icone: '⚠',
        titre: `Vigilance crues ${VIGI[v.niveau].nom}`,
        detail: v.nom,
        lieu,
        code: place.code,
      });
    }
  }

  const vm = vigiMeteoFor(mf, place.dep);
  if (vm) {
    for (const [ech, info] of Object.entries(vm)) {
      if (!info || info.niveau < 2) continue;
      out.push({
        t: ech === 'J1' ? startOfDay(now) + DAY : now,
        niveau: info.niveau >= 3 ? 'fort' : 'moyen',
        icone: '⚠',
        titre: `Vigilance météo ${VIGI[info.niveau]?.nom || ''}`,
        detail:
          (info.phenomenes || []).map((p) => PHENOMENES[p.id] || 'Phénomène').join(', ') +
          (ech === 'J1' ? ' · demain' : " · aujourd'hui"),
        lieu,
        code: place.code,
      });
    }
  }

  return out;
}

/* ---------- Mode Pêche : court terme ---------- */

/** Variation de pression prévue d'ici `hours` heures. */
export function pressureAhead(fc, hours, now = Date.now()) {
  const { time, pressure_msl: p } = fc.hourly;
  const i = nowIndex(time, now);
  const j = i + hours;
  if (j >= p.length || p[i] == null || p[j] == null) return null;
  return p[j] - p[i];
}

/** Heures à venir : [{ t, temp, pluie, vent, rafales, dir, code, pression, dp, nuages }]. */
export function nextHours(fc, n = 18, now = Date.now()) {
  const h = fc.hourly;
  const i0 = nowIndex(h.time, now);
  const out = [];
  for (let i = i0 + 1; i <= i0 + n && i < h.time.length; i++) {
    out.push({
      t: h.time[i],
      temp: h.temperature_2m[i],
      pluie: h.precipitation[i],
      vent: h.wind_speed_10m[i],
      rafales: h.wind_gusts_10m[i],
      dir: h.wind_direction_10m[i],
      code: h.weather_code[i],
      pression: h.pressure_msl[i],
      dp: h.pressure_msl[i] - h.pressure_msl[i0],
      nuages: h.cloud_cover[i],
    });
  }
  return out;
}

/** Phrase de synthèse sur la pression pour le mode Pêche. */
export function pressureSentence(fc, now = Date.now()) {
  const p = pressureNow(fc);
  const a6 = pressureAhead(fc, 6, now);
  const a12 = pressureAhead(fc, 12, now);
  const fmt = (v) => (v == null ? '–' : `${signed(v, 1)} hPa`);
  const futur = a6 == null ? '' : ` Prévu : ${fmt(a6)} d'ici 6 h, ${fmt(a12)} d'ici 12 h.`;
  return `${p.trend.label} sur les 3 dernières heures (${fmt(p.d3)}).${futur}`;
}

/* ---------- Débits : contexte sur 12 mois ---------- */

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Situe un débit actuel par rapport aux débits journaliers des 12 derniers mois. */
export function flowContext(daily, current) {
  const vals = (daily || []).map((p) => p[1]).filter((v) => v != null).sort((a, b) => a - b);
  if (vals.length < 60 || current == null) return null;
  const median = quantile(vals, 0.5);
  const below = vals.filter((v) => v <= current).length;
  const rang = below / vals.length;
  let label;
  if (rang < 0.1) label = 'très bas';
  else if (rang < 0.3) label = 'bas';
  else if (rang <= 0.7) label = 'normal';
  else if (rang <= 0.9) label = 'haut';
  else label = 'très haut';
  return {
    median,
    p10: quantile(vals, 0.1),
    p90: quantile(vals, 0.9),
    min: vals[0],
    max: vals[vals.length - 1],
    pctMedian: median > 0 ? current / median : null,
    rang,
    label,
  };
}

/* ---------- Mode Maison : planificateur ---------- */

/** Une ligne par jour à venir : météo du jour, tendance de pression, pluie, vent. */
export function dayPlan(fc, days = 14, now = Date.now()) {
  const d = fc.daily;
  const h = fc.hourly;
  const today = startOfDay(now);
  const out = [];
  for (let i = 0; i < d.time.length && out.length < days; i++) {
    const t = d.time[i];
    if (t < today) continue;
    const idx = [];
    for (let k = 0; k < h.time.length; k++) if (h.time[k] >= t && h.time[k] < t + DAY) idx.push(k);
    const ps = idx.map((k) => h.pressure_msl[k]).filter((v) => v != null);
    const dp = ps.length > 1 ? ps[ps.length - 1] - ps[0] : null;
    // Plus forte variation sur 6 h dans la journée.
    let max6 = 0;
    for (const k of idx) {
      if (k >= 6 && h.pressure_msl[k] != null && h.pressure_msl[k - 6] != null) {
        const v = h.pressure_msl[k] - h.pressure_msl[k - 6];
        if (Math.abs(v) > Math.abs(max6)) max6 = v;
      }
    }
    out.push({
      t,
      i,
      code: d.weather_code[i],
      tmin: d.temperature_2m_min[i],
      tmax: d.temperature_2m_max[i],
      pluie: d.precipitation_sum[i],
      vent: d.wind_speed_10m_max[i],
      rafales: d.wind_gusts_10m_max[i],
      dir: d.wind_direction_10m_dominant[i],
      nuages: d.cloud_cover_mean[i],
      pMoy: ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null,
      dp,
      max6,
      orage: idx.some((k) => isStorm(h.weather_code[k])),
      lointain: t - today >= 8 * DAY,
    });
  }
  return out;
}
