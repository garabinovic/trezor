import React, { useMemo } from 'react';
import { StatusBar } from 'react-native';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  Theme as NavigationTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme';
import { ItemDetailScreen } from '../screens/ItemDetailScreen';
import { ItemEditorScreen } from '../screens/ItemEditorScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { TabNavigator } from './TabNavigator';
import { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const theme = useTheme();
  const { colors } = theme;

  const navigationTheme = useMemo<NavigationTheme>(() => {
    const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.accent,
        background: colors.background,
        card: colors.background,
        text: colors.text,
        border: colors.border,
        notification: colors.danger,
      },
    };
  }, [theme.scheme, colors]);

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar
        barStyle={theme.scheme === 'dark' ? 'light-content' : 'dark-content'}
      />
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'fade_from_bottom',
        }}
      >
        <Stack.Screen name="Tabs" component={TabNavigator} />
        <Stack.Screen name="ItemDetail" component={ItemDetailScreen} />
        <Stack.Screen
          name="ItemEditor"
          component={ItemEditorScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="Search" component={SearchScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
