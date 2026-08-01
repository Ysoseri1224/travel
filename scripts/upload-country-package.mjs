import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { opendir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const name of ['COUNTRY_CODE', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
const countryCode = process.env.COUNTRY_CODE.toUpperCase();
if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('Invalid COUNTRY_CODE');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(root, 'country-build', countryCode);
const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
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

const files = await walk(packageRoot);
files.sort((left, right) => Number(left.endsWith('manifest.json')) - Number(right.endsWith('manifest.json')));
for (const file of files) {
  const relative = path.relative(packageRoot, file).split(path.sep).join('/');
  const key = `v3/countries/${countryCode}/${relative}`;
  await client.send(new PutObjectCommand({
    Bucket: 'travel-tiles',
    Key: key,
    Body: await readFile(file),
    ContentType: file.endsWith('.webp') ? 'image/webp' : 'application/json; charset=utf-8',
    CacheControl: file.endsWith('manifest.json') ? 'public, max-age=60' : 'public, max-age=31536000, immutable'
  }));
  console.log(`uploaded ${key}`);
}
