import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = JSON.parse(await readFile(path.join(root, 'map-renderer', 'output', 'country-build-input.json'), 'utf8'));
const version = String(process.env.COUNTRY_PACKAGE_VERSION || 'v1');
const source = path.join(root, 'map-renderer', 'output', `${input.id}-parchment-v1.webp`);
const packageRoot = path.join(root, 'country-build', input.countryCode);
const versionRoot = path.join(packageRoot, version);
await rm(packageRoot, { recursive: true, force: true });
await mkdir(versionRoot, { recursive: true });
const image = await readFile(source);
await copyFile(source, path.join(versionRoot, 'map.webp'));
const manifest = {
  schemaVersion: 1,
  countryCode: input.countryCode,
  iso3: input.iso3,
  name: { en: input.nameEn, zh: input.nameZh },
  status: 'ready',
  packageVersion: version,
  builtAt: new Date().toISOString(),
  projection: 'Natural Earth 1',
  bounds: input.bounds,
  baseZoom: 0,
  maxZoom: 14,
  keepsakesFromZoom: 5,
  raster: {
    key: `v3/countries/${input.countryCode}/${version}/map.webp`,
    width: 4096,
    height: 3072,
    bytes: (await stat(source)).size,
    sha256: createHash('sha256').update(image).digest('hex')
  },
  administrativeLevels: input.countryCode === 'CN'
    ? [{ from: 0, to: 14, level: 'ADM2-county' }]
    : input.countryCode === 'NZ'
      ? [{ from: 0, to: 2, level: 'Region' }, { from: 3, to: 14, level: 'Territorial Authority' }]
      : [{ from: 0, to: 4, level: 'ADM1' }, { from: 5, to: 14, level: 'ADM2' }],
  source: input.source,
  featureCounts: input.features
};
await writeFile(path.join(packageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`country package ready: ${input.countryCode}/${version}`);
