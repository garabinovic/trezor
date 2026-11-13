import React, { ComponentRef, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { IconButton, Text, TextField } from '../../components';
import { useStrings } from '../../i18n';
import { gutter, spacing, useTheme } from '../../theme';

/**
 * The blocking progress view of backup and restore (spec v2.4 §6.1, §8.2
 * step 2, L8): nothing else can be done meanwhile, and the user is asked to
 * keep Trezor open (no foreground service, §8.10).
 */
export function Busy({ title, message }: { title: string; message?: string }) {
  const { colors } = useTheme();
  const t = useStrings();
  return (
    <View style={styles.busy} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.accent} />
      <Text variant="headline" align="center">
        {title}
      </Text>
      <Text variant="callout" color="textSecondary" align="center">
        {message ?? t.backup.keepOpen}
      </Text>
    </View>
  );
}

const PASSWORD_INPUT = {
  autoCapitalize: 'none',
  autoCorrect: false,
  autoComplete: 'off',
  importantForAutofill: 'no',
  multiline: false,
} as const;

/**
 * A backup password field (never stored, never logged; rules are checked
 * natively, §4). Hidden by default; the eye button shows or hides the text in
 * the field itself. While shown, Android's `visible-password` keyboard keeps
 * suggestions and learning off.
 */
export function PasswordField(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  helper?: string;
  error?: string;
}) {
  const t = useStrings();
  const [visible, setVisible] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const toggled = useRef(false);

  // Switching the input type may move the cursor; put it back.
  useEffect(() => {
    if (toggled.current && selection.current) {
      const { start, end } = selection.current;
      input.current?.setSelection?.(start, end);
    }
  }, [visible]);

  return (
    <TextField
      {...PASSWORD_INPUT}
      {...props}
      ref={input}
      secureTextEntry={!visible}
      keyboardType={visible ? 'visible-password' : 'default'}
      onSelectionChange={e => {
        selection.current = e.nativeEvent.selection;
      }}
      trailing={
        <IconButton
          icon={visible ? EyeOff : Eye}
          label={visible ? t.backup.hidePassword : t.backup.showPassword}
          color="textSecondary"
          onPress={() => {
            toggled.current = true;
            setVisible(v => !v);
          }}
        />
      }
    />
  );
}

export const styles = StyleSheet.create({
  /** The screen's content, inside the app's horizontal gutter. */
  body: { paddingHorizontal: gutter },
  busy: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.huge,
    paddingHorizontal: spacing.xl,
  },
  form: { gap: spacing.xl, paddingTop: spacing.sm },
});
