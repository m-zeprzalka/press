# src/platform

The Capacitor/web boundary. Nothing outside this folder imports `@capacitor/*`, `@capacitor-community/*` or `@capgo/*`. Everything is exported from `index.ts`. Each factory takes optional injected dependencies (plugin, clock, DOM targets) for tests.

## Module map

| Module | What it does |
|---|---|
| `env.ts` | `isNative()`, `platformName()`, `IS_DEV`, typed optional browser globals |
| `storage.ts` | `KeyValueStore` (Preferences on native, localStorage + memory fallback on web); `createSaveStore(kv)`: A/B CRC envelopes for runs (`press.run.<kind>.a/b`) and meta (`press.meta.a/b`, backup `press.meta.bak`), coalesced writes, `loadJSON`/`saveJSON`, `flush()` |
| `haptics.ts` | `impact` / `notify` / `selection` (throttled to 40 ms), fire-and-forget, `navigator.vibrate` on web |
| `lifecycle.ts` | pause/resume from `appStateChange` + `visibilitychange`, deduplicated; `setAdShowing`; session counter `press.session` (cold start or > 30 min in background) |
| `back.ts` | `BackRouter`: LIFO handler stack, `backButton` + Escape (web), root back = `App.minimizeApp()` |
| `ads/policy.ts` | pure interstitial rules (§11.3) and rewarded caps (§11.1) |
| `ads/consent.ts` | UMP snapshot types and helpers |
| `ads/admob.ts` / `ads/web.ts` | `AdDriver`s: AdMob, or the DOM "Reklama testowa / Test ad" simulation |
| `ads/index.ts` | `createAdsService()`: consent → initialize → preload, rewarded/interstitial flows, `press.ads` |
| `iap/entitlement.ts` | pure "No ads" entitlement reducer |
| `iap/index.ts` | `createIapService()`: refresh/restore/purchase/product, `press.iap`, serialized Billing calls |
| `share.ts` | `shareText()`: share sheet, Web Share, or clipboard |
| `insets.ts` | `watchInsets(cb)`, `readInsets()`, `applyInsetCssVars()` (`--sa-*`) |
| `pwa.ts` | `registerServiceWorker()` (production web only) |
| `analytics.ts` | `Analytics` interface; `NoopAnalytics` is the default (GDD D25) |

## Boot

`createPlatform().boot()` does the standard wiring. It loads the cached entitlement, starts the back button and starts the session. It calls `ads.start({ sessionIndex, noAds })` on every new session and `iap.refresh()` now and on every resume. Two things are left to the game controller:

- **Audio:** `platform.onFullscreenChange(showing => …)` and `lifecycle.onPause`.
- **Saves:** on pause, call `saveRun(...)` and then `flush()`.

## Consent sequence (GDD §11.2)

1. Session 1: no SDK call of any kind.
2. "No ads" buyers: also no SDK call, including UMP. With no ad SDK running there is nothing to consent to, so the privacy entry stays hidden for them. Their rewards are granted instantly.
3. `requestConsentInfo({ tagForUnderAgeOfConsent: false })`. Test builds add `debugGeography: EEA` and `testDeviceIdentifiers`.
4. If `ads.needsConsentForm()` is true, the title screen calls `ads.showConsentForm()`. Never call it during play.
5. Only when `canRequestAds` is true: `AdMob.initialize(...)`, then preload one rewarded and one interstitial. A prepare or show before initialize throws `AdsOrderError` in dev and returns `'unavailable'` in production.
6. Settings shows "Privacy settings" only when `ads.privacyOptionsRequired()` is true. `ads.showPrivacyOptions()` re-requests consent and drops loaded ads, then reloads them if consent still allows ads.
7. If a step fails or the device is offline, there are no ads for now. `onRunCompleted()` retries.

## Ad IDs

`src/config.ts` defaults to Google's test units. Release builds set `VITE_ADS_MODE=production`, `VITE_ADMOB_REWARDED_ID` and `VITE_ADMOB_INTERSTITIAL_ID`; the app ID goes in `ADMOB_APP_ID` (manifest placeholder). Closed-testing devices go in `VITE_ADMOB_TEST_DEVICES` (comma-separated hashes), which also sets `initializeForTesting`. To swap ads for a test, pass `createAdMobDriver({ config })` or a custom `AdDriver`.

## e2e hooks (web build)

- `window.__pressAdsAutoReward = true`: rewarded ads grant instantly and interstitials close instantly, with no overlay.
- `window.__pressAdsLog = []`: every shown ad is logged.
- Ads need session ≥ 2. Seed `localStorage['press.session'] = '{"index":1}'` before load.
