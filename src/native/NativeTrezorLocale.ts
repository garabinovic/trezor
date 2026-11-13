import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * The app language, stored natively (android/app/src/main/java/com/trezor/app/locale):
 * device-local SharedPreferences, outside the database and backups, readable
 * before storage opens and by notifications fired while the app is closed.
 */
export interface Spec extends TurboModule {
  /** The stored language code, or 'en' when none was chosen. */
  getLanguage(): string;
  /**
   * Stores the language with the strings Android shows on Trezor's behalf
   * (JSON object; keys as in NativeText.kt). Rejects LOCALE_FAILED.
   */
  setLanguage(language: string, textsJson: string): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrezorLocale');
