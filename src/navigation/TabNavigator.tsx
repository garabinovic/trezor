import React from 'react';
import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { House, LucideIcon } from 'lucide-react-native';
import { categories } from '../data';
import { iconSize, iconStroke, typography, useTheme } from '../theme';
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

export function TabNavigator() {
  const { colors } = useTheme();
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
        options={{ tabBarIcon: tabIcon(categories.document.icon) }}
      />
    </Tab.Navigator>
  );
}
