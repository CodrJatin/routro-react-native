import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import { colorsFor, radius, spacing, typography, type ColorTokens, type ThemeMode } from './tokens';

export type ThemePreference = ThemeMode | 'system';

const STORAGE_KEY = 'metrosync.themePreference';

interface ThemeContextValue {
  /** What the user picked in Settings: 'light' | 'dark' | 'system'. */
  preference: ThemePreference;
  /** The resolved mode actually rendered right now. */
  mode: ThemeMode;
  colors: ColorTokens;
  typography: typeof typography;
  spacing: typeof spacing;
  radius: typeof radius;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useSystemColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setPreferenceState(stored);
      }
      setIsHydrated(true);
    });
  }, []);

  function setPreference(next: ThemePreference) {
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  }

  // Default to dark until AsyncStorage resolves, matching the app's dark-first design.
  const mode: ThemeMode = !isHydrated
    ? 'dark'
    : preference === 'system'
      ? (systemScheme === 'light' ? 'light' : 'dark')
      : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      mode,
      colors: colorsFor(mode),
      typography,
      spacing,
      radius,
      setPreference,
    }),
    [preference, mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
