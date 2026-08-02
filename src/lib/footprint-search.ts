const ADMIN_SUFFIXES = [
  '壮族自治区', '回族自治区', '维吾尔自治区', '特别行政区', '自治区', '省', '市',
  'autonomousregion', 'specialadministrativeregion', 'province', 'region', 'state', 'city', 'country'
];

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

export function normalizeAdministrativeName(value: string): string {
  let normalized = normalizeSearchText(value).replace(/[^\p{L}\p{N}]+/gu, '');
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of ADMIN_SUFFIXES) {
      if (normalized.length > suffix.length && normalized.endsWith(suffix)) {
        normalized = normalized.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  return normalized;
}

export function administrativeNameMatches(query: string, ...values: Array<string | null | undefined>): boolean {
  const target = normalizeAdministrativeName(query);
  return Boolean(target) && values.some((value) => value && normalizeAdministrativeName(value) === target);
}

export function countrySearchAliases(countryCode: string, nameEn: string, nameZh?: string | null): string[] {
  const aliases = [countryCode, nameEn, nameZh || ''];
  if (countryCode === 'CN') aliases.push('中国', 'China', 'PRC', 'People’s Republic of China', "People's Republic of China");
  if (countryCode === 'NZ') aliases.push('新西兰', '纽西兰', 'New Zealand', 'Aotearoa');
  return aliases;
}

export function cityNameFromPlace(value?: string | null): string {
  return String(value || '').split(/\s*[·|,，]\s*/u)[0]?.trim() || '';
}

export function markdownSearchExcerpt(markdown: string, query: string, maxLength = 120): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>~|\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  const normalizedPlain = normalizeSearchText(plain);
  const normalizedQuery = normalizeSearchText(query);
  const index = normalizedQuery ? normalizedPlain.indexOf(normalizedQuery) : -1;
  const start = index > 28 ? index - 28 : 0;
  const excerpt = plain.slice(start, start + maxLength).trim();
  return `${start > 0 ? '…' : ''}${excerpt}${start + maxLength < plain.length ? '…' : ''}`;
}
