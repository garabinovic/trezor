import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ItemsProvider } from './data';
import { RootNavigator } from './navigation/RootNavigator';
import { ThemeProvider } from './theme';

export function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ItemsProvider>
          <RootNavigator />
        </ItemsProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
