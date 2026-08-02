import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = process.env.TRAVEL_ORIGIN || 'https://travel.ysoseri.us';
const response = await fetch(`${origin}/api/pins`, { headers: { 'cache-control': 'no-cache' } });
if (!response.ok) throw new Error(`Unable to read pins: ${response.status}`);
const { pins = [] } = await response.json();

const china = JSON.parse(await readFile(path.join(root, 'map-renderer', '.cache', 'geoboundaries', 'adm2', 'CHN.geojson'), 'utf8'));
const newZealand = JSON.parse(await readFile(path.join(root, 'map-renderer', '.cache', 'geoboundaries', 'adm1', 'NZL.geojson'), 'utf8'));

const nzNamesZh = new Map([
  ['NZ-AUK', '奥克兰'], ['NZ-WGN', '惠灵顿'], ['NZ-OTA', '奥塔哥']
]);
const nzCityNames = new Map([
  ['奥克兰', 'Auckland'], ['惠灵顿', 'Wellington'], ['皇后镇', 'Queenstown']
]);
const chinaParentNamesEn = new Map([
  ['NeiMongol', 'Inner Mongolia'], ['GuangxiZhuang', 'Guangxi'], ['NingxiaHui', 'Ningxia'],
  ['XinjiangUygur', 'Xinjiang'], ['HongKong', 'Hong Kong']
]);

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市|地区|盟|自治州|region|province|city|district|\s|[^\p{L}\p{N}]/gu, '');
}

function localName(value) {
  const names = String(value || '').split('|').map((item) => item.trim()).filter(Boolean);
  const name = names.at(-1) || '';
  return /^(?:na|<null>)$/i.test(name) ? '' : name;
}

function cityName(pin) {
  return String(pin.place_name || pin.title || '').split(/\s*[·|,，]\s*/u)[0].trim();
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [x1, y1] = ring[current];
    const [x2, y2] = ring[previous];
    if ((y1 > lat) !== (y2 > lat) && lng < ((x2 - x1) * (lat - y1)) / ((y2 - y1) || Number.EPSILON) + x1) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng, lat, polygon) {
  return pointInRing(lng, lat, polygon[0] || []) && !(polygon.slice(1).some((ring) => pointInRing(lng, lat, ring)));
}

function contains(feature, lng, lat) {
  const geometry = feature.geometry;
  if (geometry?.type === 'Polygon') return pointInPolygon(lng, lat, geometry.coordinates);
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.some((polygon) => pointInPolygon(lng, lat, polygon));
  return false;
}

function quote(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function chinaHierarchy(pin) {
  const wanted = [cityName(pin), pin.title].map(normalize).filter(Boolean);
  const feature = china.features.find((item) => {
    const properties = item.properties || {};
    const cityAliases = [properties.NAME_2, properties.NL_NAME_2, properties.VARNAME_2].flatMap((value) => String(value || '').split('|')).map(normalize);
    return wanted.some((name) => cityAliases.includes(name));
  }) || china.features.find((item) => {
    const properties = item.properties || {};
    const provinceAliases = [properties.NAME_1, properties.NL_NAME_1].flatMap((value) => String(value || '').split('|')).map(normalize);
    return wanted.some((name) => provinceAliases.includes(name));
  }) || china.features.find((item) => contains(item, Number(pin.lng), Number(pin.lat)));
  if (!feature) return null;
  const properties = feature.properties || {};
  const hongKong = properties.GID_1 === 'CHN.HKG';
  const municipality = hongKong || wanted.some((name) => [properties.NAME_1, properties.NL_NAME_1].flatMap((value) => String(value || '').split('|')).map(normalize).includes(name));
  return {
    cityEn: hongKong ? 'Hong Kong' : String(municipality ? properties.NAME_1 : properties.NAME_2 || properties.NAME_1),
    cityZh: hongKong ? cityName(pin) : localName(municipality ? properties.NL_NAME_1 : properties.NL_NAME_2) || cityName(pin),
    parentId: String(properties.GID_1 || properties.NAME_1),
    parentEn: hongKong ? 'Hong Kong' : chinaParentNamesEn.get(String(properties.NAME_1 || '')) || String(properties.NAME_1 || ''),
    parentZh: hongKong ? '香港' : localName(properties.NL_NAME_1) || String(properties.NAME_1 || '')
  };
}

function newZealandHierarchy(pin) {
  const feature = newZealand.features.find((item) => contains(item, Number(pin.lng), Number(pin.lat)));
  if (!feature) return null;
  const properties = feature.properties || {};
  const parentId = String(properties.shapeISO || properties.shapeID || properties.shapeName);
  const localCity = cityName(pin).replace(/^(?:新西兰|纽西兰)/u, '').trim();
  const titleCity = String(pin.title || '').replace(/^(?:新西兰|纽西兰)/u, '').trim();
  return {
    cityEn: nzCityNames.get(localCity) || nzCityNames.get(titleCity) || String(properties.shapeName || titleCity),
    cityZh: localCity || titleCity,
    parentId,
    parentEn: String(properties.shapeName || ''),
    parentZh: nzNamesZh.get(parentId) || String(properties.shapeName || '')
  };
}

const updates = new Map();
const unmatched = [];
for (const pin of pins) {
  if (!pin.region_id || !pin.country_code) continue;
  const hierarchy = pin.country_code === 'CN' ? chinaHierarchy(pin)
    : pin.country_code === 'NZ' ? newZealandHierarchy(pin)
      : null;
  if (!hierarchy) {
    unmatched.push({ id: pin.id, title: pin.title, country: pin.country_code });
    continue;
  }
  updates.set(pin.region_id, hierarchy);
}

if (unmatched.length) {
  console.error(JSON.stringify({ unmatched }, null, 2));
  process.exitCode = 1;
} else {
  console.error(`Prepared hierarchy backfill for ${updates.size} active regions.`);
}

const sql = [...updates].map(([regionId, value]) =>
  `UPDATE regions SET name_en=${quote(value.cityEn)},name_zh=${quote(value.cityZh)},parent_region_id=${quote(value.parentId)},parent_name_en=${quote(value.parentEn)},parent_name_zh=${quote(value.parentZh)},updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE region_id=${quote(regionId)};`
).join('\n');
const outputArg = process.argv.find((value) => value.startsWith('--output='));
if (outputArg) {
  const target = path.resolve(root, outputArg.slice('--output='.length));
  if (!target.startsWith(path.join(root, '.wrangler'))) throw new Error('Backfill output must stay inside .wrangler');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${sql}\n`);
  console.error(`Wrote ${updates.size} hierarchy updates to ${target}.`);
} else {
  process.stdout.write(`${sql}\n`);
}
