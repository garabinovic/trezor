import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useStrings } from '../i18n';
import { Theme, useStyles } from '../theme';
import { Button } from './Button';
import { Text } from './Text';

interface DialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  /** `null` hides the cancel button (single-action notice); default "Cancel". */
  cancelLabel?: string | null;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** An optional third action, shown before Cancel. */
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/** Centered confirmation dialog. */
export function Dialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
  secondaryLabel,
  onSecondary,
}: DialogProps) {
  const styles = useStyles(createStyles);
  const t = useStrings();
  const cancel = cancelLabel === undefined ? t.common.cancel : cancelLabel;
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
          accessibilityLabel={t.common.closeDialog}
        />
        <View style={styles.dialog} accessibilityViewIsModal>
          <Text variant="headline">{title}</Text>
          {!!message && (
            <Text variant="callout" color="textSecondary">
              {message}
            </Text>
          )}
          <View style={styles.actions}>
            {secondaryLabel && onSecondary && (
              <Button
                label={secondaryLabel}
                onPress={onSecondary}
                variant="ghost"
                size="sm"
              />
            )}
            {cancel !== null && (
              <Button
                label={cancel}
                onPress={onCancel}
                variant="ghost"
                size="sm"
              />
            )}
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
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
  });
