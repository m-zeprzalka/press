/**
 * Shared ad types: the public `AdsService` and the `AdDriver` seam implemented by the AdMob
 * driver (native) and the DOM simulation (web/PWA).
 */
import type { ConsentSnapshot } from './consent';
import type { AdsState, InterstitialTrigger, RewardedKind } from './policy';

export type RewardedResult = 'rewarded' | 'dismissed' | 'unavailable';
export type FullscreenAdKind = 'rewarded' | 'interstitial';

export interface RewardedHooks {
  /** Persist `pendingAd` before the ad opens (the process may die while it plays). */
  beforeShow(): Promise<void>;
  /** Called once, synchronously from the SDK's Rewarded event: persist `rewardGranted` now. */
  onReward(): void;
  /**
   * Checked after the ad has loaded and right before it would open: returning false (the player
   * cancelled, or the screen that asked for the reward is gone) skips the ad → 'unavailable'.
   */
  stillValid?(): boolean;
}

export interface AdsStartOptions {
  sessionIndex: number;
  noAds: boolean;
}

export interface InterstitialRequest {
  trigger: InterstitialTrigger;
  resultsVisibleMs: number;
  rewardedThisRun: boolean;
  /** Override the clock (tests). */
  now?: number;
}

export type AdsPhase =
  /** Not started: first session, "No ads" buyer, or start() not called yet. */
  | 'off'
  | 'consent'
  /** Consent known but ads may not be requested (form pending, declined, or not obtainable). */
  | 'blocked'
  | 'initializing'
  | 'ready'
  /** Consent request or initialize failed (offline…): no ads now, retried at the end of a run. */
  | 'error';

export interface AdsService {
  start(opts: AdsStartOptions): Promise<void>;
  readonly phase: AdsPhase;
  /** UMP verdict (false until consent info was obtained; always false for buyers). */
  readonly canRequestAds: boolean;
  /** True for "No ads" buyers: reward buttons show without the ▶ icon and grant instantly. */
  readonly rewardsAreFree: boolean;
  needsConsentForm(): boolean;
  /** Show the UMP form — title screen only, never during play. Initializes ads if allowed. */
  showConsentForm(): Promise<void>;
  privacyOptionsRequired(): boolean;
  showPrivacyOptions(): Promise<void>;
  /**
   * rewarded: a reward button may be shown (ad ready or loadable within the 6 s wait, or the
   * reward is free for buyers). interstitial: one is loaded and could be shown right now.
   */
  available(kind: FullscreenAdKind): boolean;
  isLoaded(kind: FullscreenAdKind): boolean;
  showRewarded(kind: RewardedKind, hooks: RewardedHooks): Promise<RewardedResult>;
  maybeShowInterstitial(req: InterstitialRequest): Promise<boolean>;
  /** Call once per run reaching the Result screen (counts towards interstitial rules). */
  onRunCompleted(run: { lost: boolean }): Promise<void>;
  /** Entitlement changed (purchase / refund). Buyers never touch the SDK again this session. */
  setNoAds(noAds: boolean): void;
  /** Re-run a failed consent/initialize and reload missing ads (also done by onRunCompleted). */
  retry(): Promise<void>;
  readonly state: Readonly<AdsState>;
  readonly showing: boolean;
  /** Availability/phase changed (re-render ad buttons). */
  onChange(cb: () => void): () => void;
  dispose(): void;
}

export type DriverRewardedResult = 'rewarded' | 'dismissed' | 'failed';
export type DriverInterstitialResult = 'shown' | 'failed';

/** Low-level SDK seam. Load/show methods enforce the init-ordering guard. */
export interface AdDriver {
  readonly name: 'admob' | 'web';
  readonly initialized: boolean;
  requestConsentInfo(): Promise<ConsentSnapshot>;
  showConsentForm(prev: ConsentSnapshot | null): Promise<ConsentSnapshot>;
  showPrivacyOptionsForm(): Promise<void>;
  initialize(): Promise<void>;
  /** Resolves true once loaded; false when skipped (guard in production, discarded). Rejects on load failure. */
  loadRewarded(): Promise<boolean>;
  /** Resolves when the ad closed; `onReward` fires from the Rewarded event only. */
  showRewarded(onReward: () => void): Promise<DriverRewardedResult>;
  loadInterstitial(): Promise<boolean>;
  /** Resolves when the ad closed (or failed to open). */
  showInterstitial(): Promise<DriverInterstitialResult>;
  isLoaded(kind: FullscreenAdKind): boolean;
  /** Forget loaded ads (consent withdrawn, "No ads" bought). */
  discard(): void;
}

/** Thrown in dev builds when an ad would be prepared/shown before AdMob.initialize (GDD §11.2). */
export class AdsOrderError extends Error {
  constructor(op: string) {
    super(`[press.ads] ${op} called before AdMob.initialize (consent/initialize order violated)`);
    this.name = 'AdsOrderError';
  }
}

/**
 * The ordering guard: returns true when the SDK is initialized. Otherwise throws in strict
 * (dev) mode and returns false in production, where the caller turns it into 'unavailable'.
 */
export function guardInitialized(initialized: boolean, strict: boolean, op: string): boolean {
  if (initialized) return true;
  if (strict) throw new AdsOrderError(op);
  return false;
}
