// Mode Maison : historiques détaillés et prévisions à 14 jours pour préparer les sorties.
import * as api from '../api.js';
import * as store from '../store.js';
import * as an from '../analysis.js';
import * as astro from '../astro.js';
import * as charts from '../charts.js';
import { esc, num, signed, day, time, ago, startOfDay, windArrow, trendArrow, wmo } from '../ui.js';
import {
  DAY, staleNote, placeHeader, bindStar, sectionNow, evItem, sectionVigilance, nearbyAndFollowed,
  stationPicker, bindStationPicker, vigiTag, scaleToggle, scaleHint, flowContextText,
} from './common.js';

const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function renderPlaceMaison(view, { place, fcR, vc, mf, isCurrent, force }) {
  const fc = fcR.data;
  const now = Date.now();
  const h = fc.hourly.time;
  const full = { min: h[0], max: h[h.length - 1] };
  const detail = { min: now - 7 * DAY, max: h[h.length - 1] };
  const events = an.pressureEvents(fc);

  view.innerHTML = `
    ${placeHeader(place)}
    <div id="stale">${staleNote([fcR])}</div>
    ${sectionNow(fc)}
    ${sectionPlanner(place, fc)}
    ${sectionPressure(fc, events)}
    <section class="card">
      <h2>Température et vent <span class="muted small">· 7 jours passés, 16 jours prévus</span></h2>
      <div class="chart"><canvas id="c-tempwind" aria-label="Température et vent"></canvas></div>
      <h3>Nuages et UV</h3>
      <div class="chart short"><canvas id="c-clouduv" aria-label="Nuages et UV"></canvas></div>
    </section>
    ${sectionRain(fc)}
    <section class="card" id="rainhist"><h2>Historique des pluies</h2><p class="muted">Chargement de l’historique…</p></section>
    <section class="card" id="hydro"><h2>Cours d’eau</h2><p class="muted">Chargement des stations…</p></section>
    ${sectionSunMoon(place, fc)}
    ${sectionVigilance(place, fc, mf, 14)}
  `;
  bindStar(place);

  charts.pressureChart(document.getElementById('c-pressure'), fc, events, full);
  charts.tempWindChart(document.getElementById('c-tempwind'), fc, detail);
  charts.cloudUvChart(document.getElementById('c-clouduv'), fc, detail);
  charts.rainChart(document.getElementById('c-rain'), fc, { pastDays: 14, futureDays: 14 });

  renderRainHistory(place, fc, isCurrent, force);
  renderHydroMaison(place, vc, isCurrent, force);
}

/* ---------- Planificateur 14 jours ---------- */

function pressureCell(d) {
  if (d.pMoy == null) return '–';
  const lvl = d.dp == null ? 0 : Math.abs(d.dp) < 2 ? 0 : Math.abs(d.dp) < 6 ? Math.sign(d.dp) : 2 * Math.sign(d.dp);
  const brutal = Math.abs(d.max6) >= an.SEUILS.brutale6h;
  const cls = brutal ? (d.max6 < 0 ? 'p-down' : 'p-up') : '';
  return `<span class="${cls}">${num(d.pMoy, 0)} ${trendArrow(lvl)}</span><br><span class="muted small">${d.dp != null ? signed(d.dp, 0) : ''}${brutal ? ` · ${signed(d.max6, 0)} en 6 h` : ''}</span>`;
}

