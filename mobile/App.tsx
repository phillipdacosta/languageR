import React, { useCallback, useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { StatusBar } from 'expo-status-bar';
import { Asset } from 'expo-asset';

import './src/i18n';
import { AuthProvider } from './src/hooks/useAuth';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import RootNavigator from './src/navigation/RootNavigator';

const preloadAssets = [
  require('./assets/shared/barnabi-bird.png'),
  require('./assets/shared/calendar-mobile.png'),
  require('./assets/shared/setup-availability-arrow.png'),
  require('./assets/shared/classroom.png'),
  require('./assets/shared/quick-actions-create-material.png'),
  require('./assets/shared/quick-actions-forum.png'),
  require('./assets/shared/materials-gateway.png'),
  require('./assets/shared/bundles-gateway.png'),
];

export default function App() {
  const [ready, setReady] = useState(false);

  const loadResources = useCallback(async () => {
    await Asset.loadAsync(preloadAssets);
    setReady(true);
  }, []);

  useEffect(() => { loadResources(); }, [loadResources]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ThemeProvider>
            <AppInner />
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppInner() {
  const { colors, isDark } = useTheme();
  const navTheme = isDark
    ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.background, card: colors.card, text: colors.text, border: colors.border, primary: colors.accent } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.background, card: colors.card, text: colors.text, border: colors.border, primary: colors.accent } };

  return (
    <AuthProvider>
      <NavigationContainer theme={navTheme}>
        <RootNavigator />
        <StatusBar style={isDark ? 'light' : 'dark'} />
      </NavigationContainer>
    </AuthProvider>
  );
}
