/**
 * App-level configuration. Ad unit IDs default to Google's public TEST IDs; release builds
 * inject production IDs through Vite env variables set from CI secrets (docs/RELEASE.md).
 */

/** Google's official AdMob test ad units (safe for development). */
export const ADMOB_TEST_IDS = {
  appId: 'ca-app-pub-3940256099942544~3347511713',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
} as const;

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

/** True only for store builds that were given production ad IDs. */
export const USE_PRODUCTION_ADS = env.VITE_ADS_MODE === 'production';

export const ADS = {
  rewarded: (USE_PRODUCTION_ADS && env.VITE_ADMOB_REWARDED_ID) || ADMOB_TEST_IDS.rewarded,
  interstitial: (USE_PRODUCTION_ADS && env.VITE_ADMOB_INTERSTITIAL_ID) || ADMOB_TEST_IDS.interstitial,
  /** Test builds request test ads and use EEA debug geography for the UMP form. */
  testing: !USE_PRODUCTION_ADS,
  /** Device hashes that should see test ads even with production IDs (closed testing). */
  testDevices: (env.VITE_ADMOB_TEST_DEVICES ?? '').split(',').filter(Boolean),
} as const;

/** Google Play one-time product for "No ads". Frozen forever once published. */
export const IAP_NO_ADS_PRODUCT_ID = 'press_no_ads';

/** Public privacy policy URL (must be reachable without login; see docs/RELEASE.md). */
export const PRIVACY_POLICY_URL = env.VITE_PRIVACY_URL ?? 'https://m-zeprzalka.github.io/press/privacy.html';

export const APP_VERSION = env.VITE_APP_VERSION ?? '1.0.0';
