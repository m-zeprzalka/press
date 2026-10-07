/**
 * The platform-facing services the game controller depends on. main.ts builds them from
 * src/platform and src/audio; tests and the tutorial can provide fakes.
 */
import type { MetaState } from '../core/meta';
import type { RunState } from '../core/run';

export type SfxName = string;
export type RunKind = 'normal' | 'daily';
export type RewardKind = 'reroll' | 'reprint' | 'daily_attempt';
export type RewardResult = 'rewarded' | 'dismissed' | 'unavailable';
export type InterstitialTrigger = 'new_run_button' | 'menu_button';

export interface AudioService {
  unlock(): void;
  play(sfx: SfxName, opts?: { pitch?: number; intensity?: number }): void;
  setMusic(mode: 'menu' | 'game' | 'off'): void;
  setIntensity(v: number): void;
  setMusicVolume(v: number): void;
  setSfxVolume(v: number): void;
  suspend(): void;
  resume(): void;
}

export interface HapticsService {
  impact(kind: 'light' | 'medium' | 'heavy'): void;
  notify(kind: 'success' | 'warning' | 'error'): void;
  selection(): void;
  setEnabled(on: boolean): void;
}

export interface SaveService {
  loadRun(kind: RunKind): Promise<RunState | null>;
  saveRun(kind: RunKind, state: RunState): void;
  clearRun(kind: RunKind): Promise<void>;
  loadMeta(): Promise<MetaState>;
  saveMeta(meta: MetaState): void;
  loadJSON<T>(key: string, fallback: T): Promise<T>;
  saveJSON(key: string, value: unknown): void;
  flush(): Promise<void>;
}

export interface AdsService {
  start(opts: { sessionIndex: number; noAds: boolean }): Promise<void>;
  needsConsentForm(): boolean;
  showConsentForm(): Promise<void>;
  privacyOptionsRequired(): boolean;
  showPrivacyOptions(): Promise<void>;
  /** Can an ad of this kind be shown now (SDK ready, consent ok)? */
  available(kind: 'rewarded' | 'interstitial'): boolean;
  showRewarded(
    kind: RewardKind,
    hooks: { beforeShow(): Promise<void>; onReward(): void },
  ): Promise<RewardResult>;
  maybeShowInterstitial(ctx: {
    trigger: InterstitialTrigger;
    resultsVisibleMs: number;
    rewardedThisRun: boolean;
    noAds: boolean;
  }): Promise<boolean>;
  onRunCompleted(lost: boolean): void;
}

export interface IapService {
  readonly available: boolean;
  readonly entitled: boolean;
  readonly pending: boolean;
  refresh(): Promise<void>;
  product(): Promise<{ price: string } | null>;
  purchase(): Promise<'purchased' | 'pending' | 'cancelled' | 'already_owned' | 'error' | 'unavailable'>;
  restore(): Promise<void>;
  onChange(cb: () => void): () => void;
}

export interface LifecycleService {
  readonly sessionIndex: number;
  readonly isFirstSession: boolean;
  onPause(cb: () => void): void;
  onResume(cb: () => void): void;
  setAdShowing(on: boolean): void;
}

export interface BackService {
  push(handler: () => boolean | void): () => void;
}

export interface Services {
  isNative: boolean;
  audio: AudioService;
  haptics: HapticsService;
  saves: SaveService;
  ads: AdsService;
  iap: IapService;
  lifecycle: LifecycleService;
  back: BackService;
  share(text: string): Promise<'shared' | 'copied' | 'failed'>;
  openUrl(url: string): void;
  setFullscreen(on: boolean): void;
}
