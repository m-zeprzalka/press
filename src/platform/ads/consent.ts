/**
 * UMP consent (GDD §11.2) — types and pure helpers shared by the AdMob and web drivers.
 *
 * Sequence (every cold start from session 2, never during play):
 *   1. requestConsentInfo({ tagForUnderAgeOfConsent: false, [debug: EEA + test devices] })
 *   2. status REQUIRED && isConsentFormAvailable → the UI calls showConsentForm() on the title
 *      screen (first natural break), never mid-run.
 *   3. only when canRequestAds → AdMob.initialize(...) → preload. No prepare/show before that.
 *   4. Settings → "Privacy settings" only when privacyOptionsRequirementStatus === REQUIRED.
 */
import {
  AdmobConsentDebugGeography,
  AdmobConsentStatus,
  type AdmobConsentInfo,
  type AdmobConsentRequestOptions,
} from '@capacitor-community/admob';

/**
 * Mirrors the plugin's `PrivacyOptionsRequirementStatus` enum, which admob 8.1.0 declares but
 * does not export from its package entry (consent/index.ts omits it), so it can't be imported.
 */
export type PrivacyOptionsStatus = 'REQUIRED' | 'NOT_REQUIRED' | 'UNKNOWN';
const PRIVACY_STATUSES: readonly string[] = ['REQUIRED', 'NOT_REQUIRED', 'UNKNOWN'];

export interface ConsentSnapshot {
  status: AdmobConsentStatus;
  isConsentFormAvailable: boolean;
  canRequestAds: boolean;
  privacyOptionsRequirementStatus: PrivacyOptionsStatus;
}

/** Nothing known yet / request failed: no ads this session (retried at the end of a run). */
export const UNKNOWN_CONSENT: ConsentSnapshot = {
  status: AdmobConsentStatus.UNKNOWN,
  isConsentFormAvailable: false,
  canRequestAds: false,
  privacyOptionsRequirementStatus: 'UNKNOWN',
};

/** What the web/PWA simulation reports (no regulated geography, ads allowed). */
export const WEB_CONSENT: ConsentSnapshot = {
  status: AdmobConsentStatus.NOT_REQUIRED,
  isConsentFormAvailable: false,
  canRequestAds: true,
  privacyOptionsRequirementStatus: 'NOT_REQUIRED',
};

export function consentRequestOptions(
  testing: boolean,
  testDevices: readonly string[],
): AdmobConsentRequestOptions {
  const opts: AdmobConsentRequestOptions = { tagForUnderAgeOfConsent: false };
  if (testing) {
    opts.debugGeography = AdmobConsentDebugGeography.EEA;
    if (testDevices.length > 0) opts.testDeviceIdentifiers = [...testDevices];
  }
  return opts;
}

/**
 * Normalises plugin output. `showConsentForm()` omits `isConsentFormAvailable`, so the
 * previous value is carried over; a missing `canRequestAds` is treated as false.
 */
export function toSnapshot(
  info: Partial<AdmobConsentInfo> | null | undefined,
  prev?: ConsentSnapshot,
): ConsentSnapshot {
  const base = prev ?? UNKNOWN_CONSENT;
  if (!info) return { ...base };
  const status = Object.values(AdmobConsentStatus).includes(info.status as AdmobConsentStatus)
    ? (info.status as AdmobConsentStatus)
    : base.status;
  const rawPors = String(info.privacyOptionsRequirementStatus ?? '');
  const pors = PRIVACY_STATUSES.includes(rawPors)
    ? (rawPors as PrivacyOptionsStatus)
    : base.privacyOptionsRequirementStatus;
  return {
    status,
    isConsentFormAvailable:
      typeof info.isConsentFormAvailable === 'boolean'
        ? info.isConsentFormAvailable
        : base.isConsentFormAvailable,
    canRequestAds: info.canRequestAds === true,
    privacyOptionsRequirementStatus: pors,
  };
}

export function needsConsentForm(c: ConsentSnapshot | null): boolean {
  return !!c && c.status === AdmobConsentStatus.REQUIRED && c.isConsentFormAvailable;
}

export function privacyOptionsRequired(c: ConsentSnapshot | null): boolean {
  return !!c && c.privacyOptionsRequirementStatus === 'REQUIRED';
}
