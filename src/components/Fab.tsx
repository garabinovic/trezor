import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Plus } from 'lucide-react-native';
import { spacing, Theme, useStyles } from '../theme';
import { Icon } from './Icon';

interface FabProps {
  label: string;
  onPress: () => void;
}

const SIZE = 56;

/** Height a Fab takes at the bottom of its screen, for content placed above it. */
export const fabClearance = SIZE + spacing.xl;

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

const createStyles = ({ colors, radius }: Theme) =>
  StyleSheet.create({
    fab: {
      position: 'absolute',
      right: spacing.xl,
      bottom: spacing.xl,
      width: SIZE,
      height: SIZE,
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
