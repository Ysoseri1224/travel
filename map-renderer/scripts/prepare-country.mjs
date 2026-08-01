import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache', 'geoboundaries');
const countryCode = String(process.env.COUNTRY_CODE || '').trim().toUpperCase();
if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('COUNTRY_CODE must be an ISO-3166 alpha-2 code');

const apiBase = 'https://www.geoboundaries.org/api/current/gbOpen';
const naturalEarthUrl = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const fixedBounds = {
  CN: [73.5, 18, 135.1, 53.6],
  NZ: [165, -48, 179.5, -33]
};

async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'ysoseri-travel-country-builder/1.0' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`Unable to fetch ${url}: ${lastError?.message || 'unknown error'}`);
}

function rawGithubUrl(url) {
  const match = String(url).match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/);
  return match ? `https://media.githubusercontent.com/media/${match[1]}/${match[2]}/${match[3]}/${match[4]}` : url;
}

function visitCoordinates(coordinates, visit) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    visit(coordinates[0], coordinates[1]);
    return;
  }
  for (const child of coordinates) visitCoordinates(child, visit);
}

function collectionBounds(collection) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const feature of collection.features || []) visitCoordinates(feature.geometry?.coordinates, (lng, lat) => {
    bbox[0] = Math.min(bbox[0], lng);
    bbox[1] = Math.min(bbox[1], lat);
    bbox[2] = Math.max(bbox[2], lng);
    bbox[3] = Math.max(bbox[3], lat);
  });
  if (!bbox.every(Number.isFinite)) throw new Error('Country geometry has no usable bounds');
  const horizontal = Math.max(1, bbox[2] - bbox[0]);
  const vertical = Math.max(1, bbox[3] - bbox[1]);
  return [
    Math.max(-180, bbox[0] - horizontal * .08),
    Math.max(-85, bbox[1] - vertical * .08),
    Math.min(180, bbox[2] + horizontal * .08),
    Math.min(85, bbox[3] + vertical * .08)
  ];
}

await mkdir(cache, { recursive: true });
await mkdir(path.join(root, 'output'), { recursive: true });
const naturalEarth = await fetchJson(naturalEarthUrl);
const countryFeature = (naturalEarth.features || []).find((feature) => {
  const properties = feature.properties || {};
  return [properties.ISO_A2, properties.ISO_A2_EH].map(String).map((value) => value.toUpperCase()).includes(countryCode);
}) || (naturalEarth.features || []).find((feature) => {
  const properties = feature.properties || {};
  return String(properties.POSTAL || '').toUpperCase() === countryCode && String(properties.ISO_A2 || '') === '-99';
});
if (!countryFeature) throw new Error(`Country ${countryCode} is absent from the Natural Earth catalog`);
const properties = countryFeature.properties || {};
const iso3 = [properties.ISO_A3_EH, properties.ISO_A3, properties.ADM0_A3]
  .map((value) => String(value || '').toUpperCase())
  .find((value) => /^[A-Z]{3}$/.test(value) && value !== '-99') || '';
if (!/^[A-Z]{3}$/.test(iso3)) throw new Error(`Country ${countryCode} has no ISO alpha-3 mapping`);
const renderLayers = countryCode === 'CN' ? ['ADM0', 'ADM2'] : ['ADM0', 'ADM1', 'ADM2'];

const downloaded = {};
for (const level of ['ADM0', 'ADM1', 'ADM2']) {
  const directory = path.join(cache, level.toLowerCase());
  await mkdir(directory, { recursive: true });
  let collection;
  if (iso3 === 'CHN' && level === 'ADM2') {
    collection = await fetchJson('https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_CHN_2.json');
  } else {
    const metadata = await fetchJson(`${apiBase}/ALL/${level}/`);
    const entry = metadata.find((item) => String(item.boundaryISO || '').toUpperCase() === iso3);
    if (!entry) throw new Error(`${level} data is unavailable for ${iso3}`);
    collection = await fetchJson(rawGithubUrl(entry.simplifiedGeometryGeoJSON || entry.gjDownloadURL));
  }
  const target = path.join(directory, `${iso3}.geojson`);
  await writeFile(target, JSON.stringify(collection));
  downloaded[level] = { features: collection.features?.length || 0, target };
}

const adm0 = JSON.parse(await (await import('node:fs/promises')).readFile(downloaded.ADM0.target, 'utf8'));
const bounds = fixedBounds[countryCode] || collectionBounds(adm0);
const id = `country-${countryCode.toLowerCase()}`;
const config = {
  seed: 974,
  paper: { source: 'assets/parchment-00.jpg', tint: '#d2b684' },
  palette: { outside: '#2b241d', land: '#9f815f', countryInk: '#34271e', provinceInk: '#584432', districtInk: '#725d47' },
  previews: [{ id, title: String(properties.NAME_EN || properties.NAME || iso3), width: 4096, height: 3072, bounds, layers: renderLayers, source: 'geoboundaries', countries: [iso3], paperMargin: 96 }]
};
await mkdir(path.join(root, 'config'), { recursive: true });
await writeFile(path.join(root, 'config', 'country-render.json'), `${JSON.stringify(config, null, 2)}\n`);
await writeFile(path.join(root, 'output', 'country-build-input.json'), `${JSON.stringify({
  countryCode,
  iso3,
  nameEn: String(properties.NAME_EN || properties.NAME || iso3),
  nameZh: String(properties.NAME_ZH || properties.NAME_EN || properties.NAME || iso3),
  bounds,
  id,
  source: countryCode === 'CN' ? 'geoBoundaries gbOpen ADM0/ADM1 + GADM 4.1 ADM2; ADM1 omitted from raster to avoid source-boundary drift' : 'geoBoundaries gbOpen',
  features: Object.fromEntries(Object.entries(downloaded).map(([level, item]) => [level, item.features]))
}, null, 2)}\n`);
console.log(`country render prepared: ${countryCode} (${iso3})`);
