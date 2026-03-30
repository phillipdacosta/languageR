import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.languageapp.learning',
  appName: 'language-learning-app',
  webDir: 'www',
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#ffffff',
      showSpinner: false,
      androidScaleType: 'CENTER',
      splashFullScreen: false,
      splashImmersive: false,
    }
  }
};

export default config;
