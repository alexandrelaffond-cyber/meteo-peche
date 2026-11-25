import * as api from './api.js';
import * as store from './store.js';
import * as an from './analysis.js';
import * as astro from './astro.js';
import * as charts from './charts.js';
import {
  esc, num, signed, day, dayLong, time, dayHour, ago, startOfDay, windDir, windArrow,
  trendArrow, wmo, uvLabel, sparkline, slug, VIGI, PHENOMENES,
} from './ui.js';

const DAY = 86_400_000;
const view = document.getElementById('view');
let renderToken = 0;
let forceNext = false;

/* ======================= Routeur ======================= */

function route() {
  const h = location.hash || '#/';
  const m = /^#\/lieu\/(\w+)/.exec(h);
  charts.destroyAll();
  const token = ++renderToken;
  const force = forceNext;
  forceNext = false;
  window.scrollTo(0, 0);
  if (m) renderPlace(m[1], token, force);
  else renderDashboard(token, force);
}

window.addEventListener('hashchange', route);

document.getElementById('refresh').addEventListener('click', () => {
  forceNext = true;
  route();
});

// Rafraîchit en revenant sur l'app si les données ont plus de 30 min.
let hiddenAt = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (Date.now() - hiddenAt > 30 * 60_000) route();
});

// Change de thème clair/sombre → on redessine les graphiques.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', route);

const isCurrent = (token) => token === renderToken;

function staleNote(results) {
  const stale = results.filter((r) => r && r.stale);
  if (!stale.length) return '';
  const oldest = Math.min(...stale.map((r) => r.t));
  return `<div class="notice">Hors ligne : affichage des dernières données connues (${esc(ago(oldest))}).</div>`;
}

/* ======================= Recherche ======================= */

const searchInput = document.getElementById('search');
const searchResults = document.getElementById('search-results');
let searchTimer = null;
let searchSeq = 0;
let currentResults = [];

function closeSearch() {
  searchResults.hidden = true;
  searchResults.innerHTML = '';
  currentResults = [];
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value;
  if (q.trim().length < 2) return closeSearch();
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const res = await api.searchCommunes(q);
      if (seq !== searchSeq) return;
      currentResults = res;
      searchResults.innerHTML = res.length
        ? res
            .map(
              (p, i) => `<li><a href="#/lieu/${esc(p.code)}" data-i="${i}">
                <span class="r-name">${esc(p.nom)}</span>
                <span class="r-meta">${esc(p.cp)} · ${esc(p.depNom)}</span>
                ${store.isFav(p.code) ? '<span class="r-star" title="Favori">★</span>' : ''}
              </a></li>`
            )
            .join('')
        : '<li class="r-empty">Aucune commune trouvée</li>';
      searchResults.hidden = false;
    } catch {
      if (seq !== searchSeq) return;
      searchResults.innerHTML = '<li class="r-empty">Recherche indisponible (hors ligne ?)</li>';
      searchResults.hidden = false;
    }
  }, 220);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && currentResults[0]) {
    location.hash = '#/lieu/' + currentResults[0].code;
    searchInput.value = '';
    searchInput.blur();
    closeSearch();
  } else if (e.key === 'Escape') {
    searchInput.value = '';
    closeSearch();
  }
});

searchResults.addEventListener('click', (e) => {
  if (e.target.closest('a')) {
    searchInput.value = '';
    closeSearch();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) closeSearch();
});

/* ======================= Tableau de bord ======================= */

