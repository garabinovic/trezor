export {
  DEFAULT_LANGUAGE,
  isLanguage,
  LANGUAGES,
  languageNames,
} from './languages';
export type { Language } from './languages';
export {
  currentLanguage,
  nativeTexts,
  strings,
  stringsFor,
  withFallback,
} from './strings';
export type { Strings } from './strings';
export {
  LanguageProvider,
  nativeLocalePlatform,
  useLanguage,
  useStrings,
} from './LanguageProvider';
export type { LocalePlatform } from './LanguageProvider';
export { slavic } from './plural';
