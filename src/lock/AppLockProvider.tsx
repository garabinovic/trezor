import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';
import {
  AppLockPlatform,
  AppLockState,
  nativeAppLockPlatform,
} from './appLock';

interface AppLockContextValue {
  state: AppLockState;
  /** Shows the system prompt; the state follows what native decided. */
  unlock(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  /** The system prompt before a sensitive action (Delete all data). */
  confirm(title: string): Promise<void>;
}

const AppLockContext = createContext<AppLockContextValue | null>(null);

/**
 * App Lock state for the UI (Phase 5). It only mirrors native state: locking
 * happens natively when the app leaves the foreground, and unlocking only
 * after a successful system authentication. Every change, and every return
 * to the foreground, re-reads it.
 */
export function AppLockProvider({
  children,
  platform = nativeAppLockPlatform,
}: {
  children: ReactNode;
  platform?: AppLockPlatform;
}) {
  const [state, setState] = useState(() => platform.getState());
  const refresh = useCallback(() => setState(platform.getState()), [platform]);

  useEffect(() => {
    const off = platform.onChange(refresh);
    const subscription = AppState.addEventListener('change', refresh);
    refresh();
    return () => {
      off();
      subscription.remove();
    };
  }, [platform, refresh]);

  const value = useMemo<AppLockContextValue>(
    () => ({
      state,
      unlock: () => platform.authenticate().finally(refresh),
      setEnabled: enabled => platform.setEnabled(enabled).finally(refresh),
      confirm: title => platform.confirm(title),
    }),
    [state, platform, refresh],
  );

  return (
    <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>
  );
}

export function useAppLock(): AppLockContextValue {
  const context = useContext(AppLockContext);
  if (!context) {
    throw new Error('useAppLock must be used inside AppLockProvider');
  }
  return context;
}
