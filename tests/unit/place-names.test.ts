import { describe, expect, it } from 'vitest';
import { mergeLocalizedPlaceNames } from '../../src/lib/place-names';

describe('mergeLocalizedPlaceNames', () => {
  it('fills missing legacy pin names from the stable region catalog', () => {
    expect(mergeLocalizedPlaceNames(null, { zh: '奥克兰', en: 'Auckland' })).toEqual({
      zh: '奥克兰',
      en: 'Auckland'
    });
  });

  it('keeps explicit localized place names ahead of region fallbacks', () => {
    expect(mergeLocalizedPlaceNames('{"zh":"星海广场","en":"Xinghai Square"}', {
      zh: '大连市',
      en: 'Dalian'
    })).toEqual({ zh: '星海广场', en: 'Xinghai Square' });
  });

  it('recovers from malformed stored data', () => {
    expect(mergeLocalizedPlaceNames('{broken', { zh: '青岛市', en: 'Qingdao' })).toEqual({
      zh: '青岛市',
      en: 'Qingdao'
    });
  });
});
