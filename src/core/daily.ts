/**
 * Daily challenge (GDD §10.1): same seed, same rules and the same fixed plate pool for everyone.
 */
import { RULES_VERSION } from './config/version';
import { STARTER_MATRICES, matrixDef, type MatrixId } from './matrices';
import { Rng } from './rng';

/** YYYY-MM-DD in UTC for a timestamp (ms). */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function dailySeed(date: string): string {
  return `PRESS-${date}-r${RULES_VERSION}`;
}

/** The daily always uses the fixed starter pool, independent of the player's unlocks. */
export function dailyPool(): MatrixId[] {
  return [...STARTER_MATRICES].sort();
}

/** Rule of the day: one seeded common plate installed at start. */
export function dailyStartPlate(date: string): MatrixId {
  const commons = dailyPool().filter((id) => matrixDef(id).rarity === 'common');
  return Rng.derive(dailySeed(date), 'daily').pick(commons);
}
