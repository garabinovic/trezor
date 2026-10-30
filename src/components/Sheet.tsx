import React, { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { gutter, Theme, useStyles } from '../theme';
import { Text } from './Text';

interface SheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom sheet for short choices. Tap outside or press back to close. */
export function Sheet({ visible, title, onClose, children }: SheetProps) {
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close"
        />
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />
          <Text variant="headline" style={styles.title}>
            {title}
          </Text>
          {children}
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
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingTop: spacing.sm,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.borderStrong,
      marginBottom: spacing.lg,
    },
    title: { paddingHorizontal: gutter, marginBottom: spacing.sm },
  });
