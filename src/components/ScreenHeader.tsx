import React, { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ArrowLeft, LucideIcon } from 'lucide-react-native';
import { gutter, spacing } from '../theme';
import { Divider } from './Divider';
import { IconButton } from './IconButton';
import { Text } from './Text';

interface LargeHeaderProps {
  title: string;
  /** Secondary line below the divider, e.g. today's date or an item count. */
  subtitle?: string;
  actions?: ReactNode;
}

/**
 * Top-level screens: the title and actions on one row (as tall as BarHeader),
 * a divider, then the optional subtitle.
 */
export function LargeHeader({ title, subtitle, actions }: LargeHeaderProps) {
  return (
    <View>
      <View style={styles.large}>
        <Text
          variant="title"
          accessibilityRole="header"
          numberOfLines={1}
          style={styles.largeTitle}
        >
          {title}
        </Text>
        <View style={styles.actionsRow}>{actions}</View>
      </View>
      <Divider />
      {/* Always reserve the line so content doesn't shift between screens. */}
      <Text variant="label" color="textTertiary" style={styles.subtitle}>
        {subtitle ?? ' '}
      </Text>
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
    alignItems: 'center',
    height: 56,
    marginTop: spacing.sm,
    paddingHorizontal: gutter,
  },
  largeTitle: { flex: 1 },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: -spacing.sm,
  },
  subtitle: {
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
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
