import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { Theme, useStyles, useTheme } from '../theme';
import { Icon } from './Icon';
import { Text } from './Text';

interface SearchFieldProps {
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  autoFocus?: boolean;
  /** When set, the field is a button (e.g. opens the Search screen). */
  onPress?: () => void;
}

export function SearchField({
  placeholder = 'Search',
  value,
  onChangeText,
  autoFocus,
  onPress,
}: SearchFieldProps) {
  const theme = useTheme();
  const styles = useStyles(createStyles);

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="search"
        accessibilityLabel={placeholder}
        onPress={onPress}
        style={({ pressed }) => [styles.field, pressed && styles.pressed]}
      >
        <Icon icon={Search} size="md" color="textTertiary" />
        <Text color="textTertiary">{placeholder}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.field}>
      <Icon icon={Search} size="md" color="textTertiary" />
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        autoFocus={autoFocus}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textTertiary}
        selectionColor={theme.colors.accent}
        cursorColor={theme.colors.accent}
        returnKeyType="search"
        autoCorrect={false}
        style={styles.input}
      />
      {!!value && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={12}
          onPress={() => onChangeText?.('')}
        >
          <Icon icon={X} size="md" color="textTertiary" />
        </Pressable>
      )}
    </View>
  );
}

const createStyles = ({ colors, radius, spacing, typography }: Theme) =>
  StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      height: 46,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceMuted,
    },
    pressed: { opacity: 0.7 },
    input: {
      ...typography.body,
      flex: 1,
      color: colors.text,
      paddingVertical: 0,
    },
  });
