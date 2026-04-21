import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Appearance, ColorSchemeName, StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DARK_MODE_KEY = 'darkMode';

export interface ThemeColors {
  background: string;
  surface: string;
  card: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderLight: string;
  inputBg: string;
  tabBar: string;
  tabBarBorder: string;
  accent: string;
  /** Solid join CTA (Up Next / event / overlay): black in light mode, blue in dark mode. */
  joinCtaBackground: string;
  danger: string;
  success: string;
  warning: string;
  skeleton: string;
  overlay: string;
  statusBar: 'light-content' | 'dark-content';
  isDark: boolean;
}

const lightColors: ThemeColors = {
  background: '#ffffff',
  surface: '#f7f7f7',
  card: '#ffffff',
  text: '#222222',
  textSecondary: '#717171',
  textTertiary: '#b0b0b0',
  border: '#ebebeb',
  borderLight: '#f0f0f2',
  inputBg: '#f5f5f5',
  tabBar: '#ffffff',
  tabBarBorder: '#e5e5e5',
  accent: '#222222',
  joinCtaBackground: '#000000',
  danger: '#E31C5F',
  success: '#10b981',
  warning: '#ff9500',
  skeleton: '#f0f0f0',
  overlay: 'rgba(0,0,0,0.04)',
  statusBar: 'dark-content',
  isDark: false,
};

/** Dark mode: clear elevation steps so toolbar / tab bar / cards don’t read as one flat slab. */
const darkColors: ThemeColors = {
  /** Root canvas — scroll views, sheet behind content (OLED black). */
  background: '#000000',
  /** Chrome — top toolbars, secondary grouped areas, safe strips that sit above the void. */
  surface: '#1C1C1E',
  /** Raised surfaces — list rows, cards (Apple tertiary grouped; reads above `surface`). */
  card: '#2C2C2E',
  text: '#F5F5F7',
  textSecondary: '#AEAEB2',
  textTertiary: '#636366',
  border: 'rgba(255,255,255,0.12)',
  borderLight: '#3A3A3C',
  inputBg: '#3A3A3C',
  tabBar: '#1C1C1E',
  tabBarBorder: 'rgba(255,255,255,0.18)',
  accent: '#ffffff',
  joinCtaBackground: '#49aeea',
  danger: '#ff4d6d',
  success: '#34d399',
  warning: '#fbbf24',
  skeleton: '#3A3A3C',
  overlay: 'rgba(255,255,255,0.04)',
  statusBar: 'light-content',
  isDark: true,
};

interface ThemeContextValue {
  colors: ThemeColors;
  isDark: boolean;
  toggleDarkMode: () => void;
  setDarkMode: (isDark: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  isDark: false,
  toggleDarkMode: () => {},
  setDarkMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDarkState] = useState(Appearance.getColorScheme() === 'dark');

  useEffect(() => {
    AsyncStorage.getItem(DARK_MODE_KEY).then(saved => {
      if (saved !== null) {
        const dark = saved === 'true';
        setIsDarkState(dark);
        Appearance.setColorScheme(dark ? 'dark' : 'light');
      }
    });
  }, []);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      AsyncStorage.getItem(DARK_MODE_KEY).then(saved => {
        if (saved === null) setIsDarkState(colorScheme === 'dark');
      });
    });
    return () => sub.remove();
  }, []);

  const setDarkMode = useCallback(async (dark: boolean) => {
    setIsDarkState(dark);
    Appearance.setColorScheme(dark ? 'dark' : 'light');
    await AsyncStorage.setItem(DARK_MODE_KEY, dark.toString());
  }, []);

  const toggleDarkMode = useCallback(() => {
    setDarkMode(!isDark);
  }, [isDark, setDarkMode]);

  const colors = useMemo(() => isDark ? darkColors : lightColors, [isDark]);

  const value = useMemo(() => ({ colors, isDark, toggleDarkMode, setDarkMode }), [colors, isDark, toggleDarkMode, setDarkMode]);

  return (
    <ThemeContext.Provider value={value}>
      <StatusBar barStyle={colors.statusBar} />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
