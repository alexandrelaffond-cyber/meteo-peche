// Calculs lunaires (position, phase, lever/coucher, passages) et périodes solunaires.
// Formules astronomiques simplifiées (précision de quelques minutes, suffisante pour la pêche).

const rad = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = rad * 23.4397;

const toDays = (ms) => ms / DAY_MS - 0.5 + J1970 - J2000;

function raDec(l, b) {
  return {
    ra: Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l)),
    dec: Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l)),
  };
}

function sunCoords(d) {
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return raDec(M + C + rad * 102.9372 + Math.PI, 0);
}

function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d);
  const M = rad * (134.963 + 13.064993 * d);
  const F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * Math.sin(M);
  const b = rad * 5.128 * Math.sin(F);
  return { ...raDec(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

const wrap = (a) => {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
};

function moonState(ms, lat, lon) {
  const d = toDays(ms);
  const c = moonCoords(d);
  const phi = rad * lat;
  const H = rad * (280.16 + 360.9856235 * d) + rad * lon - c.ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
  return { alt, H: wrap(H) };
}

export function moonIllumination(ms) {
  const d = toDays(ms);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sdist = 149598000;
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)
  );
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
  );
  return {
    fraction: (1 + Math.cos(inc)) / 2,
    phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI,
  };
}

export function phaseInfo(phase) {
  if (phase < 0.03 || phase > 0.97) return { nom: 'Nouvelle lune', emoji: '🌑' };
  if (phase < 0.22) return { nom: 'Premier croissant', emoji: '🌒' };
  if (phase < 0.28) return { nom: 'Premier quartier', emoji: '🌓' };
  if (phase < 0.47) return { nom: 'Gibbeuse croissante', emoji: '🌔' };
  if (phase < 0.53) return { nom: 'Pleine lune', emoji: '🌕' };
  if (phase < 0.72) return { nom: 'Gibbeuse décroissante', emoji: '🌖' };
  if (phase < 0.78) return { nom: 'Dernier quartier', emoji: '🌗' };
  return { nom: 'Dernier croissant', emoji: '🌘' };
}

/**
 * Événements lunaires d'une journée locale commençant à `dayStart` (ms) :
 * lever, coucher, passage au méridien (lune haute) et passage inférieur (lune basse).
 */
export function moonDay(dayStart, lat, lon) {
  const STEP = 10 * 60_000;
  const H0 = 0.133 * rad; // horizon corrigé (réfraction + parallaxe)
  const ev = { lever: null, coucher: null, haute: null, basse: null };
  let prev = moonState(dayStart, lat, lon);
  for (let t = dayStart + STEP; t <= dayStart + DAY_MS; t += STEP) {
    const cur = moonState(t, lat, lon);
    const a0 = prev.alt - H0;
    const a1 = cur.alt - H0;
    if (a0 < 0 && a1 >= 0 && ev.lever == null) ev.lever = t - STEP + (STEP * -a0) / (a1 - a0);
    if (a0 >= 0 && a1 < 0 && ev.coucher == null) ev.coucher = t - STEP + (STEP * a0) / (a0 - a1);
    // Passage supérieur : l'angle horaire passe de négatif à positif.
    if (prev.H < 0 && cur.H >= 0 && cur.H - prev.H < 1 && ev.haute == null)
      ev.haute = t - STEP + (STEP * -prev.H) / (cur.H - prev.H);
    // Passage inférieur : l'angle horaire bascule de +π à −π.
    if (prev.H > 2 && cur.H < -2 && ev.basse == null) {
      const h1 = cur.H + 2 * Math.PI;
      ev.basse = t - STEP + (STEP * (Math.PI - prev.H)) / (h1 - prev.H);
    }
    prev = cur;
  }
  return ev;
}

/** Périodes solunaires : majeures (lune haute/basse, ±1 h) et mineures (lever/coucher, ±30 min). */
export function solunar(dayStart, lat, lon) {
  const m = moonDay(dayStart, lat, lon);
  const H = 3_600_000;
  const majeures = [m.haute, m.basse].filter((x) => x != null).map((t) => ({ debut: t - H, fin: t + H, centre: t }));
  const mineures = [m.lever, m.coucher]
    .filter((x) => x != null)
    .map((t) => ({ debut: t - H / 2, fin: t + H / 2, centre: t }));
  const ill = moonIllumination(dayStart + DAY_MS / 2);
  return {
    lune: m,
    majeures: majeures.sort((a, b) => a.centre - b.centre),
    mineures: mineures.sort((a, b) => a.centre - b.centre),
    illumination: ill.fraction,
    phase: ill.phase,
    ...phaseInfo(ill.phase),
  };
}
