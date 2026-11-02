import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';
import { Dialog } from '../components';
import { useItems } from '../data';
import type { SettingsRepository } from '../storage/SettingsRepository';
import { nativeReminderPlatform, ReminderPlatform } from './platform';
import { createReconcileQueue, reconcile } from './scheduler';

/** Whether to show the in-app explanation before Android's permission prompt. */
export function shouldAskForPermission(state: {
  os: string;
  sdk: number;
  alreadyAsked: boolean;
  enabled: boolean;
}): boolean {
  // Android 12 and older grant notifications without a runtime prompt.
  return (
    state.os === 'android' &&
    state.sdk >= 33 &&
    !state.alreadyAsked &&
    !state.enabled
  );
}

interface RemindersContextValue {
  platform: ReminderPlatform;
  showDetails: boolean;
  setShowDetails: (value: boolean) => void;
  /** null until known. */
  notificationsEnabled: boolean | null;
  /** Explains, then asks Android once; never re-prompts after that. */
  requestPermissionIfNeeded: () => void;
  openSystemSettings: () => void;
  /** The last attempt to update the notification schedule failed. */
  scheduleFailed: boolean;
}

const RemindersContext = createContext<RemindersContextValue | null>(null);

interface RemindersProviderProps {
  settings: SettingsRepository;
  initialShowDetails: boolean;
  initialPermissionRequested: boolean;
  platform?: ReminderPlatform;
  children: ReactNode;
}

const RECONCILE_DELAY_MS = 300;

export function RemindersProvider({
  settings,
  initialShowDetails,
  initialPermissionRequested,
  platform = nativeReminderPlatform,
  children,
}: RemindersProviderProps) {
  const { items, readStored, completeStoredReminders } = useItems();
  const [showDetails, setShowDetailsState] = useState(initialShowDetails);
  const [notificationsEnabled, setNotificationsEnabled] = useState<
    boolean | null
  >(null);
  const [scheduleFailed, setScheduleFailed] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const permissionRequested = useRef(initialPermissionRequested);
  const showDetailsRef = useRef(initialShowDetails);

  const requestReconcile = useMemo(
    () =>
      createReconcileQueue(async () => {
        try {
          await reconcile(platform, {
            readStored,
            completeFired: completeStoredReminders,
            showDetails: showDetailsRef.current,
          });
          setScheduleFailed(false);
        } catch (e) {
          setScheduleFailed(true);
          // Error code only; never reminder content.
          console.warn(
            `[reminders] schedule update failed: ${
              (e as { code?: string }).code ?? 'UNKNOWN'
            }`,
          );
          throw e;
        }
      }),
    [platform, readStored, completeStoredReminders],
  );

  const refreshPermission = useCallback(async () => {
    try {
      setNotificationsEnabled(await platform.notificationsEnabled());
    } catch {
      setNotificationsEnabled(null);
    }
  }, [platform]);

  // Any stored change (create, edit, delete, complete, reactivate…) and the
  // privacy setting lead to a reconciliation. Debounced; also runs at startup.
  useEffect(() => {
    const timer = setTimeout(requestReconcile, RECONCILE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [items, showDetails, requestReconcile]);

  // Back in the foreground: fired reminders, permission changes made in
  // Android settings, and clock or zone changes are picked up.
  useEffect(() => {
    refreshPermission();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refreshPermission();
        requestReconcile();
      }
    });
    return () => subscription.remove();
  }, [refreshPermission, requestReconcile]);

  const setShowDetails = useCallback(
    (value: boolean) => {
      showDetailsRef.current = value;
      setShowDetailsState(value);
      settings
        .set('notifications.showDetails', value)
        .catch(() =>
          console.warn('[reminders] could not save privacy setting'),
        );
    },
    [settings],
  );

  const markAsked = useCallback(() => {
    permissionRequested.current = true;
    settings
      .set('notifications.permissionRequested', true)
      .catch(() => console.warn('[reminders] could not save permission state'));
  }, [settings]);

  const requestPermissionIfNeeded = useCallback(async () => {
    const enabled = await platform.notificationsEnabled().catch(() => false);
    setNotificationsEnabled(enabled);
    if (
      shouldAskForPermission({
        os: Platform.OS,
        sdk: Number(Platform.Version),
        alreadyAsked: permissionRequested.current,
        enabled,
      })
    ) {
      setExplaining(true);
    }
  }, [platform]);

  const askAndroid = useCallback(async () => {
    setExplaining(false);
    markAsked();
    try {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
    } finally {
      await refreshPermission();
      requestReconcile();
    }
  }, [markAsked, refreshPermission, requestReconcile]);

  const declineExplanation = useCallback(() => {
    setExplaining(false);
    markAsked();
  }, [markAsked]);

  const openSystemSettings = useCallback(() => {
    Linking.openSettings().catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({
      platform,
      showDetails,
      setShowDetails,
      notificationsEnabled,
      requestPermissionIfNeeded: () => {
        requestPermissionIfNeeded();
      },
      openSystemSettings,
      scheduleFailed,
    }),
    [
      platform,
      showDetails,
      setShowDetails,
      notificationsEnabled,
      requestPermissionIfNeeded,
      openSystemSettings,
      scheduleFailed,
    ],
  );

  return (
    <RemindersContext.Provider value={value}>
      {children}
      <Dialog
        visible={explaining}
        title="Allow reminder notifications?"
        message="Trezor uses notifications to remind you at the time you set. Reminder details stay hidden unless you choose to show them in Settings."
        confirmLabel="Continue"
        cancelLabel="Not now"
        onConfirm={askAndroid}
        onCancel={declineExplanation}
      />
    </RemindersContext.Provider>
  );
}

export function useReminders(): RemindersContextValue {
  const context = useContext(RemindersContext);
  if (!context) {
    throw new Error('useReminders must be used inside RemindersProvider');
  }
  return context;
}
