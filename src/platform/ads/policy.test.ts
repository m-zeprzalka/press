import { describe, expect, it } from 'vitest';
import {
  canShowInterstitial,
  interstitialBlock,
  INTERSTITIAL_RULES,
  newAdsState,
  normalizeAdsState,
  onFullscreenShown,
  onRunCompleted,
  REWARDED_CAPS,
  rewardedOffer,
  type AdsState,
  type InterstitialBlock,
  type InterstitialContext,
  type InterstitialTrigger,
  type RewardedCapInput,
} from './policy';

const NOW = 10_000_000;
const GAP = INTERSTITIAL_RULES.minFullscreenGapMs;

/** A state + context where every rule passes. */
const okState: AdsState = {
  completedRuns: 6,
  lostRuns: 4,
  runsSinceInterstitial: 2,
  lastFullscreenAt: NOW - GAP,
  interstitialsShown: 1,
};
const okCtx: InterstitialContext = {
  sessionIndex: 2,
  noAds: false,
  trigger: 'new_run_button',
  resultsVisibleMs: 2000,
  rewardedThisRun: false,
  adLoaded: true,
  now: NOW,
};

interface Row {
  rule: string;
  state?: Partial<AdsState>;
  ctx?: Partial<InterstitialContext>;
  expected: InterstitialBlock | null;
}

const ROWS: Row[] = [
  { rule: 'baseline passes (new run button)', expected: null },
  { rule: 'menu button is a valid trigger', ctx: { trigger: 'menu_button' }, expected: null },
  ...(['back', 'endless_continue', 'abandon', 'cold_start', 'resume'] as InterstitialTrigger[]).map(
    (trigger): Row => ({ rule: `never on trigger ${trigger}`, ctx: { trigger }, expected: 'trigger' }),
  ),
  { rule: 'results visible 1999 ms → no', ctx: { resultsVisibleMs: 1999 }, expected: 'results_too_short' },
  { rule: 'results visible NaN → no', ctx: { resultsVisibleMs: Number.NaN }, expected: 'results_too_short' },
  { rule: 'results visible 2000 ms → ok', ctx: { resultsVisibleMs: 2000 }, expected: null },
  { rule: 'first session → no', ctx: { sessionIndex: 1 }, expected: 'first_session' },
  { rule: 'session 3 → ok', ctx: { sessionIndex: 3 }, expected: null },
  { rule: '1 lost run → no', state: { lostRuns: 1 }, expected: 'too_few_losses' },
  { rule: '2 lost runs → ok', state: { lostRuns: 2 }, expected: null },
  {
    rule: '1 run since last interstitial → no',
    state: { runsSinceInterstitial: 1 },
    expected: 'too_few_runs_since_last',
  },
  { rule: '3 runs since last interstitial → ok', state: { runsSinceInterstitial: 3 }, expected: null },
  {
    rule: 'never shown before → run spacing not required',
    state: { interstitialsShown: 0, runsSinceInterstitial: 0, lastFullscreenAt: null },
    expected: null,
  },
  {
    rule: 'fullscreen 239.999 s ago → no',
    state: { lastFullscreenAt: NOW - GAP + 1 },
    expected: 'too_soon_after_fullscreen',
  },
  { rule: 'fullscreen exactly 240 s ago → ok', state: { lastFullscreenAt: NOW - GAP }, expected: null },
  {
    rule: 'a recent rewarded ad (no interstitial yet) also blocks',
    state: { interstitialsShown: 0, lastFullscreenAt: NOW - 1000 },
    expected: 'too_soon_after_fullscreen',
  },
  {
    rule: 'clock moved back < 240 s → still too soon',
    state: { lastFullscreenAt: NOW + 1000 },
    expected: 'too_soon_after_fullscreen',
  },
  {
    rule: 'clock moved back far → stale timestamp ignored',
    state: { lastFullscreenAt: NOW + GAP * 10 },
    expected: null,
  },
  { rule: 'rewarded watched this run → no', ctx: { rewardedThisRun: true }, expected: 'rewarded_this_run' },
  { rule: 'not loaded → no (never wait)', ctx: { adLoaded: false }, expected: 'not_loaded' },
  { rule: 'no-ads buyer → never', ctx: { noAds: true }, expected: 'no_ads' },
  {
    rule: 'no-ads wins over everything',
    ctx: { noAds: true, trigger: 'back', sessionIndex: 1 },
    state: { lostRuns: 0 },
    expected: 'no_ads',
  },
];

describe('canShowInterstitial (GDD §11.3)', () => {
  it.each(ROWS)('$rule', ({ state, ctx, expected }) => {
    const s = { ...okState, ...state };
    const c = { ...okCtx, ...ctx };
    expect(interstitialBlock(s, c)).toBe(expected);
    expect(canShowInterstitial(s, c)).toBe(expected === null);
  });
});

