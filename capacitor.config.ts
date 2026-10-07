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
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: '#F2ECDF',
      showSpinner: false,
    },
  },
};

export default config;
