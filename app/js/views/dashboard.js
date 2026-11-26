// Tableau de bord des favoris, adapté au mode (Pêche : 48 h · Maison : 14 jours).
import * as api from '../api.js';
import * as store from '../store.js';
import * as an from '../analysis.js';
import { esc, num, signed, dayHour, windDir, windArrow, trendArrow, wmo, sparkline, VIGI } from '../ui.js';
import { DAY, HOUR, staleNote, alertList, nextPeriodText } from './common.js';

export async function renderDashboard(view, { mode, isCurrent, force }) {
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
  const peche = mode === 'peche';
  const horizon = peche ? 2 * DAY : 14 * DAY;

  view.innerHTML = `
    <section class="card alerts" id="alerts"><h2>À venir</h2><p class="muted">Chargement…</p></section>
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
        const hydro = await Promise.all(
          store.getStations(place.code).map((station) =>
            api
              .getObservations(station.code, { force })
              .then((r) => ({ station, obs: r.data, r }))
              .catch(() => ({ station, obs: null }))
          )
        );
        if (!isCurrent()) return null;
        const ctx = { place, fc: fcR.data, hydro, vc: vcR.data, mf: mfR.data };
        (peche ? cardPeche : cardMaison)(ctx);
        return { ctx, results: [fcR, ...hydro.map((h) => h.r)] };
      } catch {
        if (!isCurrent()) return null;
        const el = document.getElementById('fav-' + place.code);
        if (el) el.querySelector('.fav-link').innerHTML = `<header><h3>${esc(place.nom)}</h3></header><p class="muted">Données indisponibles (pas de connexion).</p>`;
        return null;
      }
    })
  );
  if (!isCurrent()) return;

  const ok = all.filter(Boolean);
  document.getElementById('stale').innerHTML = staleNote(ok.flatMap((x) => x.results));
  const alerts = ok
    .flatMap((x) => an.collectAlerts(x.ctx, Date.now(), horizon))
    .sort((a, b) => a.t - b.t || (a.niveau === 'fort' ? -1 : 1));
  const max = 6;
  document.getElementById('alerts').innerHTML = `<h2>À venir <span class="muted small">· ${peche ? '48 prochaines heures' : '14 prochains jours'}</span></h2>${
    alerts.length
      ? alertList(alerts.slice(0, max), { showPlace: true }) +
        (alerts.length > max
          ? `<details class="more-alerts"><summary>${alerts.length - max} autre${alerts.length - max > 1 ? 's' : ''} alerte${alerts.length - max > 1 ? 's' : ''}</summary>${alertList(alerts.slice(max), { showPlace: true })}</details>`
          : '')
      : `<p class="muted">Rien de particulier : pas de variation brutale de pression, de forte pluie ni d’orage prévus${peche ? ' dans les 48 h' : ''}.</p>`
  }`;
}

function hydroRows({ hydro, vc }, hoursDelta) {
  return hydro
    .map(({ station, obs }) => {
      if (!obs || (!obs.H.length && !obs.Q.length))
        return `<div class="row"><span class="lbl">${esc(station.libelle)}</span><span class="muted small">pas de données</span></div>`;
      const H = an.seriesDelta(obs.H, hoursDelta);
      const H24 = an.seriesDelta(obs.H, 24);
      const Q = an.seriesDelta(obs.Q, 24);
      const lt = an.levelTrend(H24?.delta);
      const v = an.vigicruesFor(vc, station.code);
      return `<div class="row">
        <span class="lbl">${v ? `<span class="vdot ${VIGI[v.niveau]?.cls || ''}" title="Vigilance crues ${esc(VIGI[v.niveau]?.nom || '')}"></span>` : ''}${esc(station.libelle)}</span>
        <span class="val">${H ? `${num(H.value, 2)} m ${trendArrow(lt.level)}<span class="small muted">${H.delta != null ? signed(H.delta * 100, 0) + ` cm/${hoursDelta} h` : ''}</span>` : ''}${Q ? ` <span class="small muted">· ${num(Q.value, Q.value < 10 ? 2 : 1)} m³/s</span>` : ''}</span>
      </div>`;
    })
    .join('');
}

function cardHead(place, fc) {
  const h = fc.hourly;
  const i = an.nowIndex(h.time);
  const d = fc.daily;
  const today = an.rainSummary(fc).iToday;
  const [icon, label] = wmo(h.weather_code[i]);
  return `
    <header><h3>${esc(place.nom)}</h3><span class="muted">${esc(place.depNom)}</span></header>
    <div class="fav-now">
      <span class="big-icon" aria-hidden="true">${icon}</span>
      <span class="big-temp">${num(h.temperature_2m[i], 0)}°</span>
      <span class="fav-now-text">${esc(label)}<br><span class="muted small">${today >= 0 ? `${num(d.temperature_2m_min[today], 0)}° / ${num(d.temperature_2m_max[today], 0)}° · ` : ''}vent ${num(h.wind_speed_10m[i], 0)} km/h ${windDir(h.wind_direction_10m[i])}</span></span>
    </div>`;
}

function cardPeche(ctx) {
  const { place, fc } = ctx;
  const el = document.getElementById('fav-' + place.code);
  if (!el) return;
  const h = fc.hourly;
  const i = an.nowIndex(h.time);
  const p = an.pressureNow(fc);
  const a6 = an.pressureAhead(fc, 6);
  const r = an.rainSummary(fc);
  const sol = nextPeriodText(place);
  const now = Date.now();
  const sparkPts = h.time.map((t, k) => [t, h.pressure_msl[k]]).filter(([t]) => t >= now - 24 * HOUR && t <= now + 24 * HOUR);
  el.querySelector('.fav-link').innerHTML = `
    ${cardHead(place, fc)}
    <div class="row">
      <span class="lbl">Vent</span>
      <span class="val">${windArrow(h.wind_direction_10m[i])} ${num(h.wind_speed_10m[i], 0)} km/h <span class="small muted">rafales ${num(h.wind_gusts_10m[i], 0)}</span></span>
    </div>
    <div class="row">
      <span class="lbl">Pression</span>
      <span class="val"><b>${num(p.value, 0)}</b> hPa ${trendArrow(p.trend.level)}<span class="small muted">${signed(p.d3, 1)} en 3 h · ${a6 != null ? signed(a6, 1) + ' dans 6 h' : ''}</span></span>
    </div>
    ${sparkline(sparkPts, { width: 300, height: 30, nowX: now, cls: 'spark-pressure' })}
    <div class="row">
      <span class="lbl">Pluie</span>
      <span class="val"><b>${num(r.prochaines6h, 1)}</b> mm <span class="small muted">dans 6 h · ${num(r.passe24h, 1)} mm sur 24 h</span></span>
    </div>
    ${sol ? `<div class="row"><span class="lbl">Solunaire</span><span class="val small ${sol.enCours ? 'sol-now' : ''}">${esc(sol.texte)}</span></div>` : ''}
    ${hydroRows(ctx, 3) || ''}`;
}

function cardMaison(ctx) {
  const { place, fc } = ctx;
  const el = document.getElementById('fav-' + place.code);
  if (!el) return;
  const h = fc.hourly;
  const p = an.pressureNow(fc);
  const r = an.rainSummary(fc);
  const now = Date.now();
  const sparkPts = h.time.map((t, k) => [t, h.pressure_msl[k]]).filter(([t]) => t >= now - 7 * DAY && t <= now + 14 * DAY);
  const upcoming = an.pressureEvents(fc).filter((e) => e.fin >= now && e.debut <= now + 14 * DAY);
  el.querySelector('.fav-link').innerHTML = `
    ${cardHead(place, fc)}
    <div class="row pressure-row">
      <span class="lbl">Pression</span>
      <span class="val"><b>${num(p.value, 0)}</b> hPa ${trendArrow(p.trend.level)}<span class="small muted">${esc(p.trend.label)} · ${signed(p.d24, 0)} hPa/24 h</span></span>
    </div>
    ${sparkline(sparkPts, { width: 300, height: 36, nowX: now, cls: 'spark-pressure' })}
    <div class="row">
      <span class="lbl">Pluie</span>
      <span class="val"><span class="small muted">7 j passés</span> <b>${num(r.passe7j, 0)}</b> mm · <span class="small muted">7 j à venir</span> <b>${num(r.futur7j, 0)}</b> mm</span>
    </div>
    ${hydroRows(ctx, 24) || '<div class="row"><span class="lbl">Cours d’eau</span><span class="small muted">aucune station suivie</span></div>'}
    ${
      upcoming.length
        ? `<div class="chips">${upcoming
            .slice(0, 4)
            .map((e) => `<span class="chip ${e.sign < 0 ? 'down' : 'up'}">${e.sign < 0 ? '↘' : '↗'} ${signed(e.delta, 0)} hPa · ${esc(e.debut <= now ? 'en cours' : dayHour(e.debut))}</span>`)
            .join('')}</div>`
        : ''
    }`;
}
