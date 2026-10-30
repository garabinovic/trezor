import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { Theme, useStyles } from '../theme';
import { Icon } from './Icon';
import { Text, TextColor } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: LucideIcon;
  disabled?: boolean;
  fullWidth?: boolean;
}

const labelColor: Record<ButtonVariant, TextColor> = {
  primary: 'onAccent',
  secondary: 'text',
  ghost: 'accent',
  destructive: 'danger',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  fullWidth = false,
}: ButtonProps) {
  const styles = useStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        styles[variant],
        pressed && styles[`${variant}Pressed`],
        fullWidth && styles.fullWidth,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.content}>
        {icon && <Icon icon={icon} size="md" color={labelColor[variant]} />}
        <Text
          variant={size === 'sm' ? 'label' : 'bodyStrong'}
          color={labelColor[variant]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const createStyles = ({ colors, radius, spacing }: Theme) =>
  StyleSheet.create({
    base: {
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    md: { minHeight: 48, paddingHorizontal: spacing.xl },
    sm: { minHeight: 36, paddingHorizontal: spacing.md },
    fullWidth: { alignSelf: 'stretch' },
    content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    primary: { backgroundColor: colors.accent },
    primaryPressed: { opacity: 0.85 },
    secondary: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
    },
    secondaryPressed: { backgroundColor: colors.surfaceMuted },
    ghost: { backgroundColor: 'transparent' },
    ghostPressed: { backgroundColor: colors.accentSoft },
    destructive: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
    },
    destructivePressed: { backgroundColor: colors.dangerSoft },
    disabled: { opacity: 0.4 },
  });
