import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'previews', 'world-parchment-v1.webp');
const target = path.join(root, 'public', 'tiles', 'v1');
const manifestPath = path.join(target, 'manifest.json');
const sourceHash = createHash('sha256').update(await readFile(source)).digest('hex');
const tileSize = 256;
const levels = [
  { z: 0, width: 512, height: 256, resolution: 16 },
  { z: 1, width: 1024, height: 512, resolution: 8 },
  { z: 2, width: 2048, height: 1024, resolution: 4 },
  { z: 3, width: 4096, height: 2048, resolution: 2 },
  { z: 4, width: 8192, height: 4096, resolution: 1 }
];

try {
  const current = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (current.sourceSha256 === sourceHash && (await stat(path.join(target, '4', '31', '15.webp'))).isFile()) {
    console.log('tile pyramid is current');
    process.exit(0);
  }
} catch {
  // A missing or stale pyramid is rebuilt atomically from accepted source art.
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

for (const level of levels) {
  const { data, info } = await sharp(source)
    .resize(level.width, level.height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const columns = level.width / tileSize;
  const rows = level.height / tileSize;

  for (let x = 0; x < columns; x += 1) {
    const xDir = path.join(target, String(level.z), String(x));
    await mkdir(xDir, { recursive: true });
    for (let y = 0; y < rows; y += 1) {
      const tile = Buffer.allocUnsafe(tileSize * tileSize * info.channels);
      for (let row = 0; row < tileSize; row += 1) {
        const sourceStart = (((y * tileSize + row) * level.width) + x * tileSize) * info.channels;
        const targetStart = row * tileSize * info.channels;
        data.copy(tile, targetStart, sourceStart, sourceStart + tileSize * info.channels);
      }
      await sharp(tile, { raw: { width: tileSize, height: tileSize, channels: info.channels } })
        .webp({ quality: 86, effort: 4 })
        .toFile(path.join(xDir, `${y}.webp`));
    }
  }
  console.log(`tiles z${level.z}: ${columns}x${rows}`);
}

await writeFile(manifestPath, `${JSON.stringify({
  version: 'v1',
  source: 'world-parchment-v1.webp',
  sourceSha256: sourceHash,
  projection: 'Natural Earth 1',
  extent: [0, -4096, 8192, 0],
  tileSize,
  levels
}, null, 2)}\n`);
