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
  danger: '#E31C5F',
  success: '#10b981',
  warning: '#ff9500',
  skeleton: '#f0f0f0',
  overlay: 'rgba(0,0,0,0.04)',
  statusBar: 'dark-content',
  isDark: false,
};

const darkColors: ThemeColors = {
  background: '#000000',
  surface: '#000000',
  card: '#1c1c1e',
  text: '#f5f5f7',
  textSecondary: '#8e8e93',
  textTertiary: '#636366',
  border: 'rgba(255,255,255,0.08)',
  borderLight: '#2c2c2e',
  inputBg: '#1c1c1e',
  tabBar: '#1c1c1e',
  tabBarBorder: 'rgba(255,255,255,0.08)',
  accent: '#ffffff',
  danger: '#ff4d6d',
  success: '#34d399',
  warning: '#fbbf24',
  skeleton: '#2c2c2e',
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
