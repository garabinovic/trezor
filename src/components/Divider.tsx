import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

interface DividerProps {
  /** Left inset, typically to align with list item text. */
  inset?: number;
}

export function Divider({ inset = 0 }: DividerProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        marginLeft: inset,
        backgroundColor: theme.colors.border,
      }}
    />
  );
}
