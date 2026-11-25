# Météo Pêche

Application web installable (PWA) qui regroupe, pour chaque coin de pêche :

- la **pression atmosphérique** (7 jours passés + 7 jours prévus), sa tendance et les variations brutales ;
- la **météo** : température, vent et rafales, nuages, UV, lever/coucher du soleil, orages ;
- la **pluviométrie** par jour (7 jours passés, 7 jours prévus) ;
- les **niveaux et débits** des stations hydrométriques choisies, avec la vigilance crues ;
- la **phase de lune** et les **périodes solunaires**.

Favoris et stations suivies sont gardés sur chaque appareil (pas de compte).

## Sources

| Donnée | Source |
| --- | --- |
| Météo, pression, pluie | [Open-Meteo](https://open-meteo.com/) (modèles Météo-France AROME/ARPEGE) |
| Hauteur / débit | [Hub'Eau Hydrométrie](https://hubeau.eaufrance.fr/page/api-hydrometrie) (réseau Vigicrues) |
| Vigilance crues | [Vigicrues](https://www.vigicrues.gouv.fr/), relayé toutes les heures par GitHub Actions |
| Vigilance météo (optionnel) | API Météo-France, si le secret `MF_API_KEY` est défini |
| Communes | [geo.api.gouv.fr](https://geo.api.gouv.fr/) |

## Structure

- `app/` : le site (HTML/CSS/JS sans étape de compilation)
- `scripts/build-data.mjs` : génère `app/data/*.json` (vigilances)
- `.github/workflows/deploy.yml` : met à jour les données et publie sur GitHub Pages toutes les heures

## Lancer en local

```bash
node scripts/build-data.mjs app/data
python3 -m http.server 8765 --directory app
```

Puis ouvrir http://localhost:8765.

## Réglages

Les seuils d'alerte (variation brutale de pression, pluie, montée des eaux) sont dans `app/js/analysis.js` (`SEUILS`).
Après une modification de fichiers de l'app, incrémenter `VERSION` dans `app/sw.js`.
