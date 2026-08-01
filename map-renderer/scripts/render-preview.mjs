import { createCanvas, Path2D } from '@napi-rs/canvas';
import { geoArea, geoNaturalEarth1, geoPath } from 'd3-geo';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const configPath = process.env.RENDER_CONFIG
  ? path.resolve(rootDir, process.env.RENDER_CONFIG)
  : process.env.COUNTRY_CODE
    ? path.join(rootDir, 'config', 'country-render.json')
  : path.join(rootDir, 'config', 'render.config.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const cacheDir = path.join(rootDir, '.cache', 'geoboundaries');
const outputDir = path.join(rootDir, 'output');
await mkdir(outputDir, { recursive: true });

const sourceCache = new Map();

function normalizePolygonWinding(geometry) {
  const normalizePolygon = (coordinates) => {
    const polygon = { type: 'Polygon', coordinates };
    if (geoArea(polygon) > Math.PI * 2) {
      for (const ring of coordinates) ring.reverse();
    }
  };
  if (geometry?.type === 'Polygon') normalizePolygon(geometry.coordinates);
  if (geometry?.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) normalizePolygon(polygon);
  }
}

async function collectionFor(preview, level) {
  const key = `${preview.source}:${level}:${(preview.countries || []).join(',')}`;
  if (sourceCache.has(key)) return sourceCache.get(key);

  let collection;
  if (preview.overrides?.[level]) {
    collection = JSON.parse(await readFile(path.join(cacheDir, preview.overrides[level]), 'utf8'));
  } else if (preview.source === 'natural-earth') {
    collection = JSON.parse(await readFile(path.join(cacheDir, `natural-earth-${level.toLowerCase()}.geojson`), 'utf8'));
    if (level === 'ADM0') {
      collection.features = collection.features.filter((feature) => feature.properties?.ADM0_A3 !== 'ATA');
    }
  } else {
    const features = [];
    for (const country of preview.countries || []) {
      const file = path.join(cacheDir, level.toLowerCase(), `${country}.geojson`);
      const countryCollection = JSON.parse(await readFile(file, 'utf8'));
      features.push(...(countryCollection.features || []));
    }
    collection = { type: 'FeatureCollection', features };
  }

  for (const feature of collection.features || []) normalizePolygonWinding(feature.geometry);
  sourceCache.set(key, collection);
  return collection;
}

function projectionFor(bounds, width, height, margin) {
  const [west, south, east, north] = bounds;
  if (west === -180 && east === 180) {
    return geoNaturalEarth1()
      .precision(0.18)
      .fitExtent([[margin, margin], [width - margin, height - margin]], { type: 'Sphere' });
  }

  const rawProjection = geoNaturalEarth1().scale(1).translate([0, 0]);
  const projected = [];
  const samples = 64;
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const lon = west + (east - west) * t;
    const lat = south + (north - south) * t;
    projected.push(rawProjection([lon, south]), rawProjection([lon, north]));
    projected.push(rawProjection([west, lat]), rawProjection([east, lat]));
  }
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(
    (width - margin * 2) / (maxX - minX),
    (height - margin * 2) / (maxY - minY)
  );
  const contentWidth = (maxX - minX) * scale;
  const contentHeight = (maxY - minY) * scale;
  return geoNaturalEarth1()
    .scale(scale)
    .translate([
      margin + (width - margin * 2 - contentWidth) / 2 - minX * scale,
      margin + (height - margin * 2 - contentHeight) / 2 - minY * scale
    ])
    .precision(0.18);
}

function rgba(hex, alpha) {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawFill(collection, projection, width, height, color) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const pathData = geoPath(projection).digits(2)(collection);
  const shape = new Path2D(pathData || '');
  context.fillStyle = color;
  context.fill(shape);
  return canvas.toBuffer('image/png');
}

function drawInk(collection, projection, width, height, style) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const pathData = geoPath(projection).digits(2)(collection);
  const shape = new Path2D(pathData || '');
  context.lineCap = 'round';
  context.lineJoin = 'round';

  const passes = [
    { dx: 0.42, dy: -0.28, width: style.width * 1.34, alpha: style.alpha * 0.12 },
    { dx: -0.26, dy: 0.34, width: style.width * 0.86, alpha: style.alpha * 0.18 },
    { dx: 0, dy: 0, width: style.width, alpha: style.alpha }
  ];

  for (const pass of passes) {
    context.save();
    context.translate(pass.dx, pass.dy);
    context.strokeStyle = rgba(style.color, pass.alpha);
    context.lineWidth = pass.width;
    context.stroke(shape);
    context.restore();
  }
  return canvas.toBuffer('image/png');
}

