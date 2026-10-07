/**
 * App-level configuration. Development builds use Google's public TEST ad units; release builds
 * (VITE_ADS_MODE=production) take production IDs from Vite env variables set from CI secrets
 * (docs/RELEASE.md).
 *
 * `import.meta.env.*` is read directly (never through an alias) so Vite replaces it statically and
 * the unused branch is dropped: a production bundle contains no test IDs and a test bundle no
 * production IDs. The release workflow greps the bundle to enforce this.
 */

/** True only for store builds that were given production ad IDs. */
export const USE_PRODUCTION_ADS: boolean = import.meta.env.VITE_ADS_MODE === 'production';

interface AdIds {
  readonly rewarded: string;
  readonly interstitial: string;
}

const AD_UNITS: AdIds =
  import.meta.env.VITE_ADS_MODE === 'production'
    ? {
        rewarded: import.meta.env.VITE_ADMOB_REWARDED_ID ?? '',
        interstitial: import.meta.env.VITE_ADMOB_INTERSTITIAL_ID ?? '',
      }
    : {
        // Google's official AdMob test ad units (safe for development and CI).
        rewarded: 'ca-app-pub-3940256099942544/5224354917',
        interstitial: 'ca-app-pub-3940256099942544/1033173712',
      };

export const ADS = {
  rewarded: AD_UNITS.rewarded,
  interstitial: AD_UNITS.interstitial,
  /** Test builds request test ads and use EEA debug geography for the UMP form. */
  testing: !USE_PRODUCTION_ADS,
  /** Device hashes that should see test ads even with production IDs (closed testing). */
  testDevices: (import.meta.env.VITE_ADMOB_TEST_DEVICES ?? '').split(',').filter(Boolean),
} as const;

/** Google Play one-time product for "No ads". Frozen forever once published. */
export const IAP_NO_ADS_PRODUCT_ID = 'press_no_ads';

/** Public privacy policy URL (must be reachable without login; see docs/RELEASE.md). */
export const PRIVACY_POLICY_URL: string =
  import.meta.env.VITE_PRIVACY_URL ?? 'https://m-zeprzalka.github.io/press/privacy.html';

export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '1.0.0';
