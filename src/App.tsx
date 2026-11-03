import React, { useCallback, useEffect } from 'react';
import {
  AppState,
  DevSettings,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { nativeAttachmentPlatform } from './attachments/platform';
import { ItemsProvider } from './data';
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
      <StorageProvider>
        <AppContent />
      </StorageProvider>
    </SafeAreaProvider>
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
