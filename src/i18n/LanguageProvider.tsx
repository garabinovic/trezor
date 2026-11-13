import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import NativeTrezorLocale from '../native/NativeTrezorLocale';
import { DEFAULT_LANGUAGE, isLanguage, Language } from './languages';
import {
  nativeTexts,
  setCurrentLanguage,
  Strings,
  stringsFor,
} from './strings';

/** The native half (TrezorLocaleModule). Replaceable in tests. */
export interface LocalePlatform {
  getLanguage(): string;
  setLanguage(language: Language, texts: Record<string, string>): Promise<void>;
}

export const nativeLocalePlatform: LocalePlatform = {
  getLanguage: () => NativeTrezorLocale.getLanguage(),
  setLanguage: (language, texts) =>
    NativeTrezorLocale.setLanguage(language, JSON.stringify(texts)),
};

interface LanguageContextValue {
  language: Language;
  strings: Strings;
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: DEFAULT_LANGUAGE,
  strings: stringsFor(DEFAULT_LANGUAGE),
  setLanguage: () => undefined,
});

/**
 * The app language: read synchronously from native storage at start (English
 * when none was chosen, whatever the device's language), applied at once on
 * change, and stored natively with the strings Android shows for Trezor.
 */
export function LanguageProvider({
  children,
  platform = nativeLocalePlatform,
}: {
  children: ReactNode;
  platform?: LocalePlatform;
}) {
  const [language, setState] = useState<Language>(() => {
    const stored = platform.getLanguage();
    const initial = isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
    setCurrentLanguage(initial);
    return initial;
  });

  // Hand the native strings over again at every start: an app update may have
  // changed the translations since they were stored.
  useEffect(() => {
    platform
      .setLanguage(language, nativeTexts(language))
      .catch(() => console.warn('[i18n] language not stored'));
    // Only once; changes store it in setLanguage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLanguage = useCallback(
    (next: Language) => {
      setCurrentLanguage(next);
      setState(next);
      platform
        .setLanguage(next, nativeTexts(next))
        .catch(() => console.warn('[i18n] language not stored'));
    },
    [platform],
  );

  const value = useMemo(
    () => ({ language, strings: stringsFor(language), setLanguage }),
    [language, setLanguage],
  );
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

/** The strings of the language in use; re-renders when it changes. */
export function useStrings(): Strings {
  return useContext(LanguageContext).strings;
}

export function useLanguage(): {
  language: Language;
  setLanguage: (language: Language) => void;
} {
  const { language, setLanguage } = useContext(LanguageContext);
  return { language, setLanguage };
}
