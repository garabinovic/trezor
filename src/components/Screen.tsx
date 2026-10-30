import React, { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, useTheme } from '../theme';

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
  keyboardAware?: boolean;
}

export function Screen({
  children,
  scroll = true,
  bottomInset = true,
  header,
  overlay,
  keyboardAware = false,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPadding = (bottomInset ? insets.bottom : 0) + spacing.xxxl;

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

  const body = (
    <View
      style={[
        styles.flex,
        { paddingTop: insets.top, backgroundColor: theme.colors.background },
      ]}
    >
      {header}
      {content}
      {overlay}
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
