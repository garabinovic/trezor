/** The app's languages. English is the source, the default and the fallback. */
export const LANGUAGES = ['en', 'sr-Latn', 'sr-Cyrl', 'ru', 'es'] as const;

export type Language = (typeof LANGUAGES)[number];

/** New installations start in English, whatever the device's language. */
export const DEFAULT_LANGUAGE: Language = 'en';

/** Each language's own name for itself, as the language list shows it. */
export const languageNames: Record<Language, string> = {
  en: 'English',
  'sr-Latn': 'Srpski (latinica)',
  'sr-Cyrl': 'Српски (ћирилица)',
  ru: 'Русский',
  es: 'Español',
};

export function isLanguage(value: unknown): value is Language {
  return (LANGUAGES as readonly unknown[]).includes(value);
}
