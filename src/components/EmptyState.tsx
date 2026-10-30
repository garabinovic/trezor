import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { Theme, useStyles } from '../theme';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  message?: string;
  actionLabel?: string;
  onActionPress?: () => void;
}

export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onActionPress,
}: EmptyStateProps) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Icon icon={icon} size="lg" />
      </View>
      <Text variant="headline" align="center">
        {title}
      </Text>
      {!!message && (
        <Text
          variant="callout"
          color="textSecondary"
          align="center"
          style={styles.message}
        >
          {message}
        </Text>
      )}
      {actionLabel && onActionPress && (
        <View style={styles.action}>
          <Button
            label={actionLabel}
            onPress={onActionPress}
            variant="secondary"
          />
        </View>
      )}
    </View>
  );
}

const createStyles = ({ colors, radius, spacing }: Theme) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      paddingHorizontal: spacing.xxxl,
      paddingVertical: spacing.huge,
      gap: spacing.sm,
    },
    iconCircle: {
      width: 56,
      height: 56,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    message: { maxWidth: 300 },
    action: { marginTop: spacing.lg },
  });
