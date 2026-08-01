import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const outputDir = path.join(rootDir, '..', 'assets', 'pins', 'v1');

const variants = [
  ['coral', '#c85f3c'],
  ['verdigris', '#47756f'],
  ['ochre', '#d19a3b'],
  ['violet', '#805b88'],
  ['blue', '#55739a'],
  ['red', '#9a4d4b']
];

function shade(hex, amount) {
  const value = hex.slice(1);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  return `#${channels.map((channel) => Math.max(0, Math.min(255, Math.round(channel + amount))).toString(16).padStart(2, '0')).join('')}`;
}

function pinSvg(color) {
  const light = shade(color, 58);
  const mid = shade(color, 15);
  const dark = shade(color, -48);
  const deepest = shade(color, -78);
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="320" viewBox="0 0 256 320">
      <defs>
        <radialGradient id="cap" cx="35%" cy="22%" r="78%">
          <stop offset="0" stop-color="${light}"/>
          <stop offset=".3" stop-color="${mid}"/>
          <stop offset=".72" stop-color="${color}"/>
          <stop offset="1" stop-color="${dark}"/>
        </radialGradient>
        <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${light}"/>
          <stop offset=".28" stop-color="${mid}"/>
          <stop offset=".68" stop-color="${color}"/>
          <stop offset="1" stop-color="${deepest}"/>
        </linearGradient>
        <linearGradient id="steel" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#5f554c"/>
          <stop offset=".25" stop-color="#e7dfd2"/>
          <stop offset=".5" stop-color="#968b7d"/>
          <stop offset=".72" stop-color="#f4eee3"/>
          <stop offset="1" stop-color="#554d46"/>
        </linearGradient>
        <filter id="soft-shadow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="7"/>
        </filter>
      </defs>
      <ellipse cx="142" cy="283" rx="40" ry="10" fill="#291b13" opacity=".24" filter="url(#soft-shadow)" transform="rotate(-7 142 283)"/>
      <path d="M133 155 L145 283 L136 288 L124 157 Z" fill="#392f28" opacity=".16"/>
      <path d="M126 150 L141 282 L135 291 L117 153 Z" fill="url(#steel)"/>
      <path d="M136 291 L141 282 L142 297 Z" fill="#342d28"/>
      <path d="M64 85 C72 111 84 136 106 154 L150 154 C172 135 184 110 192 85 Z" fill="url(#body)" stroke="${deepest}" stroke-width="3"/>
      <ellipse cx="128" cy="83" rx="67" ry="42" fill="url(#cap)" stroke="${deepest}" stroke-width="3"/>
      <ellipse cx="111" cy="68" rx="29" ry="15" fill="#fff8ec" opacity=".19" transform="rotate(-16 111 68)"/>
      <path d="M78 97 C94 119 161 121 179 96" fill="none" stroke="#fff7e9" stroke-width="4" opacity=".12" stroke-linecap="round"/>
      <path d="M101 151 C112 160 144 160 155 151 L151 165 C140 172 116 172 105 164 Z" fill="${dark}" opacity=".84"/>
      <ellipse cx="128" cy="158" rx="25" ry="9" fill="${deepest}" opacity=".62"/>
    </svg>`;
}

await mkdir(outputDir, { recursive: true });
const manifest = [];
for (const [name, color] of variants) {
  const svg = Buffer.from(pinSvg(color));
  const pngName = `pushpin-${name}-v1.png`;
  const webpName = `pushpin-${name}-v1.webp`;
  await sharp(svg).png().toFile(path.join(outputDir, pngName));
  await sharp(svg).webp({ quality: 92, alphaQuality: 100, effort: 5 }).toFile(path.join(outputDir, webpName));
  manifest.push({ name, color, png: pngName, webp: webpName, width: 256, height: 320, tip: [142, 297] });
}
await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify({ version: 1, variants: manifest }, null, 2)}\n`);
console.log(`rendered ${variants.length} pushpin variants`);
