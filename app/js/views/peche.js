// Mode Pêche : l'essentiel pour décider vite, maintenant et dans les prochaines heures.
import * as api from '../api.js';
import * as store from '../store.js';
import * as an from '../analysis.js';
import * as astro from '../astro.js';
import * as charts from '../charts.js';
import { esc, num, signed, time, startOfDay, windDir, windArrow, trendArrow, wmo, uvLabel } from '../ui.js';
import {
  DAY, HOUR, staleNote, placeHeader, bindStar, evItem, alertList, solunarPeriods, durationText,
  nearbyAndFollowed, stationPicker, bindStationPicker, vigiTag, scaleToggle, scaleHint, flowContextText,
} from './common.js';

export function renderPlacePeche(view, { place, fcR, vc, mf, isCurrent, force }) {
  const fc = fcR.data;
  const now = Date.now();
  const range = { min: now - 24 * HOUR, max: now + 24 * HOUR };
  const events = an.pressureEvents(fc).filter((e) => e.fin >= range.min && e.debut <= range.max);
  const alerts = an.collectAlerts({ place, fc, mf }, now, 2 * DAY);

  view.innerHTML = `
    ${placeHeader(place)}
    <div id="stale">${staleNote([fcR])}</div>
    ${sectionNowPeche(fc)}
    ${alerts.length ? `<section class="card"><h2>Dans les 48 h</h2>${alertList(alerts)}</section>` : ''}
    ${sectionHours(fc)}
    <section class="card">
      <h2>Pression <span class="muted small">· 24 h passées et 24 h à venir</span></h2>
      <div class="chart"><canvas id="c-pressure" aria-label="Pression sur 24 h passées et 24 h à venir"></canvas></div>
      ${events.length ? `<ul class="ev-list compact">${events.map(evItem).join('')}</ul>` : ''}
    </section>
    <section class="card">
      <h2>Pluie heure par heure</h2>
      <div class="chart short"><canvas id="c-rainh" aria-label="Pluie heure par heure"></canvas></div>
    </section>
    <section class="card" id="hydro"><h2>Cours d’eau</h2><p class="muted">Chargement des stations…</p></section>
    ${sectionSolunarToday(place, fc)}
  `;
  bindStar(place);
  charts.pressureChart(document.getElementById('c-pressure'), fc, events, range);
  charts.rainHourlyChart(document.getElementById('c-rainh'), fc, range);
  renderHydroPeche(place, vc, isCurrent, force);
}

function sectionNowPeche(fc) {
  const h = fc.hourly;
  const i = an.nowIndex(h.time);
  const p = an.pressureNow(fc);
  const r = an.rainSummary(fc);
  const [icon, label] = wmo(h.weather_code[i]);
  return `<section class="card now peche-now">
    <div class="now-main">
      <span class="now-icon" aria-hidden="true">${icon}</span>
      <div>
        <div class="now-temp">${num(h.temperature_2m[i], 1)}°C</div>
        <div class="muted">${esc(label)}</div>
      </div>
    </div>
    <dl class="now-grid">
      <div><dt>Pression</dt><dd>${num(p.value, 1)} hPa ${trendArrow(p.trend.level)}<small>${esc(p.trend.label)} · ${signed(p.d3, 1)} en 3 h</small></dd></div>
      <div><dt>Vent</dt><dd>${num(h.wind_speed_10m[i], 0)} km/h ${windArrow(h.wind_direction_10m[i])} ${windDir(h.wind_direction_10m[i])}<small>rafales ${num(h.wind_gusts_10m[i], 0)} km/h</small></dd></div>
      <div><dt>Pluie</dt><dd>${num(r.prochaines6h, 1)} mm<small>dans les 6 h · ${num(r.passe24h, 1)} mm sur 24 h</small></dd></div>
      <div><dt>Ciel</dt><dd>${num(h.cloud_cover[i], 0)} % nuages<small>UV ${num(h.uv_index[i], 1)} (${uvLabel(h.uv_index[i])})</small></dd></div>
    </dl>
    <p class="pressure-sentence">${esc(an.pressureSentence(fc))}</p>
  </section>`;
}

