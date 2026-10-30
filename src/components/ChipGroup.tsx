import React from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Theme, useStyles } from '../theme';
import { Text } from './Text';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface ChipGroupProps<T extends string> {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the whole group. */
  label: string;
  /** Adds the screen gutter; turn off when placed inside a padded form. */
  inset?: boolean;
}

/** Single-select chips, used for list filters and short form choices. */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  inset = true,
}: ChipGroupProps<T>) {
  const styles = useStyles(createStyles);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      contentContainerStyle={[styles.row, inset && styles.inset]}
      keyboardShouldPersistTaps="handled"
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.selected,
              pressed && !selected && styles.pressed,
            ]}
          >
            <Text variant="label" color={selected ? 'accent' : 'textSecondary'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const createStyles = ({ colors, radius, spacing }: Theme) =>
  StyleSheet.create({
    row: { gap: spacing.sm },
    inset: { paddingHorizontal: spacing.xl },
    chip: {
      height: 36,
      paddingHorizontal: 14,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    selected: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accentSoft,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
  });
