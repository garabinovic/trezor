import React from 'react';
import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { House, LucideIcon } from 'lucide-react-native';
import { categories } from '../data';
import { iconSize, iconStroke, spacing, typography, useTheme } from '../theme';
import { HomeScreen } from '../screens/HomeScreen';
import { NotesScreen } from '../screens/NotesScreen';
import { RemindersScreen } from '../screens/RemindersScreen';
import { CardsScreen } from '../screens/CardsScreen';
import { DocumentsScreen } from '../screens/DocumentsScreen';
import { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

const tabIcon =
  (Glyph: LucideIcon) =>
  ({ color }: { color: string }) =>
    <Glyph size={iconSize.lg} strokeWidth={iconStroke} color={color} />;

/** Icon + label row, without the space for the system navigation bar. */
const TAB_BAR_CONTENT_HEIGHT = 56;

export function TabNavigator() {
  const { colors } = useTheme();
  // Clear Android's navigation buttons (3-button or gesture bar) with a little
  // room to spare, so the labels don't sit right on top of them.
  const bottom = useSafeAreaInsets().bottom + spacing.sm;
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: { ...typography.caption, fontWeight: '500' },
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
          height: TAB_BAR_CONTENT_HEIGHT + bottom,
          paddingTop: spacing.xs,
          paddingBottom: bottom,
        },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarIcon: tabIcon(House) }}
      />
      <Tab.Screen
        name="Notes"
        component={NotesScreen}
        options={{ tabBarIcon: tabIcon(categories.note.icon) }}
      />
      <Tab.Screen
        name="Reminders"
        component={RemindersScreen}
        options={{ tabBarIcon: tabIcon(categories.reminder.icon) }}
      />
      <Tab.Screen
        name="Cards"
        component={CardsScreen}
        options={{ tabBarIcon: tabIcon(categories.card.icon) }}
      />
      <Tab.Screen
        name="Documents"
        component={DocumentsScreen}
        options={{
          tabBarIcon: tabIcon(categories.document.icon),
          // "Documents" doesn't fit a fifth of a phone screen; the screen
          // title and screen readers keep the full name.
          tabBarLabel: 'Docs',
          tabBarAccessibilityLabel: 'Documents, tab',
        }}
      />
    </Tab.Navigator>
  );
}
