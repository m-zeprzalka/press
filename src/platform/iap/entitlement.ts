/**
 * "No ads" entitlement reducer (GDD §11.5) — pure, table-tested.
 *
 * Google Play purchase states as reported by @capgo/native-purchases on Android:
 * '0' UNSPECIFIED, '1' PURCHASED, '2' PENDING.
 * - entitled ⇔ the last *successful* query contains the product in state '1';
 * - pending  ⇔ it contains the product in state '2' (and it is not already entitled);
 * - a failed query (offline, Play error) keeps the cached entitlement untouched, so a paying
 *   player is never stripped by a transient error; only a successful query without a
 *   purchased copy of the product revokes it (refund / chargeback).
 */
import { IAP_NO_ADS_PRODUCT_ID } from '../../config';

export const PURCHASE_STATE = { unspecified: '0', purchased: '1', pending: '2' } as const;

export interface EntitlementState {
  entitled: boolean;
  pending: boolean;
  /** Wall-clock ms of the last successful store query (null = never). */
  checkedAt: number | null;
}

export interface PurchaseRecord {
  productIdentifier: string;
  purchaseState?: string;
  isAcknowledged?: boolean;
  purchaseToken?: string;
}

export type PurchaseQuery = { ok: true; purchases: readonly PurchaseRecord[] } | { ok: false };

export function newEntitlement(): EntitlementState {
  return { entitled: false, pending: false, checkedAt: null };
}

export function normalizeEntitlement(raw: unknown): EntitlementState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof EntitlementState, unknown>>;
  return {
    entitled: r.entitled === true,
    pending: r.pending === true,
    checkedAt: typeof r.checkedAt === 'number' && Number.isFinite(r.checkedAt) ? r.checkedAt : null,
  };
}

const state = (p: PurchaseRecord): string => String(p.purchaseState ?? '');

export function reduceEntitlement(
  cached: Readonly<EntitlementState>,
  query: PurchaseQuery,
  now: number,
  productId: string = IAP_NO_ADS_PRODUCT_ID,
): EntitlementState {
  if (!query.ok) return { ...cached };
  const mine = query.purchases.filter((p) => p && p.productIdentifier === productId);
  const entitled = mine.some((p) => state(p) === PURCHASE_STATE.purchased);
  const pending = !entitled && mine.some((p) => state(p) === PURCHASE_STATE.pending);
  return { entitled, pending, checkedAt: now };
}

/** Purchase tokens of owned-but-unacknowledged copies (Play refunds them after 3 days). */
export function unacknowledgedTokens(
  purchases: readonly PurchaseRecord[],
  productId: string = IAP_NO_ADS_PRODUCT_ID,
): string[] {
  return purchases
    .filter(
      (p) =>
        p &&
        p.productIdentifier === productId &&
        state(p) === PURCHASE_STATE.purchased &&
        p.isAcknowledged === false &&
        typeof p.purchaseToken === 'string' &&
        p.purchaseToken.length > 0,
    )
    .map((p) => p.purchaseToken as string);
}
