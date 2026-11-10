import React, { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  DevSettings,
  Modal,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { nativeAttachmentPlatform } from './attachments/platform';
import { nativeBackupPlatform } from './backup/platform';
import { Dialog } from './components';
import { ItemsProvider } from './data';
import { AppLockProvider, useAppLock } from './lock/AppLockProvider';
import { LockScreen } from './lock/LockScreen';
import { RootNavigator } from './navigation/RootNavigator';
import { RemindersProvider } from './reminders/RemindersProvider';
import { StorageErrorScreen } from './screens/StorageErrorScreen';
import { WriteErrorDialog } from './screens/shared/WriteErrorDialog';
import type { OpenedStorage } from './storage/openStorage';
import { StorageProvider, useStorage } from './storage/StorageProvider';
import { palettes, ThemePreference, ThemeProvider } from './theme';

if (__DEV__) {
  DevSettings.addMenuItem('Run storage self-test', () => {
    require('./storage/selfTest')
      .runStorageSelfTest()
      .catch((e: Error) => console.log(`[SELFTEST] ERROR ${e.message}`));
  });
}

export function App() {
  return (
    <SafeAreaProvider>
      <AppLockProvider>
        <StorageProvider>
          <LockedApp />
        </StorageProvider>
      </AppLockProvider>
    </SafeAreaProvider>
  );
}

/**
 * App Lock (Phase 5). Until the first unlock of this process nothing of the
 * app is mounted, only the lock screen (storage still opens and recovers
 * meanwhile). Later locks cover the mounted app with the lock screen in a
 * modal, so drafts and navigation survive, and hide it from accessibility
 * services. The window itself is FLAG_SECURE natively while locked.
 */
function LockedApp() {
  const { state } = useAppLock();
  const [unlockedOnce, setUnlockedOnce] = useState(!state.locked);
  useEffect(() => {
    if (!state.locked) {
      setUnlockedOnce(true);
    }
  }, [state.locked]);

  if (!unlockedOnce) {
    return (
      <ThemeProvider>
        <LockScreen />
      </ThemeProvider>
    );
  }
  return (
    <>
      <View
        style={styles.fill}
        importantForAccessibility={
          state.locked ? 'no-hide-descendants' : 'auto'
        }
      >
        <AppContent />
      </View>
      <Modal
        visible={state.locked}
        animationType="none"
        statusBarTranslucent
        navigationBarTranslucent
        // Back while locked does nothing; Home leaves as usual.
        onRequestClose={() => undefined}
      >
        <ThemeProvider>
          <LockScreen />
        </ThemeProvider>
      </Modal>
    </>
  );
}

function AppContent() {
  const { state, retry } = useStorage();

  if (state.status === 'opening') {
    return <OpeningScreen />;
  }

  if (state.status === 'error') {
    return (
      <ThemeProvider>
        <StorageErrorScreen error={state.error} onRetry={retry} />
      </ThemeProvider>
    );
  }

  return <ReadyApp storage={state.storage} />;
}

function ReadyApp({ storage }: { storage: OpenedStorage }) {
  // Whenever the app comes back to the foreground: view copies that no screen
  // holds any more, and share copies older than 24 hours, are removed. The
  // startup cleanup (openStorage) does the same.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        nativeAttachmentPlatform
          .purgeInactiveViews()
          .catch(() => console.warn('[attachments] view cleanup failed'));
        nativeAttachmentPlatform
          .purgeExpiredShares()
          .catch(() => console.warn('[attachments] share cleanup failed'));
      }
    });
    return () => subscription.remove();
  }, []);

  // A backup that a previous run couldn't finish, whose file couldn't be
  // deleted: the user is told once (spec v2.4 §6.4). Native clears the record.
  const [incompleteBackup, setIncompleteBackup] = useState<string | null>(null);
  useEffect(() => {
    nativeBackupPlatform.takeIncompleteNotice().then(
      name => setIncompleteBackup(name),
      () => undefined,
    );
  }, []);

  const persistTheme = useCallback(
    (preference: ThemePreference) =>
      storage.settings
        .set('theme.preference', preference)
        .catch(() => console.warn('[storage] could not save theme')),
    [storage],
  );

  return (
    <ThemeProvider
      initialPreference={storage.initialTheme}
      onPreferenceChange={persistTheme}
    >
      <ItemsProvider
        repository={storage.items}
        initialItems={storage.initialItems}
        deleteAttachmentFiles={nativeAttachmentPlatform.deleteFiles}
      >
        <RemindersProvider
          settings={storage.settings}
          initialShowDetails={storage.initialShowReminderDetails}
          initialPermissionRequested={storage.initialPermissionRequested}
          initialExactAlarmRequested={storage.initialExactAlarmRequested}
        >
          <RootNavigator />
          <WriteErrorDialog />
          <Dialog
            visible={incompleteBackup !== null}
            title="An incomplete backup file may remain"
            message={`A backup didn’t finish, and Trezor couldn’t delete its file “${incompleteBackup}”. Delete it where you saved it; it can’t be restored.`}
            confirmLabel="OK"
            cancelLabel={null}
            onConfirm={() => setIncompleteBackup(null)}
            onCancel={() => setIncompleteBackup(null)}
          />
        </RemindersProvider>
      </ItemsProvider>
    </ThemeProvider>
  );
}

/**
 * Matches the native launch background while the database opens (usually
 * well under a second), so startup shows no flash or spinner.
 */
function OpeningScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <View
      style={[styles.fill, { backgroundColor: palettes[scheme].background }]}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
