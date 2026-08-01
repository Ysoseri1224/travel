import { createCanvas } from '@napi-rs/canvas';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const travelDir = path.resolve(rootDir, '..');
const paperSource = path.join(rootDir, 'assets', 'parchment-00.jpg');
const worldPreview = path.join(travelDir, 'previews', 'world-parchment-v1.webp');
const outputDir = path.join(travelDir, 'assets', 'paper-props', 'v1');
await mkdir(outputDir, { recursive: true });

const assets = [
  {
    id: 'note-warm-square',
    kind: 'note',
    width: 2048,
    height: 2048,
    margin: 44,
    edgeJitter: 7,
    seed: 1974,
    tint: '#d6aa61',
    wash: 'rgba(224, 184, 105, 0.34)',
    safeArea: { x: 238, y: 260, width: 1572, height: 1498 }
  },
  {
    id: 'photo-classic',
    kind: 'photo',
    width: 2048,
    height: 2560,
    margin: 42,
    edgeJitter: 5,
    seed: 2974,
    tint: '#e7ddc8',
    wash: 'rgba(244, 238, 224, 0.7)',
    contentWindow: { x: 184, y: 184, width: 1680, height: 1680 },
    captionArea: { x: 238, y: 1960, width: 1572, height: 342 }
  },
  {
    id: 'photo-landscape',
    kind: 'photo',
    width: 3072,
    height: 2304,
    margin: 48,
    edgeJitter: 6,
    seed: 3974,
    tint: '#e7ddc8',
    wash: 'rgba(244, 238, 224, 0.7)',
    contentWindow: { x: 220, y: 220, width: 2632, height: 1480 },
    captionArea: { x: 280, y: 1788, width: 2512, height: 292 }
  },
  {
    id: 'photo-portrait',
    kind: 'photo',
    width: 2304,
    height: 3072,
    margin: 44,
    edgeJitter: 5,
    seed: 4974,
    tint: '#e7ddc8',
    wash: 'rgba(244, 238, 224, 0.7)',
    contentWindow: { x: 188, y: 188, width: 1928, height: 2410 },
    captionArea: { x: 252, y: 2680, width: 1800, height: 194 }
  }
];

function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function edgePoints(spec) {
  const { width, height, margin, edgeJitter, seed } = spec;
  const random = randomFor(seed);
  const points = [];
  const step = Math.max(44, Math.round(Math.min(width, height) / 28));
  const walk = (length, fixed, horizontal, reverse = false) => {
    const count = Math.ceil(length / step);
    let drift = 0;
    for (let index = 0; index <= count; index += 1) {
      const t = reverse ? 1 - index / count : index / count;
      drift = drift * 0.72 + (random() - 0.5) * edgeJitter;
      const position = margin + length * t;
      const offset = drift + (random() - 0.5) * edgeJitter * 0.7;
      points.push(horizontal ? [position, fixed + offset] : [fixed + offset, position]);
    }
  };
  walk(width - margin * 2, margin, true);
  walk(height - margin * 2, width - margin, false);
  walk(width - margin * 2, height - margin, true, true);
  walk(height - margin * 2, margin, false, true);
  return points;
}

function tracePolygon(context, points) {
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) context.lineTo(x, y);
  context.closePath();
}

function paperMask(spec) {
  const canvas = createCanvas(spec.width, spec.height);
  const context = canvas.getContext('2d');
  tracePolygon(context, edgePoints(spec));
  context.fillStyle = '#fff';
  context.fill();
  if (spec.contentWindow) {
    const { x, y, width, height } = spec.contentWindow;
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = '#000';
    context.fillRect(x, y, width, height);
  }
  return canvas.toBuffer('image/png');
}

function surfaceDetail(spec) {
  const canvas = createCanvas(spec.width, spec.height);
  const context = canvas.getContext('2d');
  const random = randomFor(spec.seed + 73);

  context.lineCap = 'round';
  const fiberCount = Math.round((spec.width * spec.height) / 6500);
  for (let index = 0; index < fiberCount; index += 1) {
    const x = random() * spec.width;
    const y = random() * spec.height;
    const length = 5 + random() * 24;
    const slope = (random() - 0.5) * 4;
    context.strokeStyle = random() > 0.48
      ? `rgba(91, 67, 42, ${0.012 + random() * 0.026})`
      : `rgba(255, 248, 227, ${0.018 + random() * 0.032})`;
    context.lineWidth = 0.45 + random() * 1.15;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y + slope);
    context.stroke();
  }

  const speckCount = Math.round((spec.width * spec.height) / 18000);
  for (let index = 0; index < speckCount; index += 1) {
    const radius = 0.4 + random() * 1.8;
    context.fillStyle = `rgba(82, 58, 35, ${0.018 + random() * 0.028})`;
    context.beginPath();
    context.arc(random() * spec.width, random() * spec.height, radius, 0, Math.PI * 2);
    context.fill();
  }

  return canvas.toBuffer('image/png');
}

