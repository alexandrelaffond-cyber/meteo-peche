// Éléments d'interface partagés par les modes Pêche et Maison.
import * as api from '../api.js';
import * as store from '../store.js';
import * as an from '../analysis.js';
import * as astro from '../astro.js';
import {
  esc, num, signed, day, dayLong, time, ago, startOfDay, windDir, windArrow, trendArrow, wmo, uvLabel, slug,
  VIGI, PHENOMENES,
} from '../ui.js';

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

export function staleNote(results) {
  const stale = results.filter((r) => r && r.stale);
  if (!stale.length) return '';
  const oldest = Math.min(...stale.map((r) => r.t));
  return `<div class="notice">Hors ligne : affichage des dernières données connues (${esc(ago(oldest))}).</div>`;
}

/* ---------- En-tête d'un lieu ---------- */

export function placeHeader(place) {
  const fav = store.isFav(place.code);
  return `<header class="place-head">
    <a class="back" href="#/" aria-label="Retour au tableau de bord">‹</a>
    <div class="place-title">
      <h1>${esc(place.nom)}</h1>
      <span class="muted">${esc(place.cp)} · ${esc(place.depNom)} (${esc(place.dep)})</span>
    </div>
    <button class="star ${fav ? 'on' : ''}" id="star" aria-pressed="${fav}">${fav ? '★ Favori' : '☆ Favori'}</button>
  </header>`;
}

export function bindStar(place) {
  const b = document.getElementById('star');
  if (!b) return;
  b.addEventListener('click', () => {
    const on = store.toggleFav(place);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    b.textContent = on ? '★ Favori' : '☆ Favori';
  });
}

/* ---------- Conditions actuelles ---------- */

export function sectionNow(fc) {
  const h = fc.hourly;
  const i = an.nowIndex(h.time);
  const p = an.pressureNow(fc);
  const [icon, label] = wmo(h.weather_code[i]);
  const today = an.rainSummary(fc).iToday;
  const d = fc.daily;
  return `<section class="card now">
    <div class="now-main">
      <span class="now-icon" aria-hidden="true">${icon}</span>
      <div>
        <div class="now-temp">${num(h.temperature_2m[i], 1)}°C</div>
        <div class="muted">${esc(label)}${today >= 0 ? ` · ${num(d.temperature_2m_min[today], 0)}° / ${num(d.temperature_2m_max[today], 0)}°` : ''}</div>
      </div>
    </div>
    <dl class="now-grid">
      <div><dt>Pression</dt><dd>${num(p.value, 1)} hPa ${trendArrow(p.trend.level)}<small>${esc(p.trend.label)}</small></dd></div>
      <div><dt>Vent</dt><dd>${num(h.wind_speed_10m[i], 0)} km/h ${windArrow(h.wind_direction_10m[i])} ${windDir(h.wind_direction_10m[i])}<small>rafales ${num(h.wind_gusts_10m[i], 0)} km/h</small></dd></div>
      <div><dt>Nuages</dt><dd>${num(h.cloud_cover[i], 0)} %</dd></div>
      <div><dt>UV</dt><dd>${num(h.uv_index[i], 1)}<small>max du jour ${today >= 0 ? num(d.uv_index_max[today], 1) : '–'} (${uvLabel(today >= 0 ? d.uv_index_max[today] : null)})</small></dd></div>
    </dl>
  </section>`;
}

/* ---------- Liste des variations de pression ---------- */

export function evItem(e) {
  return `<li class="ev ${e.sign < 0 ? 'down' : 'up'} ${e.kind}">
    <span class="ev-delta">${signed(e.delta, 1)} hPa</span>
    <span>${esc(e.titre)}<br><span class="muted small">${esc(dayHourShort(e.debut))} → ${esc(dayHourShort(e.fin))}</span></span>
  </li>`;
}

function dayHourShort(t) {
  return `${day(t)} ${time(t).replace(':00', 'h')}`;
}