function sectionPlanner(place, fc) {
  const days = an.dayPlan(fc, 14);
  const today = startOfDay(Date.now());
  const rows = days
    .map((d) => {
      const s = astro.solunar(d.t, place.lat, place.lon);
      const [icon, label] = wmo(d.code);
      const maj = s.majeures.map((p) => time(p.centre)).join(' · ');
      return `<tr class="${d.lointain ? 'far' : ''}">
        <th scope="row">${d.t === today ? "Auj." : esc(day(d.t))}</th>
        <td title="${esc(label)}">${icon}${d.orage ? '<span title="Orage possible">⚡</span>' : ''}</td>
        <td><b>${num(d.tmax, 0)}°</b> <span class="muted">${num(d.tmin, 0)}°</span></td>
        <td class="${d.pluie >= an.SEUILS.pluieForte ? 'rain-strong' : d.pluie >= 1 ? 'rain' : 'muted'}">${num(d.pluie, d.pluie < 10 ? 1 : 0)}</td>
        <td>${windArrow(d.dir, 11)} ${num(d.vent, 0)}<span class="muted">/${num(d.rafales, 0)}</span></td>
        <td>${pressureCell(d)}</td>
        <td title="${esc(s.nom)}">${s.emoji}</td>
        <td class="small">${maj || '–'}</td>
      </tr>`;
    })
    .join('');
  return `<section class="card">
    <h2>Planificateur 14 jours</h2>
    <div class="table-wrap"><table class="plan">
      <thead><tr><th>Jour</th><th>Ciel</th><th>Temp.</th><th>Pluie mm</th><th>Vent km/h</th><th>Pression hPa</th><th>Lune</th><th>Périodes majeures</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="small muted">Pression : moyenne du jour, flèche et chiffre = évolution sur la journée ; en couleur si variation brutale (≥ ${an.SEUILS.brutale6h} hPa en 6 h).
    Les lignes grisées (au-delà de 7 jours) sont des tendances moins fiables.</p>
  </section>`;
}

/* ---------- Pression ---------- */

function sectionPressure(fc, events) {
  const p = an.pressureNow(fc);
  const now = Date.now();
  const past = events.filter((e) => e.fin < now);
  const next = events.filter((e) => e.fin >= now);
  return `<section class="card">
    <h2>Pression atmosphérique <span class="muted small">· 14 jours passés, 16 jours prévus</span></h2>
    <div class="stats">
      <div class="stat"><span class="stat-v">${num(p.value, 1)}</span><span class="stat-l">hPa actuels</span></div>
      <div class="stat"><span class="stat-v">${signed(p.d3, 1)} ${trendArrow(p.trend.level)}</span><span class="stat-l">sur 3 h · ${esc(p.trend.label.toLowerCase())}</span></div>
      <div class="stat"><span class="stat-v">${signed(p.d24, 1)}</span><span class="stat-l">sur 24 h</span></div>
    </div>
    <div class="chart tall"><canvas id="c-pressure" aria-label="Courbe de pression"></canvas></div>
    <p class="legend-note small muted"><span class="sw down"></span> chute <span class="sw up"></span> hausse — zones colorées : variation ≥ ${an.SEUILS.brutale6h} hPa en 6 h (foncé) ou ≥ ${an.SEUILS.forte24h} hPa en 24 h (clair).</p>
    <div class="ev-cols">
      <div><h3>À venir</h3>${next.length ? `<ul class="ev-list">${next.map(evItem).join('')}</ul>` : '<p class="muted small">Aucune variation brutale prévue.</p>'}</div>
      <div>${
        past.length
          ? `<details class="past-ev"><summary><h3>14 derniers jours (${past.length})</h3></summary><ul class="ev-list">${past.reverse().map(evItem).join('')}</ul></details>`
          : '<h3>14 derniers jours</h3><p class="muted small">Aucune variation brutale.</p>'
      }</div>
    </div>
  </section>`;
}

/* ---------- Pluie ---------- */

function sectionRain(fc) {
  const r = an.rainSummary(fc);
  return `<section class="card">
    <h2>Pluviométrie <span class="muted small">· 14 jours passés, 14 jours prévus</span></h2>
    <div class="stats">
      <div class="stat"><span class="stat-v">${num(r.passe7j, 1)}</span><span class="stat-l">mm · 7 derniers jours</span></div>
      <div class="stat"><span class="stat-v">${num(r.passe14j, 1)}</span><span class="stat-l">mm · 14 derniers jours</span></div>
      <div class="stat"><span class="stat-v">${num(r.futur7j, 1)}</span><span class="stat-l">mm · 7 prochains jours</span></div>
      <div class="stat"><span class="stat-v">${num(r.futur14j, 1)}</span><span class="stat-l">mm · 14 prochains jours</span></div>
    </div>
    <div class="chart"><canvas id="c-rain" aria-label="Pluie par jour"></canvas></div>
    <p class="small muted">Barres pâles : jours passés · pleines : prévisions · contour seul : au-delà de 7 jours (tendance).</p>
  </section>`;
}

