import React, { useState } from 'react';
import { StyleSheet, TextInput, TextInputProps, View } from 'react-native';
import { Theme, useStyles, useTheme } from '../theme';
import { Text } from './Text';

interface TextFieldProps
  extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label: string;
  helper?: string;
  error?: string;
}

export function TextField({
  label,
  helper,
  error,
  multiline,
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps) {
  const theme = useTheme();
  const styles = useStyles(createStyles);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.container}>
      <Text variant="label" color="textSecondary">
        {label}
      </Text>
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
        style={[
          styles.input,
          multiline && styles.multiline,
          focused && styles.focused,
          !!error && styles.invalid,
        ]}
      />
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
    input: {
      ...typography.body,
      color: colors.text,
      minHeight: 48,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    multiline: { minHeight: 140 },
    focused: { borderColor: colors.accent },
    invalid: { borderColor: colors.danger },
  });