function sectionHours(fc) {
  const hours = an.nextHours(fc, 18);
  return `<section class="card">
    <h2>Prochaines heures</h2>
    <div class="hours" role="list">${hours
      .map((x) => {
        const [icon, label] = wmo(x.code);
        const midnight = new Date(x.t).getHours() === 0;
        return `<div class="hour ${midnight ? 'midnight' : ''}" role="listitem">
          <div class="h-time">${midnight ? 'minuit' : time(x.t).replace(':00', 'h')}</div>
          <div class="h-icon" title="${esc(label)}">${icon}</div>
          <div class="h-temp">${num(x.temp, 0)}°</div>
          <div class="h-rain ${x.pluie >= 0.1 ? '' : 'dry'}">${x.pluie >= 0.1 ? `${num(x.pluie, 1)} mm` : '–'}</div>
          <div class="h-wind">${windArrow(x.dir, 11)} ${num(x.vent, 0)}<span class="muted">/${num(x.rafales, 0)}</span></div>
          <div class="h-p ${x.dp <= -1 ? 'down' : x.dp >= 1 ? 'up' : ''}">${signed(x.dp, 1)}</div>
        </div>`;
      })
      .join('')}</div>
    <p class="small muted">Vent / rafales en km/h · dernière ligne : variation de pression depuis maintenant (hPa).</p>
  </section>`;
}

function sectionSolunarToday(place, fc) {
  const now = Date.now();
  const periods = solunarPeriods(place, now).filter((p) => p.fin >= now && p.debut <= now + 24 * HOUR);
  const s = astro.solunar(startOfDay(now), place.lat, place.lon);
  const d = fc.daily;
  const i = d.time.findIndex((t) => t === startOfDay(now));
  const j = d.time.findIndex((t) => t === startOfDay(now) + DAY);
  const sunNext = [];
  if (i >= 0) sunNext.push(['Lever', d.sunrise[i]], ['Coucher', d.sunset[i]]);
  if (j >= 0) sunNext.push(['Lever', d.sunrise[j]]);
  const nextSun = sunNext.filter(([, t]) => t > now).slice(0, 2);
  return `<section class="card">
    <h2>Lune, soleil et périodes solunaires</h2>
    <div class="moon-now">
      <span class="moon-emoji" aria-hidden="true">${s.emoji}</span>
      <div><b>${esc(s.nom)}</b><br><span class="muted">éclairée à ${num(s.illumination * 100, 0)} %</span></div>
      <dl class="moon-grid">
        ${nextSun.map(([l, t]) => `<div><dt>${l} du soleil</dt><dd>${time(t)}<small class="muted"> · dans ${durationText(t - now)}</small></dd></div>`).join('')}
      </dl>
    </div>
    ${
      periods.length
        ? `<ul class="periods">${periods
            .map((p) => {
              const enCours = p.debut <= now && p.fin >= now;
              return `<li class="period ${p.type} ${enCours ? 'current' : ''}">
                <span class="p-type">${p.type === 'majeure' ? 'Majeure' : 'Mineure'}</span>
                <span class="p-time">${time(p.debut)} – ${time(p.fin)}${startOfDay(p.debut) > startOfDay(now) ? ' <span class="muted small">demain</span>' : ''}</span>
                <span class="p-when">${enCours ? 'en cours' : `dans ${durationText(p.debut - now)}`}</span>
              </li>`;
            })
            .join('')}</ul>`
        : '<p class="muted">Aucune période dans les 24 h.</p>'
    }
    <p class="small muted">Majeures : lune au plus haut ou au plus bas (±1 h). Mineures : lever et coucher de lune (±30 min).</p>
  </section>`;
}

/* ---------- Cours d'eau (48 h) ---------- */