/* ---------- Historique mensuel des pluies ---------- */

function pctNormale(total, normale) {
  if (normale == null || normale <= 0) return '';
  const p = Math.round((total / normale) * 100);
  const cls = p >= 125 ? 'wet' : p <= 75 ? 'dry' : '';
  return `<span class="pct ${cls}">${p} % de la normale</span>`;
}

async function renderRainHistory(place, fc, isCurrent, force) {
  const box = document.getElementById('rainhist');
  let histR;
  let normals = null;
  try {
    [histR, normals] = await Promise.all([
      api.getRainHistory(place.lat, place.lon, { force }),
      api.getRainNormals(place.lat, place.lon).then((r) => r.data).catch(() => null),
    ]);
  } catch {
    if (isCurrent() && box) box.innerHTML = `<h2>Historique des pluies</h2><p class="muted">Historique indisponible (pas de connexion ?).</p>`;
    return;
  }
  if (!isCurrent() || !box) return;

  const months = an.rainMonths(histR.data, fc, normals);
  if (!months.length) {
    box.innerHTML = `<h2>Historique des pluies</h2><p class="muted">Aucune donnée.</p>`;
    return;
  }
  const cur = months[months.length - 1];
  const past12 = months.filter((m) => !m.encours).slice(-12);
  const total12 = past12.reduce((s, m) => s + m.total, 0);
  const norm12 = normals ? past12.reduce((s, m) => s + (m.normale || 0), 0) : null;

  box.innerHTML = `
    <h2>Historique des pluies</h2>
    <div class="stats">
      <div class="stat"><span class="stat-v">${num(cur.total, 0)} mm</span><span class="stat-l">${MOIS_LONG[cur.mois]} (au ${new Date().getDate()}) ${pctNormale(cur.total, cur.normaleADate)}</span></div>
      <div class="stat"><span class="stat-v">${num(total12, 0)} mm</span><span class="stat-l">12 derniers mois complets ${pctNormale(total12, norm12)}</span></div>
      <div class="stat"><span class="stat-v">${cur.joursPluie} j</span><span class="stat-l">de pluie (≥ 1 mm) ce mois-ci</span></div>
    </div>
    <div class="chart"><canvas id="c-rainmonths" aria-label="Pluie par mois sur 12 mois, comparée à la normale"></canvas></div>
    <p class="small muted">Touchez un mois pour voir le détail jour par jour. Normale : moyenne 1991-2020 au même endroit.</p>
    <div class="month-head">
      <h3 id="rh-title"></h3>
      <select id="rh-select" aria-label="Choisir un mois">${months.map((m, i) => `<option value="${i}">${MOIS_LONG[m.mois]} ${m.annee}</option>`).join('')}</select>
    </div>
    <div id="rh-stats" class="month-stats small"></div>
    <div class="chart"><canvas id="c-raindaily" aria-label="Pluie jour par jour du mois choisi"></canvas></div>`;

  let monthsChart = null;
  let dailyChart = null;
  const select = box.querySelector('#rh-select');
  const show = (i) => {
    const m = months[i];
    select.value = String(i);
    box.querySelector('#rh-title').textContent = `${MOIS_LONG[m.mois][0].toUpperCase()}${MOIS_LONG[m.mois].slice(1)} ${m.annee}${m.encours ? ' (en cours)' : ''}`;
    const ref = m.encours ? m.normaleADate : m.normale;
    box.querySelector('#rh-stats').innerHTML = `
      <span><b>${num(m.total, 1)} mm</b> au total</span>
      ${ref != null ? `<span>normale${m.encours ? ' à date' : ''} ${num(ref, 0)} mm ${pctNormale(m.total, ref)}</span>` : ''}
      <span>${m.joursPluie} jour${m.joursPluie > 1 ? 's' : ''} de pluie</span>
      ${m.max && m.max.mm > 0 ? `<span>maximum ${num(m.max.mm, 1)} mm le ${new Date(m.max.t).getDate()}</span>` : ''}
      ${m.complet ? '' : '<span class="muted">(quelques jours manquants)</span>'}`;
    charts.destroy(monthsChart);
    charts.destroy(dailyChart);
    monthsChart = charts.rainMonthsChart(document.getElementById('c-rainmonths'), months, i, show);
    dailyChart = charts.rainDailyChart(document.getElementById('c-raindaily'), m);
  };
  select.addEventListener('change', () => show(Number(select.value)));
  show(months.length - 1);
}

