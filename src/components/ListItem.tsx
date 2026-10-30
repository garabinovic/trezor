import React, { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight, LucideIcon } from 'lucide-react-native';
import { gutter, Theme, useStyles } from '../theme';
import { Icon } from './Icon';
import { Text, TextColor } from './Text';

interface ListItemProps {
  title: string;
  titleColor?: TextColor;
  subtitle?: string;
  subtitleColor?: TextColor;
  subtitleLines?: number;
  /** Icon in a muted tile on the left. */
  icon?: LucideIcon;
  /** Custom leading element, used instead of `icon`. */
  leading?: ReactNode;
  /** Short text on the right, e.g. a date or a value. */
  meta?: string;
  /** Custom trailing element, e.g. a Switch. */
  trailing?: ReactNode;
  chevron?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityHint?: string;
}

/** Left edge of the text column; use as Divider inset under icon rows. */
export const listItemTextInset = gutter + 40 + 14;

export function ListItem({
  title,
  titleColor = 'text',
  subtitle,
  subtitleColor = 'textSecondary',
  subtitleLines = 1,
  icon,
  leading,
  meta,
  trailing,
  chevron = false,
  disabled = false,
  onPress,
  accessibilityHint,
}: ListItemProps) {
  const styles = useStyles(createStyles);

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ disabled }}
      accessibilityHint={accessibilityHint}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        subtitleLines > 1 && styles.topAligned,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {leading ??
        (icon && (
          <View style={styles.iconTile}>
            <Icon icon={icon} size="md" />
          </View>
        ))}
      <View style={styles.body}>
        <Text variant="bodyStrong" color={titleColor} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text
            variant="callout"
            color={subtitleColor}
            numberOfLines={subtitleLines}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {!!meta && (
        <Text variant="caption" color="textTertiary">
          {meta}
        </Text>
      )}
      {trailing}
      {chevron && <Icon icon={ChevronRight} size="md" color="textTertiary" />}
    </Pressable>
  );
}

const createStyles = ({ colors, radius, spacing }: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      minHeight: 64,
      paddingHorizontal: gutter,
      paddingVertical: spacing.md,
    },
    topAligned: { alignItems: 'flex-start' },
    pressed: { backgroundColor: colors.surfaceMuted },
    disabled: { opacity: 0.45 },
    iconTile: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: { flex: 1, gap: spacing.xxs },
  });
