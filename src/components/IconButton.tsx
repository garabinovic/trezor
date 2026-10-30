import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { minTouchTarget, Theme, useStyles } from '../theme';
import { Icon } from './Icon';
import { TextColor } from './Text';

interface IconButtonProps {
  icon: LucideIcon;
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  onPress: () => void;
  color?: TextColor;
}

export function IconButton({
  icon,
  label,
  onPress,
  color = 'text',
}: IconButtonProps) {
  const styles = useStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.base, pressed && styles.pressed]}
    >
      <Icon icon={icon} size="lg" color={color} />
    </Pressable>
  );
}

const createStyles = ({ colors, radius }: Theme) =>
  StyleSheet.create({
    base: {
      width: minTouchTarget,
      height: minTouchTarget,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { backgroundColor: colors.surfaceMuted },
  });
