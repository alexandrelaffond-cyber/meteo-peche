// Stockage local (propre à chaque appareil) : favoris, stations suivies, cache des données.

const K = {
  favs: 'mp.favs',
  stations: 'mp.stations.',
  cache: 'mp.cache.',
};

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ---------- Favoris ---------- */
// lieu : { code, nom, cp, dep, depNom, lat, lon }

export function getFavs() {
  const v = read(K.favs, []);
  return Array.isArray(v) ? v : [];
}

export function isFav(code) {
  return getFavs().some((f) => f.code === code);
}

export function toggleFav(place) {
  const favs = getFavs();
  const i = favs.findIndex((f) => f.code === place.code);
  if (i >= 0) favs.splice(i, 1);
  else favs.push(place);
  write(K.favs, favs);
  return i < 0;
}

export function moveFav(code, dir) {
  const favs = getFavs();
  const i = favs.findIndex((f) => f.code === code);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= favs.length) return;
  [favs[i], favs[j]] = [favs[j], favs[i]];
  write(K.favs, favs);
}

/* ---------- Stations hydro suivies, par commune ---------- */
// station : { code, libelle, coursEau, lat, lon }

export function getStations(placeCode) {
  const v = read(K.stations + placeCode, []);
  return Array.isArray(v) ? v : [];
}

export function toggleStation(placeCode, station) {
  const list = getStations(placeCode);
  const i = list.findIndex((s) => s.code === station.code);
  if (i >= 0) list.splice(i, 1);
  else list.push(station);
  write(K.stations + placeCode, list);
  return i < 0;
}

/* ---------- Cache de données ---------- */

export function cacheGet(key) {
  return read(K.cache + key, null);
}

export function cacheSet(key, data) {
  const entry = { t: Date.now(), data };
  if (write(K.cache + key, entry)) return;
  // Quota dépassé : on supprime les entrées de cache les plus anciennes puis on réessaie.
  try {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(K.cache)) entries.push([k, read(k, { t: 0 }).t || 0]);
    }
    entries.sort((a, b) => a[1] - b[1]);
    for (const [k] of entries.slice(0, Math.ceil(entries.length / 2))) localStorage.removeItem(k);
  } catch {
    /* rien */
  }
  write(K.cache + key, entry);
}
