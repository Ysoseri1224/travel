import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoNaturalEarth1, geoPath } from 'd3-geo';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(await readFile(path.join(root, 'map-renderer', '.cache', 'geoboundaries', 'natural-earth-adm0.geojson'), 'utf8'));
const projection = geoNaturalEarth1().precision(.18).fitExtent([[191.4, 191.4], [8000.6, 3904.6]], { type: 'Sphere' });
const pathGenerator = geoPath(projection);
const wanted = new Set(['CHN', 'NZL']);
const features = [];
for (const feature of source.features || []) {
  const properties = feature.properties || {};
  const code = String(properties.ADM0_A3 || properties.ISO_A3 || '').toUpperCase();
  if (!wanted.has(code)) continue;
  features.push({
    type: 'Feature',
    properties: { countryCode: code === 'CHN' ? 'CN' : 'NZ', iso3: code, name: String(properties.NAME_EN || properties.NAME || code) },
    geometry: feature.geometry
  });
}
const output = { type: 'FeatureCollection', features };
await mkdir(path.join(root, 'public', 'maps'), { recursive: true });
await writeFile(path.join(root, 'public', 'maps', 'country-index-v1.geojson'), JSON.stringify(output));
console.log(`country index ready: ${features.length} features`);
