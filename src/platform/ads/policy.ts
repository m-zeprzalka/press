/**
 * Pure ad policy (GDD §11.1 / §11.3). No SDK, no clock, no storage — fully table-tested.
 */
import { BALANCE } from '../../core/config/balance';
import type { RunMode } from '../../core/run';

export interface AdsState {
  /** Runs that reached the Result screen (won or lost), lifetime. */
  completedRuns: number;
  lostRuns: number;
  /** Completed runs since the last interstitial. */
  runsSinceInterstitial: number;
  /** Wall-clock ms of the last fullscreen ad of any kind (interstitial or rewarded). */
  lastFullscreenAt: number | null;
  interstitialsShown: number;
}

export type InterstitialTrigger =
  'new_run_button' | 'menu_button' | 'back' | 'endless_continue' | 'abandon' | 'cold_start' | 'resume';

export interface InterstitialContext {
  sessionIndex: number;
  noAds: boolean;
  trigger: InterstitialTrigger;
  /** How long the Result screen has been visible when the button was tapped. */
  resultsVisibleMs: number;
  /** A rewarded ad was watched during this run. */
  rewardedThisRun: boolean;
  /** An interstitial is loaded right now (we never wait for one). */
  adLoaded: boolean;
  now: number;
}

export const INTERSTITIAL_RULES = {
  triggers: ['new_run_button', 'menu_button'] as readonly InterstitialTrigger[],
  minResultsVisibleMs: 2000,
  minSessionIndex: 2,
  minLostRuns: 2,
  minRunsBetween: 2,
  minFullscreenGapMs: 240_000,
} as const;

export type InterstitialBlock =
  | 'no_ads'
  | 'trigger'
  | 'results_too_short'
  | 'first_session'
  | 'too_few_losses'
  | 'too_few_runs_since_last'
  | 'too_soon_after_fullscreen'
  | 'rewarded_this_run'
  | 'not_loaded';

export function newAdsState(): AdsState {
  return {
    completedRuns: 0,
    lostRuns: 0,
    runsSinceInterstitial: 0,
    lastFullscreenAt: null,
    interstitialsShown: 0,
  };
}

const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;

/** Defensive load of persisted `press.ads`. */
export function normalizeAdsState(raw: unknown): AdsState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof AdsState, unknown>>;
  const last = r.lastFullscreenAt;
  return {
    completedRuns: count(r.completedRuns),
    lostRuns: count(r.lostRuns),
    runsSinceInterstitial: count(r.runsSinceInterstitial),
    lastFullscreenAt: typeof last === 'number' && Number.isFinite(last) ? last : null,
    interstitialsShown: count(r.interstitialsShown),
  };
}

/** First rule that blocks the interstitial, or null when it may be shown. */
export function interstitialBlock(
  state: Readonly<AdsState>,
  ctx: Readonly<InterstitialContext>,
): InterstitialBlock | null {
  const R = INTERSTITIAL_RULES;
  if (ctx.noAds) return 'no_ads';
  if (!R.triggers.includes(ctx.trigger)) return 'trigger';
  if (!(ctx.resultsVisibleMs >= R.minResultsVisibleMs)) return 'results_too_short';
  if (ctx.sessionIndex < R.minSessionIndex) return 'first_session';
  if (state.lostRuns < R.minLostRuns) return 'too_few_losses';
  if (state.interstitialsShown > 0 && state.runsSinceInterstitial < R.minRunsBetween)
    return 'too_few_runs_since_last';
  if (state.lastFullscreenAt !== null && Math.abs(ctx.now - state.lastFullscreenAt) < R.minFullscreenGapMs) {
    // abs(): a clock moved backwards by less than the gap still counts as "too soon".
    return 'too_soon_after_fullscreen';
  }
  if (ctx.rewardedThisRun) return 'rewarded_this_run';
  if (!ctx.adLoaded) return 'not_loaded';
  return null;
}

export function canShowInterstitial(state: Readonly<AdsState>, ctx: Readonly<InterstitialContext>): boolean {
  return interstitialBlock(state, ctx) === null;
}

/** Call once per run that reaches the Result screen. */
export function onRunCompleted(state: Readonly<AdsState>, run: { lost: boolean }): AdsState {
  return {
    ...state,
    completedRuns: state.completedRuns + 1,
    lostRuns: state.lostRuns + (run.lost ? 1 : 0),
    runsSinceInterstitial: state.runsSinceInterstitial + 1,
  };
}

export type FullscreenKind = 'interstitial' | 'rewarded';

export function onFullscreenShown(state: Readonly<AdsState>, now: number, kind: FullscreenKind): AdsState {
  return kind === 'interstitial'
    ? {
        ...state,
        lastFullscreenAt: now,
        runsSinceInterstitial: 0,
        interstitialsShown: state.interstitialsShown + 1,
      }
    : { ...state, lastFullscreenAt: now };
}

// ---------------------------------------------------------------------------- rewarded caps (§11.1)

export type RewardedKind = 'reroll' | 'reprint' | 'daily_attempt';

export type RewardedCapInput =
  | {
      kind: 'reroll';
      mode: RunMode;
      /** Free rerolls left this run (the ad reroll only appears after the free one). */
      freeRerollsLeft: number;
      /** Ad rerolls used on the current offer screen / in the whole run. */
      adRerollsHere: number;
      adRerollsUsed: number;
    }
  | {
      kind: 'reprint';
      mode: RunMode;
      continueUsed: boolean;
      /** The first reprint in a player's life is free (meta.freeContinueUsed). */
      freeContinueUsed: boolean;
    }
  | {
      kind: 'daily_attempt';
      /** Extra (ad) attempts already granted for today's challenge. */
      extraAttemptsToday: number;
    };

/**
 * What a reward button should offer: 'ad' (▶ watch an ad), 'free' (no video: first-ever
 * reprint, or a "No ads" buyer — same limits), or 'none' (hide the button).
 */
export type RewardedOffer = 'ad' | 'free' | 'none';

export const REWARDED_CAPS = {
  rerollsPerScreen: BALANCE.adRerollsPerOffer,
  rerollsPerRun: BALANCE.adRerollsPerRun,
  reprintsPerRun: 1,
  dailyAttemptsPerDay: 1,
} as const;

export function rewardedOffer(input: Readonly<RewardedCapInput>, noAds: boolean): RewardedOffer {
  const paid: RewardedOffer = noAds ? 'free' : 'ad';
  switch (input.kind) {
    case 'reroll':
      if (input.mode === 'daily' || input.freeRerollsLeft > 0) return 'none';
      if (input.adRerollsHere >= REWARDED_CAPS.rerollsPerScreen) return 'none';
      if (input.adRerollsUsed >= REWARDED_CAPS.rerollsPerRun) return 'none';
      return paid;
    case 'reprint':
      if (input.mode === 'daily' || input.continueUsed) return 'none';
      return input.freeContinueUsed ? paid : 'free';
    case 'daily_attempt':
      return input.extraAttemptsToday >= REWARDED_CAPS.dailyAttemptsPerDay ? 'none' : paid;
  }
}
