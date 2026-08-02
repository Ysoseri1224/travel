export interface LocalizedPlaceNames {
  zh?: string;
  en?: string;
}

function cleanName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function mergeLocalizedPlaceNames(
  storedValue: string | null,
  regionNames: { zh: string | null; en: string | null }
): LocalizedPlaceNames | null {
  let stored: LocalizedPlaceNames = {};
  if (storedValue) {
    try {
      const parsed = JSON.parse(storedValue) as Record<string, unknown>;
      stored = { zh: cleanName(parsed.zh), en: cleanName(parsed.en) };
    } catch {
      stored = {};
    }
  }

  const zh = stored.zh || cleanName(regionNames.zh);
  const en = stored.en || cleanName(regionNames.en);
  return zh || en ? { ...(zh ? { zh } : {}), ...(en ? { en } : {}) } : null;
}
