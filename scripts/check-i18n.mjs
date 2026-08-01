import { readFile } from 'node:fs/promises';

const localeDir = new URL('../src/locales/', import.meta.url);
const [zh, en] = await Promise.all([
  readFile(new URL('zh.json', localeDir), 'utf8').then(JSON.parse),
  readFile(new URL('en.json', localeDir), 'utf8').then(JSON.parse)
]);

const zhKeys = Object.keys(zh).sort();
const enKeys = Object.keys(en).sort();
const missingEn = zhKeys.filter((key) => !(key in en));
const missingZh = enKeys.filter((key) => !(key in zh));
const empty = [...zhKeys.filter((key) => !String(zh[key]).trim()), ...enKeys.filter((key) => !String(en[key]).trim())];

if (missingEn.length || missingZh.length || empty.length) {
  console.error(JSON.stringify({ missingEn, missingZh, empty }, null, 2));
  process.exit(1);
}

console.log(`i18n contract complete: ${zhKeys.length} keys in zh and en`);
