import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StatusBar, StyleSheet, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Text } from '../components';
import { useStrings } from '../i18n';
import { gutter, spacing, useTheme } from '../theme';
import { authErrorMessage } from './appLock';
import { useAppLock } from './AppLockProvider';

/**
 * Shown instead of (or over) everything while App Lock is locked. Shows no
 * personal data. The system prompt opens once each time the app comes to
 * the foreground locked; after a cancel the user opens it again with Unlock.
 * Repeated failures are the system's to handle (lockout).
 */
export function LockScreen() {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useStrings().lock;
  const { state, unlock, setEnabled } = useAppLock();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prompted = useRef(false);
  const canAuthenticate = state.availability === 'available';

  const tryUnlock = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await unlock();
    } catch (e) {
      setMessage(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [unlock]);

  useEffect(() => {
    const promptOnce = () => {
      if (
        !prompted.current &&
        canAuthenticate &&
        AppState.currentState === 'active'
      ) {
        prompted.current = true;
        tryUnlock();
      }
    };
    promptOnce();
    const subscription = AppState.addEventListener('change', promptOnce);
    return () => subscription.remove();
  }, [canAuthenticate, tryUnlock]);

  return (
    <View
      style={[
        styles.fill,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top,
          // Lower on the screen, within thumb reach, above the system navigation.
          paddingBottom: insets.bottom + spacing.huge,
        },
      ]}
      accessibilityViewIsModal
    >
      <StatusBar
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
      />
      <View style={styles.body}>
        <Icon icon={Lock} size="lg" />
        <Text variant="title" align="center">
          {t.locked}
        </Text>
        {canAuthenticate ? (
          <>
            <Text variant="callout" color="textSecondary" align="center">
              {t.unlockHint}
            </Text>
            {!!message && (
              <Text variant="callout" color="danger" align="center">
                {message}
              </Text>
            )}
          </>
        ) : (
          <Text variant="callout" color="textSecondary" align="center">
            {t.noCredential}
          </Text>
        )}
      </View>
      <View style={styles.actions}>
        {canAuthenticate ? (
          <Button
            label={t.unlock}
            onPress={tryUnlock}
            disabled={busy}
            fullWidth
          />
        ) : (
          <Button
            label={t.turnOff}
            variant="secondary"
            onPress={() => setEnabled(false).catch(() => undefined)}
            fullWidth
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  /** The explanation, centered in the space above the button. */
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: gutter,
  },
  /** One centered button, full width up to a comfortable maximum. */
  actions: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 360,
    paddingHorizontal: gutter,
    paddingTop: spacing.xxl,
  },
});
