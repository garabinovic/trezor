import React, { useCallback, useEffect, useMemo } from 'react';
import { AppState, StatusBar } from 'react-native';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useNavigationContainerRef,
  Theme as NavigationTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useReminders } from '../reminders/RemindersProvider';
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
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const { platform } = useReminders();

  // A tapped reminder notification opens that reminder's detail screen, whether
  // the app was closed (pending tap read on ready), in the background
  // (foreground event) or already open (tap event). Unknown ids show the
  // existing "Item not found" state; nothing is recreated.
  const openTappedReminder = useCallback(() => {
    if (!navigationRef.isReady()) {
      return;
    }
    const id = platform.consumePendingTap();
    if (id) {
      navigationRef.navigate('ItemDetail', { id });
    }
  }, [navigationRef, platform]);

  useEffect(() => {
    const unsubscribe = platform.onTap(openTappedReminder);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        openTappedReminder();
      }
    });
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, [platform, openTappedReminder]);

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
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      onReady={openTappedReminder}
    >
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
