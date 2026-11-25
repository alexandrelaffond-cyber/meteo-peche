// Génère les fichiers de vigilance lus par l'application (exécuté toutes les heures par GitHub Actions).
// Ces sources ne sont pas interrogeables directement depuis un navigateur (CORS), d'où ce relais.
//
//   node scripts/build-data.mjs app/data
//
// Variables d'environnement facultatives :
//   MF_API_KEY      clé de l'API « Vigilance » de Météo-France (portail-api.meteofrance.fr)
//   VC_MAP_CACHE    chemin du cache de correspondance station → tronçon (défaut : .cache/vigicrues-stations.json)

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const OUT = process.argv[2] || 'app/data';
const VC = 'https://www.vigicrues.gouv.fr/services';
const MAP_CACHE = process.env.VC_MAP_CACHE || '.cache/vigicrues-stations.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, headers = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'meteo-peche-pwa (GitHub Actions)', ...headers } });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

async function vigicrues() {
  const geo = await getJSON(`${VC}/1/InfoVigiCru.geojson?TypEntVigiCru=8`);
  const troncons = {};
  for (const f of geo.features || []) {
    const p = f.properties || {};
    if (p.CdEntCru) troncons[p.CdEntCru] = { nom: p.lbentcru, niveau: p.NivInfViCr ?? null };
  }
  if (!Object.keys(troncons).length) throw new Error('Aucun tronçon reçu');

  // Correspondance station → tronçon : change rarement, recalculée une fois par semaine.
  let stations = null;
  try {
    const c = JSON.parse(await readFile(MAP_CACHE, 'utf8'));
    if (Date.now() - c.t < 7 * 86_400_000 && Object.keys(c.stations).length > 100) stations = c.stations;
  } catch {
    /* pas de cache */
  }
  if (!stations) {
    stations = {};
    let errors = 0;
    await pool(Object.keys(troncons), 4, async (code) => {
      try {
        const d = await getJSON(`${VC}/v1.1/TronEntVigiCru.json?CdEntVigiCru=${code}&TypEntVigiCru=8`);
        for (const s of d.ListEntVigiCru?.[0]?.aNMoinsUn || []) {
          if (String(s.TypEntVigiCruInferieur) === '7' && !stations[s.CdEntVigiCruInferieur])
            stations[s.CdEntVigiCruInferieur] = code;
        }
      } catch {
        errors++;
      }
    });
    console.log(`Correspondance stations : ${Object.keys(stations).length} stations, ${errors} erreurs`);
    await mkdir(dirname(MAP_CACHE), { recursive: true });
    await writeFile(MAP_CACHE, JSON.stringify({ t: Date.now(), stations }));
  }
  return { maj: new Date().toISOString(), troncons, stations };
}

async function vigilanceMeteo() {
  const key = process.env.MF_API_KEY;
  if (!key) return null;
  const d = await getJSON('https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours', {
    apikey: key,
  });
  const deps = {};
  for (const period of d.product?.periods || []) {
    const ech = period.echeance; // « J » ou « J1 »
    for (const dom of period.timelaps?.domain_ids || []) {
      const dep = String(dom.domain_id);
      if (!/^(\d{2}|2[AB])$/.test(dep)) continue;
      (deps[dep] ||= {})[ech] = {
        niveau: Number(dom.max_color_id) || 1,
        phenomenes: (dom.phenomenon_items || [])
          .map((p) => ({ id: Number(p.phenomenon_id), niveau: Number(p.phenomenon_max_color_id) }))
          .filter((p) => p.niveau >= 2),
      };
    }
  }
  return { maj: new Date().toISOString(), deps };
}

await mkdir(OUT, { recursive: true });

try {
  const vc = await vigicrues();
  await writeFile(join(OUT, 'vigicrues.json'), JSON.stringify(vc));
  console.log(`vigicrues.json : ${Object.keys(vc.troncons).length} tronçons`);
} catch (e) {
  console.error('Vigicrues indisponible :', e.message);
}

try {
  const mf = await vigilanceMeteo();
  if (mf) {
    await writeFile(join(OUT, 'vigilance-meteo.json'), JSON.stringify(mf));
    console.log(`vigilance-meteo.json : ${Object.keys(mf.deps).length} départements`);
  } else console.log('Vigilance Météo-France : pas de clé MF_API_KEY, étape ignorée');
} catch (e) {
  console.error('Vigilance Météo-France indisponible :', e.message);
}
