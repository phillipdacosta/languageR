import React, { useCallback, useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Asset } from 'expo-asset';

import { AuthProvider } from './src/hooks/useAuth';
import RootNavigator from './src/navigation/RootNavigator';

const preloadAssets = [
  require('./assets/shared/barnabi-bird.png'),
  require('./assets/shared/calendar-availability.png'),
  require('./assets/shared/setup-availability-arrow.png'),
  require('./assets/shared/quick-actions-classes.png'),
  require('./assets/shared/quick-actions-create-material.png'),
  require('./assets/shared/quick-actions-forum.png'),
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
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <RootNavigator />
          <StatusBar style="dark" />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
