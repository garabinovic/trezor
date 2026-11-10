import React, { ComponentRef, ReactNode, Ref, useState } from 'react';
import { StyleSheet, TextInput, TextInputProps, View } from 'react-native';
import { Theme, useStyles, useTheme } from '../theme';
import { Text } from './Text';

interface TextFieldProps
  extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label: string;
  helper?: string;
  error?: string;
  /** Shown inside the field, after the text (e.g. a show/hide button). */
  trailing?: ReactNode;
  ref?: Ref<ComponentRef<typeof TextInput>>;
}

export function TextField({
  label,
  helper,
  error,
  trailing,
  multiline,
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps) {
  const theme = useTheme();
  const styles = useStyles(createStyles);
  const [focused, setFocused] = useState(false);

  const box = [
    styles.box,
    multiline && styles.multiline,
    focused && styles.focused,
    !!error && styles.invalid,
  ];
  const input = (
    <TextInput
      {...rest}
      accessibilityLabel={label}
      multiline={multiline}
      textAlignVertical={multiline ? 'top' : 'center'}
      placeholderTextColor={theme.colors.textTertiary}
      selectionColor={theme.colors.accent}
      cursorColor={theme.colors.accent}
      onFocus={e => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={e => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={trailing ? [styles.text, styles.grow] : [...box, styles.text]}
    />
  );

  return (
    <View style={styles.container}>
      <Text variant="label" color="textSecondary">
        {label}
      </Text>
      {trailing ? (
        <View style={[...box, styles.row]}>
          {input}
          {trailing}
        </View>
      ) : (
        input
      )}
      {(error || helper) && (
        <Text variant="caption" color={error ? 'danger' : 'textTertiary'}>
          {error ?? helper}
        </Text>
      )}
    </View>
  );
}

const createStyles = ({ colors, radius, spacing, typography }: Theme) =>
  StyleSheet.create({
    container: { gap: spacing.sm },
    box: {
      minHeight: 48,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    text: {
      ...typography.body,
      color: colors.text,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingRight: spacing.xs,
    },
    grow: { flex: 1 },
    multiline: { minHeight: 140 },
    focused: { borderColor: colors.accent },
    invalid: { borderColor: colors.danger },
  });
