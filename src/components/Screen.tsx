import React, { ReactNode, useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { gutter, spacing, useTheme } from '../theme';

interface ScreenProps {
  children: ReactNode;
  /** Wrap content in a ScrollView. Use `false` for screens with a FlatList. */
  scroll?: boolean;
  /** Pad the bottom safe area. Off for tab screens (the tab bar handles it). */
  bottomInset?: boolean;
  /** Fixed content outside the scroll area, e.g. a header. */
  header?: ReactNode;
  /** Floating content, e.g. a FAB. */
  overlay?: ReactNode;
  /**
   * Fixed content below the scroll area, e.g. a form's primary action: within
   * thumb reach, above the system navigation and, with `keyboardAware`, right
   * above the keyboard. The scroll area ends above it, so it never covers the
   * last field.
   */
  footer?: ReactNode;
  keyboardAware?: boolean;
}

export function Screen({
  children,
  scroll = true,
  bottomInset = true,
  header,
  overlay,
  footer,
  keyboardAware = false,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardOpen(footer !== undefined);
  // With a footer, the footer clears the navigation bar instead.
  const bottomPadding =
    footer !== undefined
      ? spacing.lg
      : (bottomInset ? insets.bottom : 0) + spacing.xxxl;

  const content = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.flex}>{children}</View>
  );

  // Left and right insets: in landscape the system navigation (or a display
  // cutout) sits on either side; whichever it is, nothing is drawn under it.
  const body = (
    <View
      style={[
        styles.flex,
        {
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          backgroundColor: theme.colors.background,
        },
      ]}
    >
      {header}
      {content}
      {footer !== undefined && (
        <View
          style={[
            styles.footer,
            {
              borderTopColor: theme.colors.border,
              backgroundColor: theme.colors.background,
              // The keyboard covers the navigation bar while it is open;
              // tab screens sit above the tab bar, which clears it already.
              paddingBottom:
                (bottomInset && !keyboardOpen ? insets.bottom : 0) + spacing.md,
            },
          ]}
        >
          {footer}
        </View>
      )}
      {overlay !== undefined && (
        // Floating content (the FAB) inside the same safe left/right edges.
        <View
          pointerEvents="box-none"
          style={[
            StyleSheet.absoluteFill,
            { left: insets.left, right: insets.right },
          ]}
        >
          {overlay}
        </View>
      )}
    </View>
  );

  return keyboardAware ? (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {body}
    </KeyboardAvoidingView>
  ) : (
    body
  );
}

/** Whether the software keyboard is shown (only tracked when `enabled`). */
function useKeyboardOpen(enabled: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const shown = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () =>
      setOpen(false),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [enabled]);
  return open;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
