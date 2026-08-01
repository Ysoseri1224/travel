import { describe, expect, it } from 'vitest';
import { translate } from '../../src/lib/i18n';

describe('translate', () => {
  it('returns complete Chinese and English labels', () => {
    expect(translate('zh', 'manage')).toBe('管理地图');
    expect(translate('en', 'manage')).toBe('Manage map');
  });

  it('interpolates dynamic values', () => {
    expect(translate('en', 'searchCountMany', { count: 3 })).toContain('3');
  });
});
