import { en, Strings } from './en';
import { es } from './es';
import { DEFAULT_LANGUAGE, Language } from './languages';
import { ru } from './ru';
import { srCyrl } from './sr-Cyrl';
import { srLatn } from './sr-Latn';

export type { Strings };

const dictionaries: Record<Language, Strings> = {
  en,
  'sr-Latn': srLatn,
  'sr-Cyrl': srCyrl,
  ru,
  es,
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? T[K]
    : T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
    ? DeepPartial<T[K]>
    : T[K];
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function merge(base: unknown, over: unknown): unknown {
  if (isRecord(base)) {
    const source = isRecord(over) ? over : {};
    return Object.fromEntries(
      Object.entries(base).map(([key, value]) => [
        key,
        merge(value, source[key]),
      ]),
    );
  }
  if (Array.isArray(base)) {
    return Array.isArray(over) && over.length === base.length ? over : base;
  }
  return typeof over === typeof base ? over : base;
}

/**
 * A dictionary with every missing (or malformed) entry taken from English, so
 * the UI never shows a raw key or an empty string.
 */
export function withFallback(partial: DeepPartial<Strings>): Strings {
  return merge(en, partial) as Strings;
}

const resolved = new Map<Language, Strings>();

export function stringsFor(language: Language): Strings {
  let result = resolved.get(language);
  if (!result) {
    result = withFallback(dictionaries[language] as DeepPartial<Strings>);
    resolved.set(language, result);
  }
  return result;
}

let current: Language = DEFAULT_LANGUAGE;

/** The language in use; set by LanguageProvider. */
export function currentLanguage(): Language {
  return current;
}

export function setCurrentLanguage(language: Language): void {
  current = language;
}

/**
 * The strings of the language in use, for code outside components (date
 * formatting, error messages). Components use `useStrings()`, which also
 * re-renders them when the language changes.
 */
export function strings(): Strings {
  return stringsFor(current);
}

/** The NativeText.kt strings, in `language`. */
export function nativeTexts(language: Language): Record<string, string> {
  return { ...stringsFor(language).native };
}
