import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const cacheDir = path.join(rootDir, '.cache', 'geoboundaries');
const apiBase = 'https://www.geoboundaries.org/api/current/gbOpen';
const levels = ['ADM0', 'ADM1', 'ADM2'];
const concurrency = 6;
const naturalEarthSources = {
  ADM0: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson',
  ADM1: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson'
};
const supplementalSources = {
  'gadm/CHN-ADM2.geojson': 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_CHN_2.json'
};

await mkdir(cacheDir, { recursive: true });

function rawGithubUrl(url) {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/);
  return match
    ? `https://media.githubusercontent.com/media/${match[1]}/${match[2]}/${match[3]}/${match[4]}`
    : url;
}

async function fetchJson(url, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'ysoseri-travel-map-renderer/0.1' }
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message ?? 'unknown error'}`);
}

async function runPool(items, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function getMetadata(level) {
  const file = path.join(cacheDir, `${level.toLowerCase()}-metadata.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const metadata = await fetchJson(`${apiBase}/ALL/${level}/`);
  await writeFile(file, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

async function downloadLevel(level) {
  const metadata = await getMetadata(level);
  const levelDir = path.join(cacheDir, level.toLowerCase());
  const combined = path.join(cacheDir, `${level.toLowerCase()}.geojson`);
  await mkdir(levelDir, { recursive: true });
  let completed = 0;

  await runPool(metadata, async (entry) => {
    const target = path.join(levelDir, `${entry.boundaryISO}.geojson`);
    if (!existsSync(target)) {
      const url = rawGithubUrl(entry.simplifiedGeometryGeoJSON || entry.gjDownloadURL);
      const geojson = await fetchJson(url);
      const features = (geojson.features || []).map((feature) => ({
        ...feature,
        properties: {
          ...(feature.properties || {}),
          __boundaryISO: entry.boundaryISO,
          __boundaryLevel: level,
          __boundaryYear: entry.boundaryYearRepresented
        }
      }));
      await writeFile(target, JSON.stringify({ type: 'FeatureCollection', features }));
    }
    completed += 1;
    if (completed % 20 === 0 || completed === metadata.length) {
      console.log(`${level}: ${completed}/${metadata.length}`);
    }
  });

  if (existsSync(combined)) {
    console.log(`${level}: cached`);
    return metadata;
  }

  const combinedFeatures = [];
  for (const entry of metadata) {
    const file = path.join(levelDir, `${entry.boundaryISO}.geojson`);
    if (!existsSync(file)) continue;
    const collection = JSON.parse(await readFile(file, 'utf8'));
    combinedFeatures.push(...(collection.features || []));
  }

  await writeFile(combined, JSON.stringify({ type: 'FeatureCollection', features: combinedFeatures }));
  console.log(`${level}: combined ${combinedFeatures.length} features`);
  return metadata;
}

const allMetadata = {};
for (const level of levels) {
  allMetadata[level] = await downloadLevel(level);
}

const attribution = {
  dataset: 'geoBoundaries gbOpen',
  api: apiBase,
  fetchedAt: new Date().toISOString(),
  note: 'Per-country source, year and license metadata are retained below.',
  levels: Object.fromEntries(levels.map((level) => [
    level,
    allMetadata[level].map((entry) => ({
      boundaryISO: entry.boundaryISO,
      boundaryName: entry.boundaryName,
      boundaryYearRepresented: entry.boundaryYearRepresented,
      boundaryCanonical: entry.boundaryCanonical,
      boundarySource: entry.boundarySource,
      boundaryLicense: entry.boundaryLicense,
      licenseSource: entry.licenseSource,
      sourceDataUpdateDate: entry.sourceDataUpdateDate,
      buildDate: entry.buildDate
    }))
  ]))
};

await writeFile(path.join(cacheDir, 'attribution.json'), `${JSON.stringify(attribution, null, 2)}\n`);

for (const [level, url] of Object.entries(naturalEarthSources)) {
  const target = path.join(cacheDir, `natural-earth-${level.toLowerCase()}.geojson`);
  if (!existsSync(target)) {
    const geojson = await fetchJson(url);
    await writeFile(target, JSON.stringify(geojson));
  }
}

for (const [relativePath, url] of Object.entries(supplementalSources)) {
  const target = path.join(cacheDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  if (!existsSync(target)) {
    const geojson = await fetchJson(url);
    await writeFile(target, JSON.stringify(geojson));
  }
}
console.log('geoBoundaries data ready.');