/* ---------- Alertes d'un lieu ---------- */

export function alertList(alerts, { showPlace = false } = {}) {
  return `<ul class="alert-list">${alerts
    .map(
      (a) => `<li class="alert ${a.niveau}">
        <a href="#/lieu/${esc(a.code)}">
          <span class="a-icon" aria-hidden="true">${esc(a.icone)}</span>
          <span class="a-body"><b>${esc(a.titre)}</b><span class="a-detail">${esc(a.detail)}</span></span>
          ${showPlace ? `<span class="a-place">${esc(a.lieu)}</span>` : ''}
        </a></li>`
    )
    .join('')}</ul>`;
}

/* ---------- Périodes solunaires ---------- */

/** Toutes les périodes (majeures/mineures) d'aujourd'hui et de demain, triées. */
export function solunarPeriods(place, now = Date.now()) {
  const today = startOfDay(now);
  const out = [];
  for (const d0 of [today - DAY, today, today + DAY]) {
    const s = astro.solunar(d0, place.lat, place.lon);
    for (const p of s.majeures) out.push({ ...p, type: 'majeure' });
    for (const p of s.mineures) out.push({ ...p, type: 'mineure' });
  }
  const seen = new Set();
  return out
    .filter((p) => {
      const k = Math.round(p.centre / 600000);
      if (seen.has(k)) return false;
      seen.add(k);
      return p.fin >= now - HOUR && p.debut <= now + 30 * HOUR;
    })
    .sort((a, b) => a.debut - b.debut);
}

