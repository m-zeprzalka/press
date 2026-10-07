/**
 * Every tunable number of the game lives here so the simulator can iterate on it.
 * See docs/GDD.md §5–§9 and docs/balance-report.md.
 */
import type { ModifierId } from '../contracts';

type ByRarity = Record<'common' | 'rare' | 'legendary', number>;

export const BALANCE = {
  // --- Scoring (§5) ---
  /** Prints per ink cell per printed line. */
  cellPrints: 10,
  /** Mult added per monochrome line in a print. */
  monoLineMult: 2,
  /** Dry placements (no print) a streak survives; one more breaks it. */
  streakGrace: 3,

  // --- Contracts (§6) ---
  editions: 8,
  contractsPerEdition: 3,
  baseSheets: 20,
  /** Quota of job 1 and growth per job (smooth exponential, §6.2). */
  quotaStart: 400,
  quotaGrowth: 1.3,
  /** Special job factor on top of the curve (before per-modifier factors). */
  specialFactor: 1.0,
  modifierQuota: {
    rush: 0.8,
    big_format: 1.0,
    wet_ink: 0.8,
    jam: 0.85,
    out_of_ink: 0.85,
    leftover: 0.9,
    failure: 0.9,
    short_tray: 0.9,
    rows_only: 0.75,
  } as Record<ModifierId, number>,
  doubleModifierFromEdition: 7,

  // --- Rewards (§6.3, §9) ---
  /** Share of base sheets used at most → 4 offer cards. */
  earlyShare4Cards: 0.6,
  /** Share of base sheets used at most → rare-or-better guaranteed. */
  earlyShareRare: 0.4,
  skipSheets: 3,
  sellSheets: { common: 1, rare: 1, legendary: 2 } as ByRarity,
  freeRerollsPerRun: 1,
  adRerollsPerOffer: 1,
  adRerollsPerRun: 3,
  continueSheets: 8,
  continueClearRows: 2,
  continueClearCols: 2,
  slots: 5,

  // --- Offer rarity weights (§8.1) ---
  rarityWeights: { common: 64, rare: 30, legendary: 6 } as ByRarity,
  rarityWeightsLate: { common: 58, rare: 32, legendary: 10 } as ByRarity,
  rarityLateFromEdition: 4,
  /** Failure modifier: disabled plate weights by rarity. */
  failureWeights: { common: 1, rare: 2, legendary: 3 } as ByRarity,

  // --- Generator (§4) ---
  colorAffinityWeight: 1.0,
  bigFormatFactor: 3,
  dealRetries: 12,
  dealRetriesBeforeSmallBias: 6,

  // --- Modifiers (§7) ---
  rushSheets: 14,
  /** Base sheets of a Large Format job (big pieces fill the forme faster). */
  bigFormatSheets: 20,
  jamCount: [2, 2, 3, 3, 3, 4, 4, 4] as number[],
  leftoverCount: [8, 8, 10, 10, 10, 12, 12, 12] as number[],
};

export type Balance = typeof BALANCE;
