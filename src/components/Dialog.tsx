import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Theme, useStyles } from '../theme';
import { Button } from './Button';
import { Text } from './Text';

interface DialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Centered confirmation dialog. */
export function Dialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: DialogProps) {
  const styles = useStyles(createStyles);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityLabel="Close dialog"
        />
        <View style={styles.dialog} accessibilityViewIsModal>
          <Text variant="headline">{title}</Text>
          {!!message && (
            <Text variant="callout" color="textSecondary">
              {message}
            </Text>
          )}
          <View style={styles.actions}>
            <Button
              label={cancelLabel}
              onPress={onCancel}
              variant="ghost"
              size="sm"
            />
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? 'destructive' : 'primary'}
              size="sm"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = ({ colors, radius, spacing }: Theme) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.scrim,
      justifyContent: 'center',
      padding: spacing.xxxl,
    },
    dialog: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.xxl,
      gap: spacing.md,
      maxWidth: 420,
      width: '100%',
      alignSelf: 'center',
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
  });
