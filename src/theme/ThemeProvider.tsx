import React, {
  createContext,
  ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import { createTheme, Theme } from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  // Kept in memory for Phase 0; persisted with the rest of the settings later.
  const [preference, setPreference] = useState<ThemePreference>('system');

  const scheme =
    preference === 'system'
      ? systemScheme === 'dark'
        ? 'dark'
        : 'light'
      : preference;

  const value = useMemo(
    () => ({ theme: createTheme(scheme), preference, setPreference }),
    [scheme, preference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return context;
}

export function useTheme(): Theme {
  return useThemeContext().theme;
}

export function useThemePreference() {
  const { preference, setPreference } = useThemeContext();
  return { preference, setPreference };
}

/**
 * Builds a memoized stylesheet from the current theme.
 * Define the factory at module level so it stays referentially stable.
 */
export function useStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [factory, theme]);
}
