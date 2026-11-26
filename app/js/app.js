// Point d'entrée : routeur, choix du mode (Pêche / Maison), recherche de communes.
import * as api from './api.js';
import * as store from './store.js';
import * as charts from './charts.js';
import { esc } from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderPlacePeche } from './views/peche.js';
import { renderPlaceMaison } from './views/maison.js';

const view = document.getElementById('view');
let renderToken = 0;
let forceNext = false;

/* ======================= Mode ======================= */

function getMode() {
  const m = store.getPref('mode', null);
  if (m === 'peche' || m === 'maison') return m;
  return matchMedia('(max-width: 700px)').matches ? 'peche' : 'maison';
}

function syncModeButtons() {
  const mode = getMode();
  document.documentElement.dataset.mode = mode;
  document.querySelectorAll('.mode-toggle button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === mode));
}

document.querySelectorAll('.mode-toggle button').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.mode === getMode()) return;
    store.setPref('mode', b.dataset.mode);
    syncModeButtons();
    route({ keepScroll: false });
  })
);

/* ======================= Routeur ======================= */

async function route({ keepScroll = false } = {}) {
  const h = location.hash || '#/';
  const m = /^#\/lieu\/(\w+)/.exec(h);
  charts.destroyAll();
  const token = ++renderToken;
  const isCurrent = () => token === renderToken;
  const force = forceNext;
  forceNext = false;
  const mode = getMode();
  if (!keepScroll) window.scrollTo(0, 0);
  if (!m) return renderDashboard(view, { mode, isCurrent, force });

  const code = m[1];
  view.innerHTML = `<div class="loading">Chargement…</div>`;
  let place;
  try {
    place = store.getFavs().find((f) => f.code === code) || (await api.getCommune(code));
  } catch {
    view.innerHTML = `<div class="notice">Impossible de charger cette commune (pas de connexion ?).</div>`;
    return;
  }
  if (!isCurrent()) return;
  document.title = `${place.nom} · Météo Pêche`;

  let fcR;
  try {
    fcR = await api.getForecast(place.lat, place.lon, { force });
  } catch {
    if (!isCurrent()) return;
    view.innerHTML = `<div class="notice">Météo indisponible pour ${esc(place.nom)} et aucune donnée en cache.</div>`;
    return;
  }
  const [vcR, mfR] = await Promise.all([api.getVigicrues({ force }), api.getVigilanceMeteo({ force })]);
  if (!isCurrent()) return;
  const args = { place, fcR, vc: vcR.data, mf: mfR.data, isCurrent, force };
  if (mode === 'peche') renderPlacePeche(view, args);
  else renderPlaceMaison(view, args);
}

window.addEventListener('hashchange', () => route());

document.getElementById('refresh').addEventListener('click', () => {
  forceNext = true;
  route({ keepScroll: true });
});

// En revenant sur l'app après 30 min, on rafraîchit.
let hiddenAt = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (Date.now() - hiddenAt > 30 * 60_000) route({ keepScroll: true });
});

// Thème clair/sombre changé → on redessine les graphiques.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => route({ keepScroll: true }));

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
              (p) => `<li><a href="#/lieu/${esc(p.code)}">
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

/* ======================= Démarrage ======================= */

// Nettoie le cache de la première version (périodes de données plus courtes).
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('mp.cache.meteo.') || k.startsWith('mp.cache.hydro.'))) localStorage.removeItem(k);
  }
} catch {
  /* rien */
}

syncModeButtons();
route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
