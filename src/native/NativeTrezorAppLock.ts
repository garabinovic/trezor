import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * App Lock, Android (android/app/src/main/java/com/trezor/app/lock). The lock
 * state lives natively; only a successful system authentication (AndroidX
 * BiometricPrompt: biometrics or the device's PIN, pattern or password)
 * unlocks. There is no call that unlocks without one. Changes are announced
 * with the `trezorAppLockChanged` event.
 */
export interface Spec extends TurboModule {
  /** JSON { enabled, locked, availability: 'available' | 'noCredential' | 'unavailable' }. */
  getState(): string;
  /** Shows the system prompt; unlocks on success. Rejects CANCELLED, LOCKOUT, UNAVAILABLE, FAILED, NO_ACTIVITY, BUSY. */
  authenticate(): Promise<void>;
  /**
   * Turns App Lock on or off after the system prompt. Turning on needs an
   * available credential (else UNAVAILABLE); turning off without any
   * credential on the device needs no prompt.
   */
  setEnabled(enabled: boolean): Promise<void>;
  /** The system prompt before a sensitive action (Delete all data); changes nothing itself. */
  confirm(title: string): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrezorAppLock');
