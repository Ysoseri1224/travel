import zh from '../locales/zh.json';
import en from '../locales/en.json';

export type Locale = 'zh' | 'en';
export type TranslationKey = keyof typeof zh;

const dictionaries = { zh, en } as const;

export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'zh';
  const saved = window.localStorage.getItem('travel-locale');
  if (saved === 'zh' || saved === 'en') return saved;
  return window.navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function translate(locale: Locale, key: TranslationKey, values: Record<string, string | number> = {}): string {
  let text: string = dictionaries[locale][key];
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
