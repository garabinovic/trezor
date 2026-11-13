import { DeviceEventEmitter } from 'react-native';
import { strings } from '../i18n/strings';
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
  /** The system prompt before a sensitive action; changes no state. */
  confirm(title: string): Promise<void>;
  onChange(listener: () => void): () => void;
}

export const APP_LOCK_EVENT = 'trezorAppLockChanged';

export const nativeAppLockPlatform: AppLockPlatform = {
  getState: () => JSON.parse(NativeTrezorAppLock.getState()) as AppLockState,
  authenticate: () => NativeTrezorAppLock.authenticate(),
  setEnabled: enabled => NativeTrezorAppLock.setEnabled(enabled),
  confirm: title => NativeTrezorAppLock.confirm(title),
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
  const t = strings().lock;
  switch (authErrorCode(e)) {
    case 'CANCELLED':
      return null;
    case 'LOCKOUT':
      return t.lockout;
    case 'UNAVAILABLE':
      return t.unavailable;
    default:
      return t.failed;
  }
}
