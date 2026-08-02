import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gzipAsync = promisify(gzip);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, 'map-renderer', '.cache', 'geoboundaries');
const adm2Dir = path.join(cache, 'adm2');
const output = path.join(root, 'map-renderer', '.cache', 'high-zoom', 'v2', 'regions');
const cellSize = 4;

if (!output.startsWith(path.join(root, 'map-renderer', '.cache'))) throw new Error('Unsafe region catalog path');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const countries = JSON.parse(await readFile(path.join(cache, 'natural-earth-adm0.geojson'), 'utf8'));
const iso3ToCountry = new Map();
for (const feature of countries.features || []) {
  const properties = feature.properties || {};
  const iso3 = String(properties.ADM0_A3 || properties.ISO_A3 || '').toUpperCase();
  const iso2 = String(properties.ISO_A2 || properties.POSTAL || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(iso3) || !/^[A-Z]{2}$/.test(iso2)) continue;
  iso3ToCountry.set(iso3, {
    iso2,
    iso3,
    nameEn: String(properties.NAME_EN || properties.NAME || iso3),
    nameZh: String(properties.NAME_ZH || properties.NAME_EN || properties.NAME || iso3)
  });
}

function visitCoordinates(coordinates, visit) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    visit(coordinates[0], coordinates[1]);
    return;
  }
  for (const child of coordinates) visitCoordinates(child, visit);
}

function geometryBbox(geometry) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  visitCoordinates(geometry?.coordinates, (lng, lat) => {
    bbox[0] = Math.min(bbox[0], lng);
    bbox[1] = Math.min(bbox[1], lat);
    bbox[2] = Math.max(bbox[2], lng);
    bbox[3] = Math.max(bbox[3], lat);
  });
  return bbox.every(Number.isFinite) ? bbox : null;
}

function cellFor(lng, lat) {
  return [Math.floor((lng + 180) / cellSize), Math.floor((lat + 90) / cellSize)];
}

function localName(value) {
  const names = String(value || '').split('|').map((item) => item.trim()).filter(Boolean);
  const name = names.at(-1) || '';
  return /^(?:na|<null>)$/i.test(name) ? '' : name;
}

const requested = (process.env.REGION_COUNTRIES || '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
const files = (await readdir(adm2Dir)).filter((file) => file.endsWith('.geojson') && (!requested.length || requested.includes(path.basename(file, '.geojson').toUpperCase()))).sort();
const catalogCountries = {};
let featureCount = 0;
let cellCount = 0;

for (const file of files) {
  const iso3 = path.basename(file, '.geojson').toUpperCase();
  const country = iso3ToCountry.get(iso3);
  if (!country) continue;
  const collection = JSON.parse(await readFile(path.join(adm2Dir, file), 'utf8'));
  const cells = new Map();
  const countryRegions = [];
  for (const feature of collection.features || []) {
    if (!feature.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) continue;
    const bbox = geometryBbox(feature.geometry);
    if (!bbox) continue;
    const properties = feature.properties || {};
    const sourceId = String(properties.shapeID || properties.GID_2 || properties.shapeISO || properties.shapeName || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]+/g, '-');
    const region = {
      id: `r1_${iso3.toLowerCase()}_${sourceId}`,
      name: String(properties.shapeName || properties.NAME_2 || sourceId),
      countryCode: country.iso2,
      countryIso3: iso3,
      sourceId,
      parentRegionId: String(properties.GID_1 || ''),
      parentNameEn: String(properties.NAME_1 || ''),
      parentNameZh: localName(properties.NL_NAME_1),
      bbox,
      centroid: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
      geometry: feature.geometry
    };
    countryRegions.push(region);
    const summary = {
      id: region.id,
      name: region.name,
      countryCode: region.countryCode,
      countryIso3: region.countryIso3,
      sourceId: region.sourceId,
      parentRegionId: region.parentRegionId,
      parentNameEn: region.parentNameEn,
      parentNameZh: region.parentNameZh,
      bbox: region.bbox,
      centroid: region.centroid
    };
    const [minX, minY] = cellFor(bbox[0], bbox[1]);
    const [maxX, maxY] = cellFor(bbox[2], bbox[3]);
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
      const key = `${x}/${y}`;
      const values = cells.get(key) || [];
      values.push(summary);
      cells.set(key, values);
    }
    featureCount += 1;
  }

  const countryDir = path.join(output, country.iso2);
  await mkdir(countryDir, { recursive: true });
  await writeFile(path.join(countryDir, 'catalog.json.gz'), await gzipAsync(JSON.stringify({ version: 1, regions: countryRegions }), { level: 7 }));
  for (const [key, regions] of cells) {
    const target = path.join(countryDir, `${key}.json.gz`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await gzipAsync(JSON.stringify({ version: 1, cellSize, regions }), { level: 7 }));
    cellCount += 1;
  }
  catalogCountries[country.iso2] = { ...country, regions: countryRegions.length, cells: cells.size };
  console.log(`${country.iso2}: ${collection.features?.length || 0} regions, ${cells.size} cells`);
}

await writeFile(path.join(output, 'countries.json'), `${JSON.stringify({ version: 1, cellSize, countries: catalogCountries }, null, 2)}\n`);
console.log(`region catalog ready: ${featureCount} regions in ${cellCount} cell files`);