async function renderDashboard(token, force) {
  const favs = store.getFavs();
  document.title = 'Météo Pêche';
  if (!favs.length) {
    view.innerHTML = `
      <section class="empty">
        <div class="empty-icon" aria-hidden="true">🎣</div>
        <h1>Aucun lieu favori</h1>
        <p>Cherchez une commune ci-dessus, ouvrez-la puis touchez <b>☆ Favori</b> pour la retrouver ici avec ses alertes.</p>
      </section>`;
    return;
  }

  view.innerHTML = `
    <section class="card alerts" id="alerts">
      <h2>À venir</h2>
      <p class="muted">Chargement…</p>
    </section>
    <div id="stale"></div>
    <div class="fav-grid">
      ${favs
        .map(
          (f) => `<article class="card fav" id="fav-${esc(f.code)}">
            <a class="fav-link" href="#/lieu/${esc(f.code)}">
              <header><h3>${esc(f.nom)}</h3><span class="muted">${esc(f.depNom)}</span></header>
              <div class="skeleton"></div><div class="skeleton short"></div>
            </a>
          </article>`
        )
        .join('')}
    </div>`;

  const vcP = api.getVigicrues({ force });
  const mfP = api.getVigilanceMeteo({ force });

  const all = await Promise.all(
    favs.map(async (place) => {
      try {
        const [fcR, vcR, mfR] = await Promise.all([api.getForecast(place.lat, place.lon, { force }), vcP, mfP]);
        const stations = store.getStations(place.code);
        const hydro = await Promise.all(
          stations.map((station) =>
            api
              .getObservations(station.code, { force })
              .then((r) => ({ station, obs: r.data, r }))
              .catch(() => ({ station, obs: null }))
          )
        );
        if (!isCurrent(token)) return null;
        const ctx = { place, fc: fcR.data, hydro, vc: vcR.data, mf: mfR.data };
        renderFavCard(ctx);
        return { ctx, results: [fcR, ...hydro.map((h) => h.r)] };
      } catch {
        if (!isCurrent(token)) return null;
        const el = document.getElementById('fav-' + place.code);
        if (el)
          el.querySelector('.fav-link').innerHTML = `<header><h3>${esc(place.nom)}</h3></header>
            <p class="muted">Données indisponibles (pas de connexion).</p>`;
        return null;
      }
    })
  );
  if (!isCurrent(token)) return;

  const ok = all.filter(Boolean);
  document.getElementById('stale').innerHTML = staleNote(ok.flatMap((x) => x.results));

  const alerts = ok
    .flatMap((x) => an.collectAlerts(x.ctx))
    .sort((a, b) => a.t - b.t || (a.niveau === 'fort' ? -1 : 1));
  const box = document.getElementById('alerts');
  box.innerHTML = `<h2>À venir <span class="muted small">· 7 prochains jours</span></h2>${
    alerts.length
      ? `<ul class="alert-list">${alerts
          .slice(0, 14)
          .map(
            (a) => `<li class="alert ${a.niveau}">
              <a href="#/lieu/${esc(a.code)}">
                <span class="a-icon" aria-hidden="true">${esc(a.icone)}</span>
                <span class="a-body"><b>${esc(a.titre)}</b><span class="a-detail">${esc(a.detail)}</span></span>
                <span class="a-place">${esc(a.lieu)}</span>
              </a></li>`
          )
          .join('')}</ul>${alerts.length > 14 ? `<p class="muted small">+ ${alerts.length - 14} autres</p>` : ''}`
      : '<p class="muted">Rien de particulier : pas de variation brutale de pression, de forte pluie ni d’orage prévus.</p>'
  }`;
}

