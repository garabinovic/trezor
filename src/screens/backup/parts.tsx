import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text, TextField } from '../../components';
import { spacing, useTheme } from '../../theme';

/**
 * The blocking progress view of backup and restore (spec v2.4 §6.1, §8.2
 * step 2, L8): nothing else can be done meanwhile, and the user is asked to
 * keep Trezor open (no foreground service, §8.10).
 */
export function Busy({ title, message }: { title: string; message?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.busy} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.accent} />
      <Text variant="headline" align="center">
        {title}
      </Text>
      <Text variant="callout" color="textSecondary" align="center">
        {message ?? 'Keep Trezor open until this is done.'}
      </Text>
    </View>
  );
}

const PASSWORD_INPUT = {
  secureTextEntry: true,
  autoCapitalize: 'none',
  autoCorrect: false,
  autoComplete: 'off',
  importantForAutofill: 'no',
} as const;

/** A backup password field (never stored, never logged; rules are checked natively, §4). */
export function PasswordField(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  helper?: string;
  error?: string;
}) {
  return <TextField {...PASSWORD_INPUT} {...props} />;
}

export const styles = StyleSheet.create({
  busy: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.huge,
    paddingHorizontal: spacing.xl,
  },
  form: { gap: spacing.xl, paddingTop: spacing.sm },
});