export function durationText(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

/** Texte « prochaine période » pour le tableau de bord et le mode Pêche. */
export function nextPeriodText(place, now = Date.now()) {
  const ps = solunarPeriods(place, now);
  const cur = ps.find((p) => p.debut <= now && p.fin >= now);
  if (cur) return { enCours: true, p: cur, texte: `Période ${cur.type} en cours jusqu'à ${time(cur.fin)}` };
  const next = ps.find((p) => p.debut > now);
  if (!next) return null;
  return {
    enCours: false,
    p: next,
    texte: `Période ${next.type} dans ${durationText(next.debut - now)} (${time(next.debut)}–${time(next.fin)})`,
  };
}

/* ---------- Orages & vigilance ---------- */

export function sectionVigilance(place, fc, mf, horizonDays = 7) {
  const storms = an.stormDays(fc, Date.now(), horizonDays * DAY);
  const vm = an.vigiMeteoFor(mf, place.dep);
  const link = `https://vigilance.meteofrance.fr/fr/${slug(place.depNom)}`;
  let official = '';
  if (vm) {
    official = Object.entries(vm)
      .map(([ech, info]) => {
        const v = VIGI[info.niveau] || VIGI[1];
        const ph = (info.phenomenes || []).map((p) => `${PHENOMENES[p.id] || '?'} (${VIGI[p.niveau]?.nom || ''})`).join(', ');
        return `<div class="row"><span class="lbl"><span class="vdot ${v.cls}"></span>${ech === 'J1' ? 'Demain' : "Aujourd'hui"}</span><span class="val">Vigilance ${v.nom}${ph ? ` — ${esc(ph)}` : ''}</span></div>`;
      })
      .join('');
  }
  return `<section class="card">
    <h2>Orages et vigilance</h2>
    ${
      storms.length
        ? `<ul class="ev-list">${storms
            .map(
              (s) => `<li class="ev storm"><span class="ev-delta">⚡</span><span>${s.grele ? 'Orage avec risque de grêle' : 'Orage possible'}<br><span class="muted small">${esc(dayLong(s.jour))}, ${esc(time(s.debut))} – ${esc(time(s.fin + HOUR))}</span></span></li>`
            )
            .join('')}</ul>`
        : `<p class="muted">Pas d’orage prévu sur ${horizonDays} jours.</p>`
    }
    ${official ? `<h3>Vigilance Météo-France (${esc(place.depNom)})</h3>${official}` : ''}
    <p class="small"><a href="${esc(link)}" target="_blank" rel="noopener">Carte de vigilance Météo-France · ${esc(place.depNom)} ↗</a></p>
  </section>`;
}

/* ---------- Échelle des graphiques hydro ---------- */

export const SCALES = [
  ['zero', 'Depuis 0', 'proportions réelles'],
  ['log', 'Log', 'débit en variations relatives'],
  ['zoom', 'Zoom', 'détail fin, variations amplifiées'],
];

export function scaleToggle(current) {
  return `<div class="seg" role="group" aria-label="Échelle du graphique">${SCALES.map(
    ([v, label, hint]) => `<button type="button" data-scale="${v}" aria-pressed="${v === current}" title="${esc(hint)}">${label}</button>`
  ).join('')}</div>`;
}

export function scaleHint(current) {
  const s = SCALES.find((x) => x[0] === current) || SCALES[0];
  return `Échelle « ${s[1]} » : ${s[2]}.`;
}

/* ---------- Stations hydrométriques ---------- */

export async function nearbyAndFollowed(place) {
  let nearby = [];
  let error = false;
  try {
    nearby = await api.getNearbyStations(place.lat, place.lon, 25);
  } catch {
    error = true;
  }
  const followed = store.getStations(place.code);
  const followedCodes = new Set(followed.map((s) => s.code));
  const list = [
    ...followed.map((s) => nearby.find((n) => n.code === s.code) || { ...s, km: null }),
    ...nearby.filter((n) => !followedCodes.has(n.code)),
  ].slice(0, Math.max(12, followed.length));
  return { nearby, followed, followedCodes, list, error };
}

export function stationPicker({ nearby, followedCodes, list, followed }) {
  return `<details class="nearby" ${followed.length ? '' : 'open'}>
    <summary>Choisir les stations (${nearby.length} dans un rayon de 25 km)</summary>
    <ul class="station-list">${list
      .map(
        (s) => `<li><label>
          <input type="checkbox" data-code="${esc(s.code)}" ${followedCodes.has(s.code) ? 'checked' : ''}>
          <span class="st-name">${esc(s.libelle)}</span>
          <span class="st-meta muted small">${esc(s.coursEau)}${s.km != null ? ` · ${num(s.km, 1)} km` : ''}</span>
        </label></li>`
      )
      .join('')}</ul>
  </details>`;
}

export function bindStationPicker(box, place, list, onChange) {
  box.querySelectorAll('.nearby input[type=checkbox]').forEach((cb) =>
    cb.addEventListener('change', () => {
      const s = list.find((x) => x.code === cb.dataset.code);
      if (!s) return;
      store.toggleStation(place.code, { code: s.code, libelle: s.libelle, coursEau: s.coursEau, lat: s.lat, lon: s.lon });
      onChange();
    })
  );
}

export function vigiTag(vc, code) {
  const v = an.vigicruesFor(vc, code);
  if (v) return `<span class="vigi-tag"><span class="vdot ${VIGI[v.niveau]?.cls || ''}"></span>Vigilance crues ${esc(VIGI[v.niveau]?.nom || 'inconnue')} · ${esc(v.nom)}</span>`;
  return vc ? '<span class="vigi-tag muted">Hors réseau de vigilance crues</span>' : '';
}

/** Résumé chiffré du débit par rapport aux 12 derniers mois. */
export function flowContextText(fctx) {
  if (!fctx) return '';
  const pct = fctx.pctMedian != null ? ` · ${num(fctx.pctMedian * 100, 0)} % du débit médian` : '';
  return `<span class="flow-ctx ${fctx.label.replace(' ', '-')}">Débit <b>${esc(fctx.label)}</b> par rapport aux 12 derniers mois${pct}</span>`;
}