function renderFavCard({ place, fc, hydro, vc }) {
  const el = document.getElementById('fav-' + place.code);
  if (!el) return;
  const h = fc.hourly;
  const i = an.nowIndex(h.time);
  const p = an.pressureNow(fc);
  const rain = an.rainSummary(fc);
  const today = rain.iToday;
  const d = fc.daily;
  const [icon, label] = wmo(h.weather_code[i]);
  const now = Date.now();
  const sparkPts = h.time
    .map((t, k) => [t, h.pressure_msl[k]])
    .filter(([t]) => t >= now - 3 * DAY && t <= now + 4 * DAY);
  const upcoming = an.pressureEvents(fc).filter((e) => e.fin >= now && e.debut <= now + 7 * DAY);

  const hydroRows = hydro
    .map(({ station, obs }) => {
      if (!obs || (!obs.H.length && !obs.Q.length))
        return `<div class="row"><span class="lbl">${esc(station.libelle)}</span><span class="muted small">pas de données</span></div>`;
      const H = an.seriesDelta(obs.H);
      const Q = an.seriesDelta(obs.Q);
      const lt = an.levelTrend(H?.delta);
      const v = an.vigicruesFor(vc, station.code);
      return `<div class="row">
        <span class="lbl">${v ? `<span class="vdot ${VIGI[v.niveau]?.cls || ''}" title="Vigilance crues ${esc(VIGI[v.niveau]?.nom || '')}"></span>` : ''}${esc(station.libelle)}</span>
        <span class="val">${H ? `${num(H.value, 2)} m ${trendArrow(lt.level)}<span class="small muted">${H.delta != null ? signed(H.delta * 100, 0) + ' cm/24 h' : ''}</span>` : ''}${Q ? ` <span class="small muted">· ${num(Q.value, Q.value < 10 ? 2 : 1)} m³/s</span>` : ''}</span>
      </div>`;
    })
    .join('');

  el.querySelector('.fav-link').innerHTML = `
    <header>
      <h3>${esc(place.nom)}</h3><span class="muted">${esc(place.depNom)}</span>
    </header>
    <div class="fav-now">
      <span class="big-icon" aria-hidden="true">${icon}</span>
      <span class="big-temp">${num(h.temperature_2m[i], 0)}°</span>
      <span class="fav-now-text">${esc(label)}<br><span class="muted small">${
        today >= 0 ? `${num(d.temperature_2m_min[today], 0)}° / ${num(d.temperature_2m_max[today], 0)}°` : ''
      } · vent ${num(h.wind_speed_10m[i], 0)} km/h ${windDir(h.wind_direction_10m[i])}</span></span>
    </div>
    <div class="row pressure-row">
      <span class="lbl">Pression</span>
      <span class="val"><b>${num(p.value, 0)}</b> hPa ${trendArrow(p.trend.level)}<span class="small muted">${esc(p.trend.label)} · ${signed(p.d24, 0)} hPa/24 h</span></span>
    </div>
    ${sparkline(sparkPts, { width: 300, height: 36, nowX: now, cls: 'spark-pressure' })}
    <div class="row">
      <span class="lbl">Pluie</span>
      <span class="val"><span class="small muted">7 j passés</span> <b>${num(rain.passe7j, 0)}</b> mm · <span class="small muted">48 h à venir</span> <b>${num(rain.prochaines48h, 0)}</b> mm</span>
    </div>
    ${hydroRows || '<div class="row"><span class="lbl">Cours d’eau</span><span class="small muted">aucune station suivie</span></div>'}
    ${
      upcoming.length
        ? `<div class="chips">${upcoming
            .slice(0, 3)
            .map(
              (e) =>
                `<span class="chip ${e.sign < 0 ? 'down' : 'up'}">${e.sign < 0 ? '↘' : '↗'} ${signed(e.delta, 0)} hPa · ${esc(
                  e.debut <= now ? 'en cours' : dayHour(e.debut)
                )}</span>`
            )
            .join('')}</div>`
        : ''
    }`;
}

/* ======================= Fiche d'un lieu ======================= */

async function renderPlace(code, token, force) {
  view.innerHTML = `<div class="loading">Chargement…</div>`;
  let place;
  try {
    place = store.getFavs().find((f) => f.code === code) || (await api.getCommune(code));
  } catch {
    view.innerHTML = `<div class="notice">Impossible de charger cette commune (pas de connexion ?).</div>`;
    return;
  }
  if (!isCurrent(token)) return;
  document.title = `${place.nom} · Météo Pêche`;

  let fcR;
  try {
    fcR = await api.getForecast(place.lat, place.lon, { force });
  } catch {
    if (!isCurrent(token)) return;
    view.innerHTML = `${placeHeader(place)}<div class="notice">Météo indisponible et aucune donnée en cache pour ce lieu.</div>`;
    bindStar(place);
    return;
  }
  const [vcR, mfR] = await Promise.all([api.getVigicrues({ force }), api.getVigilanceMeteo({ force })]);
  if (!isCurrent(token)) return;

  const fc = fcR.data;
  const events = an.pressureEvents(fc);

  view.innerHTML = `
    ${placeHeader(place)}
    <div id="stale">${staleNote([fcR])}</div>
    ${sectionNow(fc)}
    ${sectionPressure(fc, events)}
    ${sectionForecast(fc)}
    ${sectionRain(fc)}
    <section class="card" id="rainhist"><h2>Historique des pluies</h2><p class="muted">Chargement de l’historique…</p></section>
    <section class="card" id="hydro"><h2>Cours d’eau</h2><p class="muted">Chargement des stations…</p></section>
    ${sectionSunMoon(place, fc)}
    ${sectionVigilance(place, fc, mfR.data)}
  `;
  bindStar(place);

  charts.pressureChart(document.getElementById('c-pressure'), fc, events);
  charts.tempWindChart(document.getElementById('c-tempwind'), fc);
  charts.cloudUvChart(document.getElementById('c-clouduv'), fc);
  charts.rainChart(document.getElementById('c-rain'), fc);

  renderHydro(place, vcR.data, token, force);
  renderRainHistory(place, fc, token, force);
}

