import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { geoNaturalEarth1 } from 'd3-geo';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import MVT from 'ol/format/MVT.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, 'map-renderer', '.cache', 'geoboundaries');
const output = path.join(root, 'map-renderer', '.cache', 'high-zoom', 'v2', 'admin');
const work = path.join(root, 'map-renderer', '.cache', 'admin-pmtiles-work');
const projection = geoNaturalEarth1().precision(.18).fitExtent([[191.4, 191.4], [8000.6, 3904.6]], { type: 'Sphere' });
const minArchiveZoom = 6;
const maxArchiveZoom = 11;
const SQL = await initSqlJs({ locateFile: (file) => path.join(root, 'node_modules', 'sql.js', 'dist', file) });

if (!output.startsWith(path.join(root, 'map-renderer', '.cache'))) throw new Error('Unsafe admin tile path');
await mkdir(output, { recursive: true });
await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });

const explicitBin = process.env.PMTILES_BIN;
let pmtilesBin = explicitBin ? path.resolve(explicitBin) : '';
if (!pmtilesBin) {
  const toolRoot = path.join(root, 'map-renderer', '.cache', 'tools');
  for (const directory of await readdir(toolRoot, { withFileTypes: true }).catch(() => [])) {
    if (!directory.isDirectory()) continue;
    const candidate = path.join(toolRoot, directory.name, process.platform === 'win32' ? 'pmtiles.exe' : 'pmtiles');
    if ((await stat(candidate).catch(() => null))?.isFile()) { pmtilesBin = candidate; break; }
  }
}
if (!pmtilesBin) throw new Error('PMTiles CLI not found. Set PMTILES_BIN or place it under map-renderer/.cache/tools/.');

function projectCoordinate(coordinate) {
  const projected = projection(coordinate);
  if (!projected) return [0, 0];
  const normalizedX = projected[0] / 8192;
  const normalizedY = projected[1] / 8192;
  const fakeLng = normalizedX * 360 - 180;
  const fakeLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * normalizedY))) * 180 / Math.PI;
  return [fakeLng, fakeLat];
}

function projectLine(line) { return line.map(projectCoordinate); }

function polygonLines(geometry) {
  if (geometry?.type === 'Polygon') return geometry.coordinates.map(projectLine);
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.flatMap((polygon) => polygon.map(projectLine));
  return [];
}

function boundaryCollection(collection, level) {
  const features = [];
  for (const feature of collection.features || []) {
    const coordinates = polygonLines(feature.geometry);
    if (!coordinates.length) continue;
    const properties = feature.properties || {};
    features.push({
      type: 'Feature',
      properties: {
        id: String(properties.shapeID || properties.ADM0_A3 || properties.adm1_code || properties.NAME || crypto.randomUUID()),
        level,
        name: String(properties.shapeName || properties.NAME || properties.name || '')
      },
      geometry: { type: 'MultiLineString', coordinates }
    });
  }
  return { type: 'FeatureCollection', features };
}

function sourceBbox(collection) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === 'number') {
      bbox[0] = Math.min(bbox[0], coordinates[0]);
      bbox[1] = Math.min(bbox[1], coordinates[1]);
      bbox[2] = Math.max(bbox[2], coordinates[0]);
      bbox[3] = Math.max(bbox[3], coordinates[1]);
      return;
    }
    for (const child of coordinates) visit(child);
  };
  for (const feature of collection.features || []) visit(feature.geometry?.coordinates);
  return bbox;
}

