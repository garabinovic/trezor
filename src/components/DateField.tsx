import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Calendar, Clock, X } from 'lucide-react-native';
import { formatFullDate, formatTime } from '../data/format';
import { Theme, useStyles } from '../theme';
import { Icon } from './Icon';
import { Text } from './Text';

interface DateFieldProps {
  label: string;
  value: Date | null;
  onChange: (value: Date | null) => void;
  mode?: 'date' | 'time';
  placeholder?: string;
  /** Shows a clear button when a value is set. */
  clearable?: boolean;
  error?: string;
}

/**
 * Read-only field that opens the platform date or time picker.
 * Phase 0 targets Android; an iOS presentation is added with the iOS app.
 */
export function DateField({
  label,
  value,
  onChange,
  mode = 'date',
  placeholder = 'Not set',
  clearable = false,
  error,
}: DateFieldProps) {
  const styles = useStyles(createStyles);

  const open = () =>
    DateTimePickerAndroid.open({
      value: value ?? new Date(),
      mode,
      is24Hour: true,
      onValueChange: (_event, date) => onChange(date),
    });

  const display = value
    ? mode === 'date'
      ? formatFullDate(value)
      : formatTime(value)
    : placeholder;

  return (
    <View style={styles.container}>
      <Text variant="label" color="textSecondary">
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${display}`}
        onPress={open}
        style={({ pressed }) => [
          styles.field,
          pressed && styles.pressed,
          !!error && styles.invalid,
        ]}
      >
        <Icon icon={mode === 'date' ? Calendar : Clock} size="md" />
        <Text color={value ? 'text' : 'textTertiary'} style={styles.value}>
          {display}
        </Text>
        {clearable && value && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label.toLowerCase()}`}
            hitSlop={12}
            onPress={() => onChange(null)}
          >
            <Icon icon={X} size="md" color="textTertiary" />
          </Pressable>
        )}
      </Pressable>
      {!!error && (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      )}
    </View>
  );
}

const createStyles = ({ colors, radius, spacing }: Theme) =>
  StyleSheet.create({
    container: { gap: spacing.sm, flex: 1 },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 48,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    invalid: { borderColor: colors.danger },
    value: { flex: 1 },
  });
