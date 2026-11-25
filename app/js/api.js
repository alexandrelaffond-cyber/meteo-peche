// Accès aux sources de données, avec cache local et repli hors ligne.
import { cacheGet, cacheSet } from './store.js';

const MIN = 60_000;
const DAY = 86_400_000;

async function getJSON(url, { allow404 = false } = {}) {
  const r = await fetch(url, { cache: 'no-store' });
  if (allow404 && r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * Renvoie { data, t, stale } : les données en cache si elles sont récentes,
 * sinon une requête réseau ; en cas d'échec réseau, les dernières données connues.
 */
async function cached(key, ttl, fetcher, { force = false } = {}) {
  const c = cacheGet(key);
  if (!force && c && Date.now() - c.t < ttl) return { data: c.data, t: c.t, stale: false };
  try {
    const data = await fetcher();
    cacheSet(key, data);
    return { data, t: Date.now(), stale: false };
  } catch (err) {
    if (c) return { data: c.data, t: c.t, stale: true, error: err };
    throw err;
  }
}

/* ---------- Communes (geo.api.gouv.fr) ---------- */

const COMMUNE_FIELDS = 'nom,code,codesPostaux,centre,departement';

function toPlace(c) {
  return {
    code: c.code,
    nom: c.nom,
    cp: (c.codesPostaux || [])[0] || '',
    dep: c.departement?.code || '',
    depNom: c.departement?.nom || '',
    lat: c.centre?.coordinates?.[1],
    lon: c.centre?.coordinates?.[0],
  };
}

export async function searchCommunes(q) {
  q = q.trim();
  if (q.length < 2) return [];
  const param = /^\d{5}$/.test(q) ? `codePostal=${q}` : `nom=${encodeURIComponent(q)}`;
  const list = await getJSON(
    `https://geo.api.gouv.fr/communes?${param}&fields=${COMMUNE_FIELDS}&boost=population&limit=8`
  );
  const places = list.map(toPlace).filter((p) => p.lat != null);
  for (const p of places) cacheSet('commune.' + p.code, p);
  return places;
}

export async function getCommune(code) {
  const r = await cached('commune.' + code, 90 * DAY, async () => {
    const c = await getJSON(`https://geo.api.gouv.fr/communes/${code}?fields=${COMMUNE_FIELDS}`);
    return toPlace(c);
  });
  return r.data;
}

/* ---------- Météo (Open-Meteo, modèles Météo-France inclus) ---------- */

const HOURLY = [
  'temperature_2m',
  'pressure_msl',
  'precipitation',
  'cloud_cover',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'weather_code',
  'uv_index',
];
const DAILY = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'sunrise',
  'sunset',
  'uv_index_max',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
  'cloud_cover_mean',
];

export function getForecast(lat, lon, opts) {
  const la = lat.toFixed(3);
  const lo = lon.toFixed(3);
  return cached(
    `meteo.${la},${lo}`,
    30 * MIN,
    async () => {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}` +
        `&hourly=${HOURLY.join(',')}&daily=${DAILY.join(',')}` +
        `&past_days=7&forecast_days=8&timezone=Europe%2FParis&timeformat=unixtime&wind_speed_unit=kmh`;
      const d = await getJSON(url);
      // Passage des horodatages en millisecondes.
      d.hourly.time = d.hourly.time.map((s) => s * 1000);
      d.daily.time = d.daily.time.map((s) => s * 1000);
      d.daily.sunrise = d.daily.sunrise.map((s) => s * 1000);
      d.daily.sunset = d.daily.sunset.map((s) => s * 1000);
      return { hourly: d.hourly, daily: d.daily, elevation: d.elevation };
    },
    opts
  );
}

/* ---------- Historique de pluie (archives Open-Meteo) ---------- */

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Pluie journalière depuis le 1er du mois il y a 12 mois jusqu'à hier : { debut, jours: [mm…] }. */
export function getRainHistory(lat, lon, opts) {
  const la = lat.toFixed(2);
  const lo = lon.toFixed(2);
  return cached(
    `pluiehist.${la},${lo}`,
    6 * 3_600_000,
    async () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 12, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const d = await getJSON(
        `${ARCHIVE}?latitude=${la}&longitude=${lo}&start_date=${ymd(start)}&end_date=${ymd(end)}` +
          `&daily=precipitation_sum&timezone=Europe%2FParis`
      );
      return { debut: d.daily.time[0], jours: d.daily.precipitation_sum };
    },
    opts
  );
}

/** Normales mensuelles de pluie 1991-2020 (mm), calculées sur les archives : [12 valeurs]. */
export function getRainNormals(lat, lon) {
  const la = lat.toFixed(1);
  const lo = lon.toFixed(1);
  return cached(`pluienorm.${la},${lo}`, 365 * DAY, async () => {
    const d = await getJSON(
      `${ARCHIVE}?latitude=${la}&longitude=${lo}&start_date=1991-01-01&end_date=2020-12-31` +
        `&daily=precipitation_sum&timezone=Europe%2FParis`
    );
    const sums = new Array(12).fill(0);
    d.daily.time.forEach((t, i) => {
      sums[Number(t.slice(5, 7)) - 1] += d.daily.precipitation_sum[i] || 0;
    });
    return sums.map((s) => Math.round((s / 30) * 10) / 10);
  });
}

/* ---------- Hydrométrie (Hub'Eau = données Vigicrues / HydroPortail) ---------- */

const HUBEAU = 'https://hubeau.eaufrance.fr/api/v2/hydrometrie';

export function haversineKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

export async function getNearbyStations(lat, lon, km = 25) {
  const r = await cached(`stations.${lat.toFixed(3)},${lon.toFixed(3)}`, 7 * DAY, async () => {
    const url =
      `${HUBEAU}/referentiel/stations?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&distance=${km}&en_service=true&format=json&size=200` +
      `&fields=code_station,libelle_station,libelle_cours_eau,longitude_station,latitude_station`;
    const d = await getJSON(url);
    return (d.data || []).map((s) => ({
      code: s.code_station,
      libelle: s.libelle_station,
      coursEau: s.libelle_cours_eau || '',
      lat: s.latitude_station,
      lon: s.longitude_station,
    }));
  });
  return r.data
    .map((s) => ({ ...s, km: haversineKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.km - b.km);
}

// Garde au plus un point par pas de `stepMs` pour alléger le stockage.
function thin(points, stepMs) {
  const out = [];
  let last = -Infinity;
  for (const p of points) {
    if (p[0] - last >= stepMs) {
      out.push(p);
      last = p[0];
    }
  }
  const lastPt = points[points.length - 1];
  if (lastPt && out[out.length - 1] !== lastPt) out.push(lastPt);
  return out;
}

async function fetchSerie(code, grandeur, since) {
  const url =
    `${HUBEAU}/observations_tr?code_entite=${code}&grandeur_hydro=${grandeur}` +
    `&date_debut_obs=${since}&size=20000&sort=asc&fields=date_obs,resultat_obs`;
  const d = await getJSON(url);
  // H est en mm, Q en l/s : conversion en m et m³/s.
  const pts = (d.data || [])
    .filter((o) => o.resultat_obs != null)
    .map((o) => [Date.parse(o.date_obs), o.resultat_obs / 1000]);
  return thin(pts, 20 * MIN);
}

export function getObservations(code, opts) {
  return cached(
    'hydro.' + code,
    15 * MIN,
    async () => {
      const since = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 19) + 'Z';
      const [H, Q] = await Promise.all([
        fetchSerie(code, 'H', since).catch(() => []),
        fetchSerie(code, 'Q', since).catch(() => []),
      ]);
      return { H, Q };
    },
    opts
  );
}

/* ---------- Vigilances (fichiers générés toutes les heures par GitHub Actions) ---------- */

export function getVigicrues(opts) {
  return cached('vigicrues', 20 * MIN, () => getJSON('data/vigicrues.json', { allow404: true }), opts).catch(
    () => ({ data: null })
  );
}

export function getVigilanceMeteo(opts) {
  return cached('vigimeteo', 20 * MIN, () => getJSON('data/vigilance-meteo.json', { allow404: true }), opts).catch(
    () => ({ data: null })
  );
}