async function createMbtiles(filename, name, collection) {
  const tileIndex = geojsonvt(collection, {
    maxZoom: maxArchiveZoom,
    indexMaxZoom: maxArchiveZoom,
    indexMaxPoints: 0,
    tolerance: 2.4,
    extent: 4096,
    buffer: 80,
    lineMetrics: false
  });
  const database = new SQL.Database();
  database.run('CREATE TABLE metadata (name TEXT, value TEXT); CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB); CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);');
  const metadata = database.prepare('INSERT INTO metadata (name,value) VALUES (?,?)');
  const values = {
    name,
    type: 'overlay',
    version: '1',
    description: 'ysoseri Natural Earth 1 administrative ink',
    format: 'pbf',
    minzoom: String(minArchiveZoom),
    maxzoom: String(maxArchiveZoom),
    bounds: '-180,-85.0511,180,85.0511',
    json: JSON.stringify({ vector_layers: [{ id: 'boundaries', fields: { id: 'String', level: 'String', name: 'String' }, minzoom: minArchiveZoom, maxzoom: maxArchiveZoom }] })
  };
  database.run('BEGIN');
  Object.entries(values).forEach(([key, value]) => metadata.run([key, value]));
  metadata.free();
  database.run('COMMIT');
  const insertTile = database.prepare('INSERT OR REPLACE INTO tiles (zoom_level,tile_column,tile_row,tile_data) VALUES (?,?,?,?)');
  const indexedTiles = Object.values(tileIndex.tiles).filter((tile) => tile.z >= minArchiveZoom && tile.z <= maxArchiveZoom && tile.features?.length);
  const format = new MVT();
  let verifiedGeometry = false;
  database.run('BEGIN');
  for (const indexedTile of indexedTiles) {
    const tile = tileIndex.getTile(indexedTile.z, indexedTile.x, indexedTile.y);
    if (!tile?.features?.length) continue;
    const data = vtpbf.fromGeojsonVt({ boundaries: tile });
    if (!verifiedGeometry) {
      const decoded = format.readFeatures(data, { extent: [0, 0, 4096, 4096] });
      verifiedGeometry = decoded.some((feature) => {
        const extent = feature.getGeometry()?.getExtent();
        return extent && (extent[2] > extent[0] || extent[3] > extent[1]);
      });
    }
    insertTile.run([tile.z, tile.x, (2 ** tile.z) - 1 - tile.y, new Uint8Array(data)]);
  }
  insertTile.free();
  database.run('COMMIT');
  if (!verifiedGeometry) throw new Error(`${name}: encoded MVT geometry is degenerate`);
  const exported = database.export();
  database.close();
  await writeFile(filename, exported);
  return indexedTiles.length;
}

async function convert(name, collection) {
  const mbtiles = path.join(work, `${name}.mbtiles`);
  const target = path.join(output, `${name}.pmtiles`);
  const count = await createMbtiles(mbtiles, name, collection);
  await execFileAsync(pmtilesBin, ['convert', '--force', mbtiles, target], { maxBuffer: 8 * 1024 * 1024 });
  await rm(mbtiles, { force: true });
  const size = (await stat(target)).size;
  console.log(`${name}: ${count} tiles, ${size} bytes`);
  return { file: `${name}.pmtiles`, tiles: count, bytes: size };
}

const adm0 = JSON.parse(await readFile(path.join(cache, 'natural-earth-adm0.geojson'), 'utf8'));
const adm1 = JSON.parse(await readFile(path.join(cache, 'natural-earth-adm1.geojson'), 'utf8'));
const globalCollection = {
  type: 'FeatureCollection',
  features: [
    ...boundaryCollection(adm0, 'ADM0').features,
    ...boundaryCollection(adm1, 'ADM1').features
  ]
};
const manifest = { version: 1, archiveZoomOffset: 1, global: await convert('global', globalCollection), countries: {} };

const requested = (process.env.ADMIN_COUNTRIES || '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
const countryMap = JSON.parse(await readFile(path.join(root, 'map-renderer', '.cache', 'high-zoom', 'v2', 'regions', 'countries.json'), 'utf8')).countries;
const files = (await readdir(path.join(cache, 'adm2'))).filter((file) => file.endsWith('.geojson')).sort();
for (const file of files) {
  const iso3 = path.basename(file, '.geojson').toUpperCase();
  const country = Object.values(countryMap).find((item) => item.iso3 === iso3);
  if (!country || (requested.length && !requested.includes(country.iso2) && !requested.includes(iso3))) continue;
  const source = JSON.parse(await readFile(path.join(cache, 'adm2', file), 'utf8'));
  const collection = boundaryCollection(source, 'ADM2');
  manifest.countries[country.iso2] = { iso2: country.iso2, iso3, bbox: sourceBbox(source), ...(await convert(country.iso2, collection)) };
}

await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await rm(work, { recursive: true, force: true });
console.log(`administrative PMTiles ready: ${Object.keys(manifest.countries).length} countries`);
