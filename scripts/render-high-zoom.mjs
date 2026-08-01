import { mkdir, opendir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'map-renderer', '.cache', 'superres', 'world-paper-16k-residual-v1.png');
const output = path.join(root, 'map-renderer', '.cache', 'high-zoom', 'v2');
const stage = path.join(root, 'map-renderer', '.cache', 'high-zoom-stage');
const tileSize = 256;

if (!(await stat(source).catch(() => null))?.isFile()) {
  throw new Error(`Missing accepted super-resolution source: ${source}`);
}
if (!output.startsWith(path.join(root, 'map-renderer', '.cache'))) throw new Error('Unsafe high-zoom output path');

await rm(path.join(output, 'paper'), { recursive: true, force: true });
await rm(path.join(output, 'detail'), { recursive: true, force: true });
await rm(stage, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mkdir(stage, { recursive: true });

await sharp(source)
  .webp({ lossless: true, effort: 4 })
  .tile({ size: tileSize, overlap: 1, layout: 'dz', depth: 'one' })
  .toFile(path.join(stage, 'paper'));

const nativeLevel = path.join(stage, 'paper_files', '0');
const paperDir = path.join(output, 'paper', '5');
const entries = await opendir(nativeLevel);
let paperTiles = 0;
for await (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith('.webp')) continue;
  const match = entry.name.match(/^(\d+)_(\d+)\.webp$/);
  if (!match) continue;
  const xDir = path.join(paperDir, match[1]);
  await mkdir(xDir, { recursive: true });
  await rename(path.join(nativeLevel, entry.name), path.join(xDir, `${match[2]}.webp`));
  paperTiles += 1;
}

async function mirroredAtlas(size, left, top) {
  const half = size / 2;
  const base = await sharp(source).extract({ left, top, width: half, height: half }).png().toBuffer();
  const horizontal = await sharp(base).flop().png().toBuffer();
  const vertical = await sharp(base).flip().png().toBuffer();
  const both = await sharp(base).flip().flop().png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: base, left: 0, top: 0 },
      { input: horizontal, left: half, top: 0 },
      { input: vertical, left: 0, top: half },
      { input: both, left: half, top: half }
    ])
    .png()
    .toBuffer();
}

async function detailOverlay(size, left, top, blurSigma, strength) {
  const atlas = await mirroredAtlas(size, left, top);
  const { data, info } = await sharp(atlas)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const blurred = await sharp(atlas).greyscale().blur(blurSigma).raw().toBuffer();
  const rgba = Buffer.allocUnsafe(info.width * info.height * 4);
  for (let index = 0; index < data.length; index += 1) {
    const delta = data[index] - blurred[index];
    const target = index * 4;
    if (delta < 0) {
      rgba[target] = 67;
      rgba[target + 1] = 47;
      rgba[target + 2] = 30;
      rgba[target + 3] = Math.min(82, Math.round(-delta * strength));
    } else {
      rgba[target] = 246;
      rgba[target + 1] = 232;
      rgba[target + 2] = 197;
      rgba[target + 3] = Math.min(56, Math.round(delta * strength * .72));
    }
  }
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

const detailSets = [
  { id: 'fiber', period: 4, left: 1112, top: 734, blurSigma: 4.2, strength: 3.1 },
  { id: 'pulp', period: 5, left: 8214, top: 2916, blurSigma: 1.8, strength: 4.8 },
  { id: 'grain', period: 7, left: 13726, top: 6044, blurSigma: .9, strength: 9.6 }
];

for (const detail of detailSets) {
  const size = detail.period * tileSize;
  const atlas = await detailOverlay(size, detail.left, detail.top, detail.blurSigma, detail.strength);
  for (let x = 0; x < detail.period; x += 1) {
    const xDir = path.join(output, 'detail', detail.id, String(x));
    await mkdir(xDir, { recursive: true });
    for (let y = 0; y < detail.period; y += 1) {
      await sharp(atlas)
        .extract({ left: x * tileSize, top: y * tileSize, width: tileSize, height: tileSize })
        .webp({ quality: 84, alphaQuality: 92, effort: 4 })
        .toFile(path.join(xDir, `${y}.webp`));
    }
  }
}

await writeFile(path.join(output, 'paper-manifest.json'), `${JSON.stringify({
  version: 'v2',
  source: path.basename(source),
  projection: 'Natural Earth 1',
  extent: [0, -4096, 8192, 0],
  macro: { zoom: 5, tileSize, gutter: 1, encoding: 'lossless-webp', columns: 64, rows: 32, tiles: paperTiles },
  details: detailSets.map(({ id, period }) => ({ id, period, tileSize }))
}, null, 2)}\n`);

await rm(stage, { recursive: true, force: true });
console.log(`high-zoom paper ready: ${paperTiles} macro tiles + ${detailSets.reduce((sum, item) => sum + item.period ** 2, 0)} detail tiles`);