function edgeTone(spec) {
  const canvas = createCanvas(spec.width, spec.height);
  const context = canvas.getContext('2d');
  tracePolygon(context, edgePoints(spec));
  context.strokeStyle = spec.kind === 'note' ? 'rgba(78, 52, 25, 0.17)' : 'rgba(72, 57, 40, 0.13)';
  context.lineWidth = 7;
  context.stroke();
  if (spec.contentWindow) {
    const { x, y, width, height } = spec.contentWindow;
    context.strokeStyle = 'rgba(76, 60, 43, 0.2)';
    context.lineWidth = 8;
    context.strokeRect(x, y, width, height);
  }
  return canvas.toBuffer('image/png');
}

async function renderAsset(spec) {
  const mask = paperMask(spec);
  const detail = surfaceDetail(spec);
  const edges = edgeTone(spec);
  const wash = await sharp({
    create: { width: spec.width, height: spec.height, channels: 4, background: spec.wash }
  }).png().toBuffer();

  const output = await sharp(paperSource)
    .resize(spec.width, spec.height, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .modulate({ brightness: spec.kind === 'note' ? 1.08 : 1.14, saturation: spec.kind === 'note' ? 0.68 : 0.2 })
    .tint(spec.tint)
    .ensureAlpha()
    .composite([
      { input: wash, blend: 'over' },
      { input: detail, blend: 'multiply' },
      { input: edges, blend: 'multiply' },
      { input: mask, blend: 'dest-in' }
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  const pngName = `${spec.id}-v1.png`;
  const webpName = `${spec.id}-v1.webp`;
  await writeFile(path.join(outputDir, pngName), output);
  await sharp(output).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(path.join(outputDir, webpName));
  return { ...spec, png: pngName, webp: webpName };
}

async function mediaUnderlay(spec) {
  if (!spec.contentWindow) return null;
  const { x, y, width, height } = spec.contentWindow;
  const crop = await sharp(worldPreview)
    .extract({ left: 148, top: 148, width: 7896, height: 3800 })
    .resize(width, height, { fit: 'cover' })
    .modulate({ brightness: 0.76, saturation: 0.82 })
    .webp({ quality: 82 })
    .toBuffer();
  return sharp({
    create: { width: spec.width, height: spec.height, channels: 4, background: 'rgba(0,0,0,0)' }
  }).composite([{ input: crop, left: x, top: y }]).png().toBuffer();
}

async function renderContactSheet(rendered) {
  const width = 4096;
  const height = 2732;
  const background = await sharp(paperSource)
    .resize(width, height, { fit: 'cover' })
    .modulate({ brightness: 0.62, saturation: 0.52 })
    .tint('#756047')
    .png()
    .toBuffer();
  const placements = [
    { id: 'note-warm-square', x: 210, y: 260, width: 1180 },
    { id: 'photo-classic', x: 1480, y: 180, width: 860 },
    { id: 'photo-landscape', x: 2180, y: 220, width: 1640 },
    { id: 'photo-portrait', x: 2700, y: 1210, width: 840 }
  ];
  const layers = [{ input: background, left: 0, top: 0 }];
  for (const placement of placements) {
    const spec = rendered.find((item) => item.id === placement.id);
    const scaledHeight = Math.round(spec.height * placement.width / spec.width);
    const underlay = await mediaUnderlay(spec);
    if (underlay) {
      layers.push({
        input: await sharp(underlay).resize(placement.width, scaledHeight).png().toBuffer(),
        left: placement.x,
        top: placement.y
      });
    }
    layers.push({
      input: await sharp(path.join(outputDir, spec.webp)).resize(placement.width, scaledHeight).png().toBuffer(),
      left: placement.x,
      top: placement.y
    });
  }
  await sharp({
    create: { width, height, channels: 4, background: '#2b241d' }
  }).composite(layers).webp({ quality: 90, effort: 6 }).toFile(path.join(outputDir, 'paper-props-v1-preview.webp'));
}

const rendered = [];
for (const spec of assets) {
  rendered.push(await renderAsset(spec));
  console.log(`${spec.id}: ${spec.width}x${spec.height}`);
}
await renderContactSheet(rendered);

const manifest = {
  version: 1,
  source: 'map-renderer/assets/parchment-00.jpg',
  dynamicEffects: ['shadow', 'rotation', 'pin', 'hover-lift'],
  assets: rendered.map(({ seed, tint, wash, edgeJitter, margin, ...asset }) => asset)
};
await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
