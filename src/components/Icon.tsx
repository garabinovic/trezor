import React from 'react';
import { LucideIcon } from 'lucide-react-native';
import { iconSize, iconStroke, useTheme } from '../theme';
import { TextColor } from './Text';

interface IconProps {
  icon: LucideIcon;
  size?: keyof typeof iconSize;
  color?: TextColor;
}

export function Icon({
  icon: Glyph,
  size = 'md',
  color = 'textSecondary',
}: IconProps) {
  const theme = useTheme();
  return (
    <Glyph
      size={iconSize[size]}
      strokeWidth={iconStroke}
      color={theme.colors[color]}
    />
  );
}