async function renderHydroPeche(place, vc, isCurrent, force) {
  const box = document.getElementById('hydro');
  const st = await nearbyAndFollowed(place);
  if (!isCurrent() || !box) return;
  if (st.error && !st.followed.length) {
    box.innerHTML = `<h2>Cours d’eau</h2><p class="muted">Stations indisponibles (pas de connexion).</p>`;
    return;
  }
  const scale = store.getPref('echelleHydro', 'zero');
  box.innerHTML = `
    <div class="card-head"><h2>Cours d’eau <span class="muted small">· 48 h</span></h2>${st.followed.length ? scaleToggle(scale) : ''}</div>
    <div>${
      st.followed.length
        ? st.followed.map((s) => `<div class="station" id="st-${esc(s.code)}"><p class="muted">Chargement ${esc(s.libelle)}…</p></div>`).join('')
        : '<p class="muted">Cochez une ou plusieurs stations ci-dessous pour suivre leur hauteur et leur débit.</p>'
    }</div>
    ${stationPicker(st)}`;
  bindStationPicker(box, place, st.list, () => renderHydroPeche(place, vc, isCurrent, false));

  const drawn = [];
  const draw = () => {
    drawn.forEach((f) => f());
  };
  box.querySelectorAll('.seg button').forEach((b) =>
    b.addEventListener('click', () => {
      store.setPref('echelleHydro', b.dataset.scale);
      box.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      draw();
    })
  );

  for (const s of st.followed) {
    Promise.all([
      api.getObservations(s.code, { force }),
      api.getDailyFlows(s.code).then((r) => r.data).catch(() => null),
    ])
      .then(([r, daily]) => {
        if (!isCurrent()) return;
        const redraw = stationPeche(s, r, daily, vc);
        if (redraw) drawn.push(redraw);
      })
      .catch(() => {
        const el = document.getElementById('st-' + s.code);
        if (el && isCurrent()) el.innerHTML = `<h3>${esc(s.libelle)}</h3><p class="muted">Données indisponibles.</p>`;
      });
  }
}

function stationPeche(s, r, daily, vc) {
  const el = document.getElementById('st-' + s.code);
  if (!el) return null;
  const obs = r.data;
  const H = an.seriesDelta(obs.H, 24);
  const H3 = an.seriesDelta(obs.H, 3);
  const Q = an.seriesDelta(obs.Q, 24);
  const lt = an.levelTrend(H?.delta);
  const qt = an.flowTrend(obs.Q);
  const fctx = Q ? an.flowContext(daily, Q.value) : null;
  if (!H && !Q) {
    el.innerHTML = `<h3>${esc(s.libelle)}</h3><p class="muted">Pas de mesure en temps réel récente pour cette station.</p>${vigiTag(vc, s.code)}`;
    return null;
  }
  const id = 'c-h-' + s.code;
  el.innerHTML = `
    <div class="station-head">
      <h3>${esc(s.libelle)}</h3>
      <span class="muted small">mesure ${esc(new Date((H || Q).t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))}${r.stale ? ' (hors ligne)' : ''}</span>
    </div>
    <div class="stats">
      ${H ? `<div class="stat"><span class="stat-v">${num(H.value, 2)} m ${trendArrow(lt.level)}</span><span class="stat-l">${esc(lt.label)}</span></div>
      <div class="stat"><span class="stat-v">${H3?.delta != null ? signed(H3.delta * 100, 0) : '–'} <small>cm</small></span><span class="stat-l">sur 3 h · ${H.delta != null ? signed(H.delta * 100, 0) + ' cm sur 24 h' : ''}</span></div>` : ''}
      ${Q ? `<div class="stat"><span class="stat-v">${num(Q.value, Q.value < 10 ? 2 : 1)} m³/s ${trendArrow(qt.level)}</span><span class="stat-l">débit · ${esc(qt.label.toLowerCase())}</span></div>` : ''}
    </div>
    ${fctx ? `<p class="small">${flowContextText(fctx)}</p>` : ''}
    <div class="chart short"><canvas id="${esc(id)}" aria-label="Hauteur et débit sur 48 h"></canvas></div>
    <div class="station-foot">${vigiTag(vc, s.code)}<span class="small muted scale-hint"></span></div>`;
  let chart = null;
  const redraw = () => {
    const scale = store.getPref('echelleHydro', 'zero');
    charts.destroy(chart);
    chart = charts.hydroChart(document.getElementById(id), obs, { scale, days: 2, compact: true });
    const hint = el.querySelector('.scale-hint');
    if (hint) hint.textContent = scaleHint(scale);
  };
  redraw();
  return redraw;
}
