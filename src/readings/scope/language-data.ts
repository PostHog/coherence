/**
 * What the readings say of each language without its code: its entrance
 * rules, what they do not see, and why a text scan skips it. Each language
 * plugin's manifest holds them (src/plugins/languages.ts); this module is
 * where a reading, the query and the page read them, and it is browser-safe:
 * the page sets the table from the state it embeds, and in Node the core's
 * language table sets it from the plugins as it loads, which every module
 * that reads a language loads first.
 */

/** One entrance detection rule: its name, its plural, what it detects, and whether a request from off the machine reaches what it detects. */
export interface CandidateRule {
  rule: string;
  plural: string;
  detects: string;
  remote?: boolean;
}

/** What a reading says of one language. */
export interface LanguageData {
  rules: CandidateRule[];
  notDetected?: string;
  notScanned?: string;
}

let held: Record<string, LanguageData> | undefined;
const NONE: Record<string, LanguageData> = {};

/** Set the table: the page, from the state it embeds. */
export function setLanguageData(data: Record<string, LanguageData>): void {
  held = data;
}

/** The table, by language name; empty where neither the page nor the plugins have said. */
export function languageData(): Record<string, LanguageData> {
  return held ?? NONE;
}

/**
 * A table derived from the language data, read through as an ordinary
 * object: built when first read, and again whenever the data it came from
 * was set anew (the page sets it once it has its state), so a module may
 * export one at load without reading the data before anyone has set it.
 */
export function derived<T extends object>(make: (data: Record<string, LanguageData>) => T): T {
  let from: Record<string, LanguageData> | undefined;
  let value: T | undefined;
  const current = (): T => {
    const data = languageData();
    if (value === undefined || from !== data) {
      value = make(data);
      from = data;
    }
    return value;
  };
  return new Proxy({} as T, {
    get: (_, key) => Reflect.get(current(), key),
    has: (_, key) => Reflect.has(current(), key),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(current(), key);
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true };
    },
  });
}