/* ---------- Historique mensuel des pluies ---------- */

const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function pctNormale(total, normale) {
  if (normale == null || normale <= 0) return '';
  const p = Math.round((total / normale) * 100);
  const cls = p >= 125 ? 'wet' : p <= 75 ? 'dry' : '';
  return `<span class="pct ${cls}">${p} % de la normale</span>`;
}

async function renderRainHistory(place, fc, token, force) {
  const box = document.getElementById('rainhist');
  let histR;
  let normals = null;
  try {
    [histR, normals] = await Promise.all([
      api.getRainHistory(place.lat, place.lon, { force }),
      api.getRainNormals(place.lat, place.lon).then((r) => r.data).catch(() => null),
    ]);
  } catch {
    if (isCurrent(token) && box)
      box.innerHTML = `<h2>Historique des pluies</h2><p class="muted">Historique indisponible (pas de connexion ?).</p>`;
    return;
  }
  if (!isCurrent(token) || !box) return;

  const months = an.rainMonths(histR.data, fc, normals);
  if (!months.length) {
    box.innerHTML = `<h2>Historique des pluies</h2><p class="muted">Aucune donnée.</p>`;
    return;
  }
  const cur = months[months.length - 1];
  const past12 = months.filter((m) => !m.encours).slice(-12);
  const total12 = past12.reduce((s, m) => s + m.total, 0);
  const norm12 = normals ? past12.reduce((s, m) => s + (m.normale || 0), 0) : null;
  let selected = months.length - 1;

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
      <select id="rh-select" aria-label="Choisir un mois">${months
        .map((m, i) => `<option value="${i}">${MOIS_LONG[m.mois]} ${m.annee}</option>`)
        .join('')}</select>
    </div>
    <div id="rh-stats" class="month-stats small"></div>
    <div class="chart"><canvas id="c-raindaily" aria-label="Pluie jour par jour du mois choisi"></canvas></div>`;

  let monthsChart = null;
  let dailyChart = null;
  const select = box.querySelector('#rh-select');

  const show = (i) => {
    selected = i;
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
    monthsChart = charts.rainMonthsChart(document.getElementById('c-rainmonths'), months, selected, show);
    dailyChart = charts.rainDailyChart(document.getElementById('c-raindaily'), m);
  };

  select.addEventListener('change', () => show(Number(select.value)));
  show(selected);
}

function placeHeader(place) {
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

function bindStar(place) {
  const b = document.getElementById('star');
  if (!b) return;
  b.addEventListener('click', () => {
    const on = store.toggleFav(place);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    b.textContent = on ? '★ Favori' : '☆ Favori';
  });
}

function sectionNow(fc) {
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
        <div class="muted">${esc(label)}${
          today >= 0 ? ` · ${num(d.temperature_2m_min[today], 0)}° / ${num(d.temperature_2m_max[today], 0)}°` : ''
        }</div>
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

function sectionPressure(fc, events) {
  const p = an.pressureNow(fc);
  const now = Date.now();
  const past = events.filter((e) => e.fin < now);
  const next = events.filter((e) => e.fin >= now);
  const evItem = (e) => `<li class="ev ${e.sign < 0 ? 'down' : 'up'} ${e.kind}">
      <span class="ev-delta">${signed(e.delta, 1)} hPa</span>
      <span>${esc(e.titre)}<br><span class="muted small">${esc(dayHour(e.debut))} → ${esc(dayHour(e.fin))}</span></span>
    </li>`;
  return `<section class="card">
    <h2>Pression atmosphérique</h2>
    <div class="stats">
      <div class="stat"><span class="stat-v">${num(p.value, 1)}</span><span class="stat-l">hPa actuels</span></div>
      <div class="stat"><span class="stat-v">${signed(p.d3, 1)} ${trendArrow(p.trend.level)}</span><span class="stat-l">sur 3 h · ${esc(p.trend.label.toLowerCase())}</span></div>
      <div class="stat"><span class="stat-v">${signed(p.d24, 1)}</span><span class="stat-l">sur 24 h</span></div>
    </div>
    <div class="chart tall"><canvas id="c-pressure" aria-label="Courbe de pression sur 7 jours passés et 7 jours de prévision"></canvas></div>
    <p class="legend-note small muted"><span class="sw down"></span> chute <span class="sw up"></span> hausse — zones colorées : variation ≥ ${an.SEUILS.brutale6h} hPa en 6 h (foncé) ou ≥ ${an.SEUILS.forte24h} hPa en 24 h (clair).</p>
    <div class="ev-cols">
      <div><h3>À venir</h3>${next.length ? `<ul class="ev-list">${next.map(evItem).join('')}</ul>` : '<p class="muted small">Aucune variation brutale prévue.</p>'}</div>
      <div>${
        past.length
          ? `<details class="past-ev"><summary><h3>7 derniers jours (${past.length})</h3></summary><ul class="ev-list">${past
              .reverse()
              .map(evItem)
              .join('')}</ul></details>`
          : '<h3>7 derniers jours</h3><p class="muted small">Aucune variation brutale.</p>'
      }</div>
    </div>
  </section>`;
}

function sectionForecast(fc) {
  const d = fc.daily;
  const today = startOfDay(Date.now());
  const storms = new Set(an.stormDays(fc).map((s) => s.jour));
  const cells = d.time
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t >= today)
    .slice(0, 8)
    .map(({ t, i }) => {
      const [icon, label] = wmo(d.weather_code[i]);
      return `<div class="day ${t === today ? 'today' : ''}">
        <div class="day-name">${t === today ? "Aujourd'hui" : esc(day(t))}</div>
        <div class="day-icon" title="${esc(label)}">${icon}${storms.has(t) ? '<span class="storm" title="Orage possible">⚡</span>' : ''}</div>
        <div class="day-temp"><b>${num(d.temperature_2m_max[i], 0)}°</b> <span class="muted">${num(d.temperature_2m_min[i], 0)}°</span></div>
        <div class="day-rain">${num(d.precipitation_sum[i], 1)} mm</div>
        <div class="day-wind">${windArrow(d.wind_direction_10m_dominant[i], 12)} ${num(d.wind_speed_10m_max[i], 0)}<span class="muted"> / ${num(d.wind_gusts_10m_max[i], 0)}</span></div>
        <div class="day-small muted">☁ ${num(d.cloud_cover_mean[i], 0)} % · UV ${num(d.uv_index_max[i], 0)}</div>
      </div>`;
    })
    .join('');
  return `<section class="card">
    <h2>Prévisions 7 jours</h2>
    <div class="days" role="list">${cells}</div>
    <p class="small muted">Vent : vitesse max / rafales max (km/h), flèche = sens du vent.</p>
    <h3>Température et vent</h3>
    <div class="chart"><canvas id="c-tempwind" aria-label="Température et vent heure par heure"></canvas></div>
    <h3>Nuages et UV</h3>
    <div class="chart short"><canvas id="c-clouduv" aria-label="Couverture nuageuse et indice UV"></canvas></div>
  </section>`;
}

function sectionRain(fc) {
  const r = an.rainSummary(fc);
  return `<section class="card">
    <h2>Pluviométrie</h2>
    <div class="stats">
      <div class="stat"><span class="stat-v">${num(r.passe7j, 1)}</span><span class="stat-l">mm · 7 derniers jours</span></div>
      <div class="stat"><span class="stat-v">${num(r.passe24h, 1)}</span><span class="stat-l">mm · dernières 24 h</span></div>
      <div class="stat"><span class="stat-v">${num(r.futur7j, 1)}</span><span class="stat-l">mm · 7 prochains jours</span></div>
    </div>
    <div class="chart"><canvas id="c-rain" aria-label="Pluie par jour, 7 jours passés et 7 jours prévus"></canvas></div>
    <p class="small muted">Barres pâles : jours passés · barres pleines : prévisions.</p>
  </section>`;
}

function sectionSunMoon(place, fc) {
  const d = fc.daily;
  const today = startOfDay(Date.now());
  const rows = d.time
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t >= today)
    .slice(0, 7)
    .map(({ t, i }) => {
      const s = astro.solunar(t, place.lat, place.lon);
      const per = (list) =>
        list.length ? list.map((p) => `${time(p.debut)}–${time(p.fin)}`).join('<br>') : '–';
      return { t, i, s, per };
    });
  const s0 = rows[0]?.s;
  const lune = s0?.lune || {};
  return `<section class="card">
    <h2>Soleil, lune et périodes solunaires</h2>
    ${
      s0
        ? `<div class="moon-now">
        <span class="moon-emoji" aria-hidden="true">${s0.emoji}</span>
        <div><b>${esc(s0.nom)}</b><br><span class="muted">éclairée à ${num(s0.illumination * 100, 0)} %</span></div>
        <dl class="moon-grid">
          <div><dt>Soleil</dt><dd>☀ ${time(d.sunrise[rows[0].i])} → ${time(d.sunset[rows[0].i])}</dd></div>
          <div><dt>Lune</dt><dd>↑ ${time(lune.lever)} · ↓ ${time(lune.coucher)}</dd></div>
        </dl>
      </div>`
        : ''
    }
    <div class="table-wrap"><table class="sol">
      <thead><tr><th>Jour</th><th>Lune</th><th>Soleil</th><th>Majeures</th><th>Mineures</th></tr></thead>
      <tbody>${rows
        .map(
          ({ t, i, s, per }) => `<tr>
          <td>${t === today ? "Auj." : esc(day(t))}</td>
          <td title="${esc(s.nom)}">${s.emoji} <span class="muted small">${num(s.illumination * 100, 0)} %</span></td>
          <td class="small">${time(d.sunrise[i])}<br>${time(d.sunset[i])}</td>
          <td class="small major">${per(s.majeures)}</td>
          <td class="small minor">${per(s.mineures)}</td>
        </tr>`
        )
        .join('')}</tbody>
    </table></div>
    <p class="small muted">Majeures : lune au plus haut ou au plus bas (±1 h). Mineures : lever et coucher de lune (±30 min).</p>
  </section>`;
}

function sectionVigilance(place, fc, mf) {
  const storms = an.stormDays(fc);
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
              (s) =>
                `<li class="ev storm"><span class="ev-delta">⚡</span><span>${s.grele ? 'Orage avec risque de grêle' : 'Orage possible'}<br><span class="muted small">${esc(
                  dayLong(s.jour)
                )}, ${esc(time(s.debut))} – ${esc(time(s.fin + 3_600_000))}</span></span></li>`
            )
            .join('')}</ul>`
        : '<p class="muted">Pas d’orage prévu sur 7 jours.</p>'
    }
    ${official ? `<h3>Vigilance Météo-France (${esc(place.depNom)})</h3>${official}` : ''}
    <p class="small"><a href="${esc(link)}" target="_blank" rel="noopener">Carte de vigilance Météo-France · ${esc(place.depNom)} ↗</a></p>
  </section>`;
}

/* ---------- Cours d'eau ---------- */

async function renderHydro(place, vc, token, force) {
  const box = document.getElementById('hydro');
  let nearby = [];
  try {
    nearby = await api.getNearbyStations(place.lat, place.lon, 25);
  } catch {
    if (!isCurrent(token)) return;
    if (!store.getStations(place.code).length) {
      box.innerHTML = `<h2>Cours d’eau</h2><p class="muted">Stations indisponibles (pas de connexion).</p>`;
      return;
    }
  }
  if (!isCurrent(token)) return;

  const followed = store.getStations(place.code);
  const followedCodes = new Set(followed.map((s) => s.code));
  // Stations suivies d'abord, puis les plus proches.
  const list = [
    ...followed.map((s) => nearby.find((n) => n.code === s.code) || { ...s, km: null }),
    ...nearby.filter((n) => !followedCodes.has(n.code)),
  ].slice(0, Math.max(12, followed.length));

  box.innerHTML = `
    <h2>Cours d’eau</h2>
    <div id="hydro-followed">${
      followed.length
        ? followed.map((s) => `<div class="station" id="st-${esc(s.code)}"><p class="muted">Chargement ${esc(s.libelle)}…</p></div>`).join('')
        : '<p class="muted">Cochez une ou plusieurs stations ci-dessous pour suivre leur hauteur et leur débit.</p>'
    }</div>
    <details class="nearby" ${followed.length ? '' : 'open'}>
      <summary>Stations à proximité (${nearby.length} dans un rayon de 25 km)</summary>
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

  box.querySelectorAll('input[type=checkbox]').forEach((cb) =>
    cb.addEventListener('change', () => {
      const s = list.find((x) => x.code === cb.dataset.code);
      if (!s) return;
      store.toggleStation(place.code, { code: s.code, libelle: s.libelle, coursEau: s.coursEau, lat: s.lat, lon: s.lon });
      renderHydro(place, vc, token, false);
    })
  );

  for (const s of followed) {
    api
      .getObservations(s.code, { force })
      .then((r) => isCurrent(token) && renderStation(s, r, vc))
      .catch(() => {
        const el = document.getElementById('st-' + s.code);
        if (el && isCurrent(token)) el.innerHTML = `<h3>${esc(s.libelle)}</h3><p class="muted">Données indisponibles.</p>`;
      });
  }
}

