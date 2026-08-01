import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { opendir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const required = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.TRAVEL_TILE_ROOT
  ? path.resolve(projectRoot, process.env.TRAVEL_TILE_ROOT)
  : path.join(projectRoot, 'public', 'tiles');
const bucket = 'travel-tiles';
const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

async function walk(directory) {
  const files = [];
  const entries = await opendir(directory);
  for await (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const remote = new Map();
let continuationToken;
do {
  const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }));
  for (const item of page.Contents || []) if (item.Key) remote.set(item.Key, { size: item.Size || 0, etag: String(item.ETag || '').replaceAll('"', '') });
  continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (continuationToken);

const files = await walk(root);
const pending = [];
let skipped = 0;
for (const file of files) {
  const key = path.relative(root, file).split(path.sep).join('/');
  const info = await stat(file);
  const current = remote.get(key);
  const hash = current?.size === info.size ? createHash('md5').update(await readFile(file)).digest('hex') : '';
  if (current?.size === info.size && current.etag === hash) skipped += 1;
  else pending.push({ file, key, size: info.size });
}

let cursor = 0;
let uploadedBytes = 0;
const concurrency = Math.min(12, pending.length || 1);
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (cursor < pending.length) {
    const item = pending[cursor++];
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: item.key,
      Body: await readFile(item.file),
      ContentType: item.key.endsWith('.webp') ? 'image/webp'
        : item.key.endsWith('.mvt') ? 'application/vnd.mapbox-vector-tile'
          : item.key.endsWith('.pmtiles') ? 'application/octet-stream'
            : 'application/json',
      CacheControl: item.key.endsWith('.webp') || item.key.endsWith('.mvt') || item.key.endsWith('.pmtiles')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=300'
    }));
    uploadedBytes += item.size;
  }
}));

console.log(`R2 tiles synchronized: ${pending.length} uploaded (${uploadedBytes} bytes), ${skipped} current`);