function edgeMask(width, height, margin, seed) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const step = Math.max(5, Math.round(Math.min(width, height) / 680));
  const jitter = Math.max(5, Math.round(margin * 0.09));
  const points = [];
  const walk = (count) => {
    const values = [];
    let drift = 0;
    for (let index = 0; index <= count; index += 1) {
      drift = drift * 0.9 + (random() - 0.5) * jitter * 0.32;
      values.push(drift + (random() - 0.5) * 1.4);
    }
    values[0] = 0;
    values[values.length - 1] = 0;
    return values;
  };
  const horizontalCount = Math.ceil((width - margin * 2) / step);
  const verticalCount = Math.ceil((height - margin * 2) / step);
  const top = walk(horizontalCount);
  const right = walk(verticalCount);
  const bottom = walk(horizontalCount);
  const left = walk(verticalCount);
  for (let i = 0; i <= horizontalCount; i += 1) points.push([margin + i * (width - margin * 2) / horizontalCount, margin + top[i]]);
  for (let i = 1; i <= verticalCount; i += 1) points.push([width - margin + right[i], margin + i * (height - margin * 2) / verticalCount]);
  for (let i = horizontalCount - 1; i >= 0; i -= 1) points.push([margin + i * (width - margin * 2) / horizontalCount, height - margin + bottom[i]]);
  for (let i = verticalCount - 1; i > 0; i -= 1) points.push([margin + left[i], margin + i * (height - margin * 2) / verticalCount]);
  context.fillStyle = '#fff';
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) context.lineTo(x, y);
  context.closePath();
  context.fill();
  return canvas.toBuffer('image/png');
}

async function renderPreview(preview) {
  const { width, height, bounds, layers, paperMargin } = preview;
  const projection = projectionFor(bounds, width, height, paperMargin * 1.45);
  const paperSource = path.join(rootDir, config.paper.source);
  const paperMask = edgeMask(width, height, paperMargin, config.seed + preview.id.length);
  const debugDir = path.join(rootDir, '.cache', 'debug');
  if (process.env.MAP_RENDER_DEBUG === '1') {
    await mkdir(debugDir, { recursive: true });
    await writeFile(path.join(debugDir, `${preview.id}-paper-mask.png`), paperMask);
  }
  const paper = await sharp(paperSource)
    .resize(width, height, { fit: 'cover' })
    .modulate({ saturation: 0.78, brightness: 1 })
    .tint(config.paper.tint)
    .ensureAlpha()
    .composite([{ input: paperMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  if (process.env.MAP_RENDER_DEBUG === '1') {
    await writeFile(path.join(debugDir, `${preview.id}-paper.png`), paper);
  }

  const adm0 = await collectionFor(preview, 'ADM0');
  const landMask = drawFill(adm0, projection, width, height, '#fff');
  if (process.env.MAP_RENDER_DEBUG === '1') {
    await writeFile(path.join(debugDir, `${preview.id}-land-mask.png`), landMask);
  }
  const landTone = await sharp({
    create: { width, height, channels: 4, background: rgba(config.palette.land, 0.07) }
  })
    .composite([{ input: landMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const detailScale = Math.sqrt(360 / (bounds[2] - bounds[0]));
  const styles = {
    ADM2: { color: config.palette.districtInk, width: Math.min(1.2, Math.max(0.5, 0.25 * detailScale)), alpha: 0.34 },
    ADM1: { color: config.palette.provinceInk, width: Math.min(2.2, Math.max(0.78, 0.46 * detailScale)), alpha: 0.52 },
    ADM0: { color: config.palette.countryInk, width: Math.min(3.6, Math.max(1.28, 0.65 * detailScale)), alpha: 0.78 }
  };
  const inkLayers = [];
  for (const level of ['ADM2', 'ADM1', 'ADM0']) {
    if (!layers.includes(level)) continue;
    const collection = level === 'ADM0' ? adm0 : await collectionFor(preview, level);
    const core = drawInk(collection, projection, width, height, styles[level]);
    if (process.env.MAP_RENDER_DEBUG === '1') {
      await writeFile(path.join(debugDir, `${preview.id}-${level.toLowerCase()}-ink.png`), core);
    }
    const bleed = await sharp(core).blur(level === 'ADM0' ? 0.9 : 0.55).modulate({ brightness: 0.72 }).png().toBuffer();
    inkLayers.push({ input: bleed, blend: 'multiply' });
    inkLayers.push({ input: core, blend: 'multiply' });
  }

  const sheet = await sharp({
    create: { width, height, channels: 4, background: config.palette.outside }
  })
    .composite([
      { input: paper, blend: 'over' },
      { input: landTone, blend: 'multiply' },
      ...inkLayers,
      { input: paperMask, blend: 'dest-in' }
    ])
    .png()
    .toBuffer();

  const pngPath = path.join(outputDir, `${preview.id}-parchment-v1.png`);
  const webpPath = path.join(outputDir, `${preview.id}-parchment-v1.webp`);
  await writeFile(pngPath, sheet);
  await sharp(sheet).webp({ quality: 88, effort: 5 }).toFile(webpPath);
  console.log(`${preview.id}: ${width}x${height}`);
}

for (const preview of config.previews) {
  if (process.env.MAP_RENDER_ONLY && process.env.MAP_RENDER_ONLY !== preview.id) continue;
  await renderPreview(preview);
}

await writeFile(path.join(outputDir, 'render-manifest.json'), `${JSON.stringify({
  rendererVersion: 1,
  renderedAt: new Date().toISOString(),
  projection: 'Natural Earth 1',
  config
}, null, 2)}\n`);

console.log(`Previews written to ${outputDir}`);