/* ---------- Cours d'eau (7 ou 30 jours + 12 mois de débits) ---------- */

async function renderHydroMaison(place, vc, isCurrent, force) {
  const box = document.getElementById('hydro');
  const st = await nearbyAndFollowed(place);
  if (!isCurrent() || !box) return;
  if (st.error && !st.followed.length) {
    box.innerHTML = `<h2>Cours d’eau</h2><p class="muted">Stations indisponibles (pas de connexion).</p>`;
    return;
  }
  const scale = store.getPref('echelleHydro', 'zero');
  const days = store.getPref('dureeHydro', 7);
  box.innerHTML = `
    <div class="card-head">
      <h2>Cours d’eau</h2>
      ${
        st.followed.length
          ? `<div class="head-tools">
          <div class="seg" role="group" aria-label="Période">${[7, 30]
            .map((n) => `<button type="button" data-days="${n}" aria-pressed="${n === days}">${n} j</button>`)
            .join('')}</div>
          ${scaleToggle(scale)}
        </div>`
          : ''
      }
    </div>
    <div>${
      st.followed.length
        ? st.followed.map((s) => `<div class="station" id="st-${esc(s.code)}"><p class="muted">Chargement ${esc(s.libelle)}…</p></div>`).join('')
        : '<p class="muted">Cochez une ou plusieurs stations ci-dessous pour suivre leur hauteur et leur débit.</p>'
    }</div>
    ${stationPicker(st)}`;
  bindStationPicker(box, place, st.list, () => renderHydroMaison(place, vc, isCurrent, false));

  const redraws = [];
  const redrawAll = () => redraws.forEach((f) => f());
  box.querySelectorAll('.seg button[data-scale]').forEach((b) =>
    b.addEventListener('click', () => {
      store.setPref('echelleHydro', b.dataset.scale);
      box.querySelectorAll('.seg button[data-scale]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      redrawAll();
    })
  );
  box.querySelectorAll('.seg button[data-days]').forEach((b) =>
    b.addEventListener('click', () => {
      store.setPref('dureeHydro', Number(b.dataset.days));
      box.querySelectorAll('.seg button[data-days]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      redrawAll();
    })
  );

  for (const s of st.followed) {
    Promise.all([
      api.getObservations(s.code, { force }),
      api.getDailyFlows(s.code, { force }).then((r) => r.data).catch(() => null),
    ])
      .then(([r, daily]) => {
        if (!isCurrent()) return;
        const f = stationMaison(s, r, daily, vc);
        if (f) redraws.push(f);
      })
      .catch(() => {
        const el = document.getElementById('st-' + s.code);
        if (el && isCurrent()) el.innerHTML = `<h3>${esc(s.libelle)}</h3><p class="muted">Données indisponibles.</p>`;
      });
  }
}

function stationMaison(s, r, daily, vc) {
  const el = document.getElementById('st-' + s.code);
  if (!el) return null;
  const obs = r.data;
  const H = an.seriesDelta(obs.H, 24);
  const Q = an.seriesDelta(obs.Q, 24);
  if (!H && !Q) {
    el.innerHTML = `<h3>${esc(s.libelle)}</h3><p class="muted">Pas de mesure en temps réel récente pour cette station.</p>${vigiTag(vc, s.code)}`;
    return null;
  }
  const lt = an.levelTrend(H?.delta);
  const qt = an.flowTrend(obs.Q);
  const fctx = Q ? an.flowContext(daily, Q.value) : null;
  const idH = 'c-h-' + s.code;
  const idQ = 'c-q-' + s.code;
  el.innerHTML = `
    <div class="station-head">
      <h3>${esc(s.libelle)}</h3>
      <span class="muted small">${esc(s.coursEau)} · mesure ${esc(ago((H || Q).t))}${r.stale ? ' (hors ligne)' : ''}</span>
    </div>
    <div class="stats">
      ${H ? `<div class="stat"><span class="stat-v">${num(H.value, 2)} m ${trendArrow(lt.level)}</span><span class="stat-l">hauteur · ${H.delta != null ? signed(H.delta * 100, 0) + ' cm/24 h' : ''}</span></div>` : ''}
      ${Q ? `<div class="stat"><span class="stat-v">${num(Q.value, Q.value < 10 ? 2 : 1)} m³/s ${trendArrow(qt.level)}</span><span class="stat-l">débit · ${esc(qt.label.toLowerCase())}</span></div>` : ''}
      <div class="stat range-stat"><span class="stat-v"></span><span class="stat-l"></span></div>
    </div>
    ${fctx ? `<p class="small">${flowContextText(fctx)}</p>` : ''}
    <div class="chart"><canvas id="${esc(idH)}" aria-label="Hauteur et débit"></canvas></div>
    ${
      daily && daily.length > 30
        ? `<h3>Débit moyen journalier sur 12 mois</h3>
      <div class="chart short"><canvas id="${esc(idQ)}" aria-label="Débit moyen journalier sur 12 mois"></canvas></div>`
        : ''
    }
    <div class="station-foot">${vigiTag(vc, s.code)}<span class="small muted scale-hint"></span>
      <a class="small" href="https://www.hydro.eaufrance.fr/stationhydro/${esc(s.code)}/fiche" target="_blank" rel="noopener">Fiche station ↗</a></div>`;

  let c1 = null;
  let c2 = null;
  const redraw = () => {
    const scale = store.getPref('echelleHydro', 'zero');
    const days = store.getPref('dureeHydro', 7);
    // Amplitude sur la période affichée, pour relativiser la courbe.
    const rs = el.querySelector('.range-stat');
    const pts = (obs.H || []).filter((p) => p[0] >= Date.now() - days * 86_400_000).map((p) => p[1]);
    if (rs && pts.length) {
      const lo = Math.min(...pts);
      const hi = Math.max(...pts);
      rs.querySelector('.stat-v').textContent = `${num((hi - lo) * 100, 0)} cm`;
      rs.querySelector('.stat-l').textContent = `d’écart sur ${days} j (${num(lo, 2)} – ${num(hi, 2)} m)`;
    } else if (rs) rs.remove();
    charts.destroy(c1);
    charts.destroy(c2);
    c1 = charts.hydroChart(document.getElementById(idH), obs, { scale, days });
    c2 = charts.flowHistoryChart(document.getElementById(idQ), daily, fctx, Q?.value, scale);
    const hint = el.querySelector('.scale-hint');
    if (hint) hint.textContent = scaleHint(scale);
  };
  redraw();
  return redraw;
}

/* ---------- Soleil et lune sur 14 jours ---------- */

function sectionSunMoon(place, fc) {
  const d = fc.daily;
  const today = startOfDay(Date.now());
  const rows = d.time
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t >= today)
    .slice(0, 14)
    .map(({ t, i }) => ({ t, i, s: astro.solunar(t, place.lat, place.lon) }));
  const per = (list) => (list.length ? list.map((p) => `${time(p.debut)}–${time(p.fin)}`).join('<br>') : '–');
  return `<section class="card">
    <h2>Soleil, lune et périodes solunaires <span class="muted small">· 14 jours</span></h2>
    <div class="table-wrap"><table class="sol">
      <thead><tr><th>Jour</th><th>Lune</th><th>Soleil</th><th>Lune ↑ ↓</th><th>Majeures</th><th>Mineures</th></tr></thead>
      <tbody>${rows
        .map(
          ({ t, i, s }) => `<tr>
          <td>${t === today ? 'Auj.' : esc(day(t))}</td>
          <td title="${esc(s.nom)}">${s.emoji} <span class="muted small">${num(s.illumination * 100, 0)} %</span></td>
          <td class="small">${time(d.sunrise[i])}<br>${time(d.sunset[i])}</td>
          <td class="small">${time(s.lune.lever)}<br>${time(s.lune.coucher)}</td>
          <td class="small major">${per(s.majeures)}</td>
          <td class="small minor">${per(s.mineures)}</td>
        </tr>`
        )
        .join('')}</tbody>
    </table></div>
    <p class="small muted">Majeures : lune au plus haut ou au plus bas (±1 h). Mineures : lever et coucher de lune (±30 min).</p>
  </section>`;
}