describe('state transitions', () => {
  it('counts completed and lost runs', () => {
    let s = newAdsState();
    s = onRunCompleted(s, { lost: true });
    s = onRunCompleted(s, { lost: false });
    expect(s).toEqual({ ...newAdsState(), completedRuns: 2, lostRuns: 1, runsSinceInterstitial: 2 });
  });

  it('interstitial resets the run spacing; rewarded only moves the fullscreen clock', () => {
    const base = { ...okState, runsSinceInterstitial: 5 };
    const r = onFullscreenShown(base, NOW, 'rewarded');
    expect(r).toEqual({ ...base, lastFullscreenAt: NOW });
    const i = onFullscreenShown(base, NOW, 'interstitial');
    expect(i).toEqual({ ...base, lastFullscreenAt: NOW, runsSinceInterstitial: 0, interstitialsShown: 2 });
    expect(base.runsSinceInterstitial).toBe(5); // pure
  });

  it('the first interstitial: session ≥ 2 and 2 losses, then two runs between', () => {
    let s = newAdsState();
    const ctx = (now: number): InterstitialContext => ({ ...okCtx, now });
    s = onRunCompleted(s, { lost: true });
    expect(canShowInterstitial(s, ctx(NOW))).toBe(false);
    s = onRunCompleted(s, { lost: true });
    expect(canShowInterstitial(s, ctx(NOW))).toBe(true);
    s = onFullscreenShown(s, NOW, 'interstitial');
    s = onRunCompleted(s, { lost: true });
    expect(canShowInterstitial(s, ctx(NOW + GAP))).toBe(false);
    s = onRunCompleted(s, { lost: false });
    expect(canShowInterstitial(s, ctx(NOW + GAP - 1))).toBe(false);
    expect(canShowInterstitial(s, ctx(NOW + GAP))).toBe(true);
  });

  it('normalizes persisted garbage', () => {
    expect(normalizeAdsState(null)).toEqual(newAdsState());
    expect(
      normalizeAdsState({ completedRuns: 3.7, lostRuns: -1, lastFullscreenAt: 'x', interstitialsShown: 2 }),
    ).toEqual({
      ...newAdsState(),
      completedRuns: 3,
      interstitialsShown: 2,
    });
    expect(normalizeAdsState({ lastFullscreenAt: 5 }).lastFullscreenAt).toBe(5);
  });
});

describe('rewardedOffer (GDD §11.1)', () => {
  const reroll = (o: Partial<Extract<RewardedCapInput, { kind: 'reroll' }>>): RewardedCapInput => ({
    kind: 'reroll',
    mode: 'standard',
    freeRerollsLeft: 0,
    adRerollsHere: 0,
    adRerollsUsed: 0,
    ...o,
  });
  const reprint = (o: Partial<Extract<RewardedCapInput, { kind: 'reprint' }>>): RewardedCapInput => ({
    kind: 'reprint',
    mode: 'standard',
    continueUsed: false,
    freeContinueUsed: true,
    ...o,
  });

  it.each([
    ['reroll after the free one', reroll({}), false, 'ad'],
    ['reroll while a free one is left', reroll({ freeRerollsLeft: 1 }), false, 'none'],
    ['reroll: 1 per screen', reroll({ adRerollsHere: REWARDED_CAPS.rerollsPerScreen }), false, 'none'],
    ['reroll: 3 per run', reroll({ adRerollsUsed: REWARDED_CAPS.rerollsPerRun }), false, 'none'],
    ['reroll: 2 used in run, new screen', reroll({ adRerollsUsed: 2 }), false, 'ad'],
    ['reroll: never in the daily', reroll({ mode: 'daily' }), false, 'none'],
    ['reroll for buyers: free, same caps', reroll({}), true, 'free'],
    ['reroll for buyers capped', reroll({ adRerollsUsed: 3 }), true, 'none'],
    ['reprint: first in life is free', reprint({ freeContinueUsed: false }), false, 'free'],
    ['reprint: then an ad', reprint({}), false, 'ad'],
    ['reprint: 1 per run', reprint({ continueUsed: true }), false, 'none'],
    ['reprint: never in the daily', reprint({ mode: 'daily', freeContinueUsed: false }), false, 'none'],
    ['reprint for buyers', reprint({}), true, 'free'],
    [
      'daily attempt: 1 per day',
      { kind: 'daily_attempt', extraAttemptsToday: 0 } as RewardedCapInput,
      false,
      'ad',
    ],
    [
      'daily attempt used',
      { kind: 'daily_attempt', extraAttemptsToday: 1 } as RewardedCapInput,
      false,
      'none',
    ],
    [
      'daily attempt for buyers',
      { kind: 'daily_attempt', extraAttemptsToday: 0 } as RewardedCapInput,
      true,
      'free',
    ],
  ] as const)('%s', (_name, input, noAds, expected) => {
    expect(rewardedOffer(input, noAds)).toBe(expected);
  });
});
