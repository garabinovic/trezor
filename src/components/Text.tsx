import React from 'react';
import { Text as RNText, TextProps as RNTextProps } from 'react-native';
import { TypographyVariant, useTheme } from '../theme';

export type TextColor =
  | 'text'
  | 'textSecondary'
  | 'textTertiary'
  | 'accent'
  | 'danger'
  | 'onAccent';

interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  color?: TextColor;
  align?: 'left' | 'center' | 'right';
}

export function Text({
  variant = 'body',
  color = 'text',
  align,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();
  return (
    <RNText
      {...rest}
      style={[
        theme.typography[variant],
        { color: theme.colors[color] },
        align && { textAlign: align },
        style,
      ]}
    />
  );
}
