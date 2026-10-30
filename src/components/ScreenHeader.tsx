import React, { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ArrowLeft, LucideIcon } from 'lucide-react-native';
import { gutter, spacing } from '../theme';
import { IconButton } from './IconButton';
import { Text } from './Text';

interface LargeHeaderProps {
  title: string;
  /** Small line above the title, e.g. today's date or an item count. */
  eyebrow?: string;
  actions?: ReactNode;
}

/** Top-level screens: large title with optional actions on the right. */
export function LargeHeader({ title, eyebrow, actions }: LargeHeaderProps) {
  return (
    <View style={styles.large}>
      <View style={styles.titleColumn}>
        {/* Always reserve the line so titles don't shift between screens. */}
        <Text variant="label" color="textTertiary">
          {eyebrow ?? ' '}
        </Text>
        <Text variant="display" accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
      </View>
      <View style={styles.actionsRow}>{actions}</View>
    </View>
  );
}

interface BarHeaderProps {
  title?: string;
  /** Leading button; defaults to a back arrow when `onBack` is set. */
  onBack?: () => void;
  backIcon?: LucideIcon;
  backLabel?: string;
  actions?: ReactNode;
}

/** Nested screens: back button, optional compact title, actions. */
export function BarHeader({
  title,
  onBack,
  backIcon = ArrowLeft,
  backLabel = 'Back',
  actions,
}: BarHeaderProps) {
  return (
    <View style={styles.bar}>
      {onBack && (
        <IconButton icon={backIcon} label={backLabel} onPress={onBack} />
      )}
      <Text
        variant="headline"
        numberOfLines={1}
        style={styles.barTitle}
        accessibilityRole="header"
      >
        {title}
      </Text>
      <View style={styles.barActions}>{actions}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  large: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: gutter,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  titleColumn: { flex: 1 },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: -spacing.sm,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  barTitle: { flex: 1, paddingHorizontal: spacing.sm },
  barActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
