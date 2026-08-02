import { describe, expect, it } from 'vitest';
import {
  administrativeNameMatches,
  cityNameFromPlace,
  countrySearchAliases,
  markdownSearchExcerpt,
  normalizeAdministrativeName
} from '../../src/lib/footprint-search';

describe('footprint search normalization', () => {
  it('matches administrative suffix variants in both languages', () => {
    expect(normalizeAdministrativeName('山东省')).toBe('山东');
    expect(administrativeNameMatches('武汉', '武汉市')).toBe(true);
    expect(administrativeNameMatches('Auckland', 'Auckland Region')).toBe(true);
  });

  it('provides the common country aliases used by visitors', () => {
    expect(countrySearchAliases('CN', 'China', '中华人民共和国')).toContain('中国');
    expect(countrySearchAliases('NZ', 'New Zealand', '新西兰')).toContain('Aotearoa');
  });

  it('derives city labels and readable Markdown excerpts', () => {
    expect(cityNameFromPlace('大连市 · 沙河口区')).toBe('大连市');
    expect(markdownSearchExcerpt('在 **星海广场** 看海。', '星海广场')).toContain('星海广场');
  });
});
