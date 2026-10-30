import React, { Children, Fragment, ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { gutter, Theme, useStyles } from '../theme';
import { Divider } from './Divider';
import { Text } from './Text';

interface SectionProps {
  title?: string;
  /** Small text action on the right of the title, e.g. "See all". */
  actionLabel?: string;
  onActionPress?: () => void;
  /**
   * Grouped sections sit on a surface with rounded corners and hairline
   * dividers between children (used in Settings and details).
   */
  grouped?: boolean;
  /** Divider inset between grouped children. */
  dividerInset?: number;
  footer?: string;
  children: ReactNode;
}

export function Section({
  title,
  actionLabel,
  onActionPress,
  grouped = false,
  dividerInset = 0,
  footer,
  children,
}: SectionProps) {
  const styles = useStyles(createStyles);
  const rows = Children.toArray(children).filter(Boolean);

  return (
    <View style={styles.section}>
      {(title || actionLabel) && (
        <View style={styles.header}>
          <Text
            variant="label"
            color="textSecondary"
            accessibilityRole="header"
          >
            {title}
          </Text>
          {actionLabel && onActionPress && (
            <Pressable
              accessibilityRole="button"
              onPress={onActionPress}
              hitSlop={12}
            >
              <Text variant="label" color="accent">
                {actionLabel}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {grouped ? (
        <View style={styles.group}>
          {rows.map((child, index) => (
            <Fragment key={index}>
              {index > 0 && <Divider inset={dividerInset} />}
              {child}
            </Fragment>
          ))}
        </View>
      ) : (
        children
      )}
      {!!footer && (
        <Text variant="caption" color="textTertiary" style={styles.footer}>
          {footer}
        </Text>
      )}
    </View>
  );
}

const createStyles = ({ colors, radius, spacing }: Theme) =>
  StyleSheet.create({
    section: { gap: spacing.sm },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: gutter,
      minHeight: 24,
    },
    group: {
      marginHorizontal: spacing.lg,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    footer: { paddingHorizontal: gutter },
  });
