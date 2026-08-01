import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const outputDir = path.resolve(rootDir, '..', 'assets', 'paper-props', 'v1');
const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function inside(rect, width, height) {
  return rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= width && rect.y + rect.height <= height;
}

async function alphaAt(file, x, y) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .extract({ left: Math.floor(x), top: Math.floor(y), width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data[info.channels - 1];
}

for (const asset of manifest.assets) {
  const pngPath = path.join(outputDir, asset.png);
  const webpPath = path.join(outputDir, asset.webp);
  const png = await sharp(pngPath).metadata();
  const webp = await sharp(webpPath).metadata();
  assert(png.width === asset.width && png.height === asset.height, `${asset.id}: PNG dimensions mismatch`);
  assert(webp.width === asset.width && webp.height === asset.height, `${asset.id}: WebP dimensions mismatch`);
  assert(png.hasAlpha && webp.hasAlpha, `${asset.id}: alpha channel missing`);
  assert((await alphaAt(pngPath, 0, 0)) === 0, `${asset.id}: outer corner must be transparent`);
  assert((await alphaAt(pngPath, asset.width / 2, 64)) >= 240, `${asset.id}: paper surface is unexpectedly transparent`);
  assert((await stat(pngPath)).size < 90 * 1024 * 1024, `${asset.id}: PNG exceeds GitHub file limit guard`);

  if (asset.safeArea) assert(inside(asset.safeArea, asset.width, asset.height), `${asset.id}: invalid safe area`);
  if (asset.captionArea) assert(inside(asset.captionArea, asset.width, asset.height), `${asset.id}: invalid caption area`);
  if (asset.contentWindow) {
    assert(inside(asset.contentWindow, asset.width, asset.height), `${asset.id}: invalid content window`);
    const centerX = asset.contentWindow.x + asset.contentWindow.width / 2;
    const centerY = asset.contentWindow.y + asset.contentWindow.height / 2;
    assert((await alphaAt(pngPath, centerX, centerY)) === 0, `${asset.id}: content window must be transparent`);
    assert((await alphaAt(webpPath, centerX, centerY)) === 0, `${asset.id}: WebP content window must be transparent`);
  }
  console.log(`${asset.id}: verified`);
}
