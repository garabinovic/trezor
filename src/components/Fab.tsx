import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Plus } from 'lucide-react-native';
import { Theme, useStyles } from '../theme';
import { Icon } from './Icon';

interface FabProps {
  label: string;
  onPress: () => void;
}

/** The single floating "create" action on top-level screens. */
export function Fab({ label, onPress }: FabProps) {
  const styles = useStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
    >
      <Icon icon={Plus} size="lg" color="onAccent" />
    </Pressable>
  );
}

const createStyles = ({ colors, radius, spacing }: Theme) =>
  StyleSheet.create({
    fab: {
      position: 'absolute',
      right: spacing.xl,
      bottom: spacing.xl,
      width: 56,
      height: 56,
      borderRadius: radius.lg,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 3,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
    },
    pressed: { opacity: 0.85 },
  });
