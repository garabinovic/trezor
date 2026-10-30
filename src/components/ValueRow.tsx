import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { gutter, spacing } from '../theme';
import { Icon } from './Icon';
import { Text, TextColor } from './Text';

interface ValueRowProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  valueColor?: TextColor;
}

/** Read-only label/value pair for detail screens. */
export function ValueRow({
  label,
  value,
  icon,
  valueColor = 'text',
}: ValueRowProps) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      {icon && <Icon icon={icon} size="md" />}
      <Text color="textSecondary" style={styles.label}>
        {label}
      </Text>
      <Text color={valueColor} style={styles.value} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: gutter,
    paddingVertical: spacing.md,
  },
  label: { flex: 1 },
  value: { flexShrink: 1, textAlign: 'right' },
});
