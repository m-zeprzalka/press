import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'pl.zeprzalka.press',
  appName: 'PRESS',
  webDir: 'dist',
  backgroundColor: '#F2ECDF',
  android: {
    backgroundColor: '#F2ECDF',
    allowMixedContent: false,
    captureInput: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'LIGHT',
    },
    SplashScreen: {
      // Keep the splash until main.ts hides it after the first frame (or on a fatal error).
      launchShowDuration: 10000,
      launchAutoHide: false,
      backgroundColor: '#F2ECDF',
      showSpinner: false,
    },
  },
};

export default config;
