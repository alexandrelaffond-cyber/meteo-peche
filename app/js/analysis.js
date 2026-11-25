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

export function stormDays(fc, now = Date.now()) {
  const { time, weather_code: wc } = fc.hourly;
  const days = new Map();
  for (let i = 0; i < time.length; i++) {
    if (time[i] < now - HOUR || time[i] > now + 7 * DAY || !isStorm(wc[i])) continue;
    const d = startOfDay(time[i]);
    const e = days.get(d) || { jour: d, debut: time[i], fin: time[i], grele: false };
    e.fin = time[i];
    if (wc[i] !== 95) e.grele = true;
    days.set(d, e);
  }
  return [...days.values()];
}

/* ---------- Alertes pour le tableau de bord ---------- */

export function collectAlerts({ place, fc, hydro = [], vc, mf }, now = Date.now()) {
  const out = [];
  const lieu = place.nom;

  if (fc) {
    for (const e of pressureEvents(fc)) {
      if (e.fin < now || e.debut > now + 7 * DAY) continue;
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
      if (d.time[i] < today || d.time[i] > now + 7 * DAY) continue;
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

    for (const s of stormDays(fc, now)) {
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
