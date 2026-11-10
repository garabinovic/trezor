import { DeviceEventEmitter } from 'react-native';
import NativeTrezorAppLock from '../native/NativeTrezorAppLock';

/** Whether the device can confirm it's the user: biometrics or a screen lock. */
export type Availability = 'available' | 'noCredential' | 'unavailable';

export interface AppLockState {
  enabled: boolean;
  /** Decided natively; only a successful system authentication clears it. */
  locked: boolean;
  availability: Availability;
}

/** The native half (TrezorAppLockModule). Replaceable in tests. */
export interface AppLockPlatform {
  getState(): AppLockState;
  /** The system prompt; resolves only after it succeeded (and native unlocked). */
  authenticate(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  onChange(listener: () => void): () => void;
}

export const APP_LOCK_EVENT = 'trezorAppLockChanged';

export const nativeAppLockPlatform: AppLockPlatform = {
  getState: () => JSON.parse(NativeTrezorAppLock.getState()) as AppLockState,
  authenticate: () => NativeTrezorAppLock.authenticate(),
  setEnabled: enabled => NativeTrezorAppLock.setEnabled(enabled),
  onChange(listener) {
    const subscription = DeviceEventEmitter.addListener(
      APP_LOCK_EVENT,
      listener,
    );
    return () => subscription.remove();
  },
};

/** The code of a rejected authentication, or FAILED. */
export function authErrorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'FAILED';
}

/** What to say after a failed attempt; nothing for a cancel. */
export function authErrorMessage(e: unknown): string | null {
  switch (authErrorCode(e)) {
    case 'CANCELLED':
      return null;
    case 'LOCKOUT':
      return 'Too many attempts. Wait a moment, then try again, or use your screen lock.';
    case 'UNAVAILABLE':
      return 'No fingerprint, face or screen lock is set up on this device.';
    default:
      return 'Trezor couldn’t confirm it’s you. Try again.';
  }
}
