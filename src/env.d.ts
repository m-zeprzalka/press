/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'production' only for store builds (CI release job). */
  readonly VITE_ADS_MODE?: string;
  readonly VITE_ADMOB_REWARDED_ID?: string;
  readonly VITE_ADMOB_INTERSTITIAL_ID?: string;
  readonly VITE_ADMOB_TEST_DEVICES?: string;
  readonly VITE_PRIVACY_URL?: string;
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