function renderStation(s, r, vc) {
  const el = document.getElementById('st-' + s.code);
  if (!el) return;
  const obs = r.data;
  const H = an.seriesDelta(obs.H);
  const Q = an.seriesDelta(obs.Q);
  const v = an.vigicruesFor(vc, s.code);
  const lt = an.levelTrend(H?.delta);
  const qt = an.flowTrend(obs.Q);
  const vigi = v
    ? `<span class="vigi-tag"><span class="vdot ${VIGI[v.niveau]?.cls || ''}"></span>Vigilance crues ${esc(VIGI[v.niveau]?.nom || 'inconnue')} · ${esc(v.nom)}</span>`
    : vc
      ? '<span class="vigi-tag muted">Hors réseau de vigilance crues</span>'
      : '';
  if (!H && !Q) {
    el.innerHTML = `<h3>${esc(s.libelle)}</h3><p class="muted">Pas de mesure en temps réel sur les 7 derniers jours pour cette station.</p>${vigi}`;
    return;
  }
  const canvasId = 'c-h-' + s.code;
  el.innerHTML = `
    <div class="station-head">
      <h3>${esc(s.libelle)}</h3>
      <span class="muted small">${esc(s.coursEau)} · mesure ${esc(ago((H || Q).t))}${r.stale ? ' (hors ligne)' : ''}</span>
    </div>
    <div class="stats">
      ${H ? `<div class="stat"><span class="stat-v">${num(H.value, 2)} m ${trendArrow(lt.level)}</span><span class="stat-l">hauteur · ${H.delta != null ? signed(H.delta * 100, 0) + ' cm/24 h' : ''} · ${esc(lt.label.toLowerCase())}</span></div>` : ''}
      ${Q ? `<div class="stat"><span class="stat-v">${num(Q.value, Q.value < 10 ? 2 : 1)} m³/s ${trendArrow(qt.level)}</span><span class="stat-l">débit · ${esc(qt.label.toLowerCase())}</span></div>` : ''}
      ${H ? `<div class="stat"><span class="stat-v">${num(H.min, 2)} – ${num(H.max, 2)}</span><span class="stat-l">min – max 7 j (m)</span></div>` : ''}
    </div>
    <div class="chart"><canvas id="${esc(canvasId)}" aria-label="Hauteur et débit sur 7 jours"></canvas></div>
    <div class="station-foot">${vigi}<a class="small" href="https://www.hydro.eaufrance.fr/stationhydro/${esc(s.code)}/fiche" target="_blank" rel="noopener">Fiche station ↗</a></div>`;
  charts.hydroChart(document.getElementById(canvasId), obs);
}

/* ======================= Démarrage ======================= */

route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
