/**
 * "No ads" one-time purchase (GDD §11.5) on @capgo/native-purchases 8.8 (Play Billing).
 *
 * Plugin facts this relies on (verified in its Android sources):
 * - Android never emits `transactionUpdated`; state comes from `getPurchases()`, which
 *   reports `purchaseState` '1' (purchased) / '2' (pending) and rejects
 *   (`QUERY_PURCHASES_FAILED`) instead of returning an empty list when Play errors.
 * - `purchaseProduct()` rejects with code `USER_CANCELED` / `ITEM_ALREADY_OWNED`, and with the
 *   message "Purchase is pending" for pending payments.
 * - Every call re-creates the BillingClient and closes the previous one, so a call issued
 *   while the purchase sheet is open would orphan that purchase. All calls are therefore
 *   serialized here (a resume-triggered refresh waits for the purchase to finish).
 * - Auto-acknowledge runs on a client that is closed right after, so owned-but-unacknowledged
 *   purchases are acknowledged explicitly on the next refresh (Play refunds them after 3 days).
 */
import {
  NativePurchases,
  PURCHASE_TYPE,
  type NativePurchasesPlugin,
  type Transaction,
} from '@capgo/native-purchases';
import { IAP_NO_ADS_PRODUCT_ID } from '../../config';
import { Emitter } from '../emitter';
import { isNative } from '../env';
import { STORAGE_KEYS, type SaveStore } from '../storage';
import {
  newEntitlement,
  normalizeEntitlement,
  reduceEntitlement,
  unacknowledgedTokens,
  type EntitlementState,
  type PurchaseQuery,
  type PurchaseRecord,
} from './entitlement';

export * from './entitlement';

export type PurchaseOutcome =
  'purchased' | 'pending' | 'cancelled' | 'already_owned' | 'error' | 'unavailable';

export interface ProductInfo {
  /** Localized price string from Play, e.g. "9,99 zł". */
  price: string;
  title?: string;
}

export interface IapService {
  /** False on web/PWA: purchase UI is hidden (GDD §11.5). */
  readonly supported: boolean;
  readonly entitled: boolean;
  readonly pending: boolean;
  readonly purchasing: boolean;
  readonly snapshot: EntitlementState;
  /** Cached entitlement (works offline). Call before AdsService.start. */
  load(): Promise<EntitlementState>;
  /** Cold start and every resume: restorePurchases() → getPurchases({ productType: 'inapp' }). */
  refresh(): Promise<EntitlementState>;
  /** "Restore purchase" button. */
  restore(): Promise<EntitlementState>;
  product(): Promise<ProductInfo | null>;
  purchase(): Promise<PurchaseOutcome>;
  onChange(cb: (s: EntitlementState) => void): () => void;
}

export type PurchasesLike = Pick<
  NativePurchasesPlugin,
  'restorePurchases' | 'getPurchases' | 'getProducts' | 'purchaseProduct' | 'acknowledgePurchase'
>;

export interface IapServiceOptions {
  store: Pick<SaveStore, 'loadJSON' | 'saveJSON'>;
  native?: boolean;
  plugin?: PurchasesLike;
  productId?: string;
  now?: () => number;
}

type ErrorKind = 'cancelled' | 'already_owned' | 'pending' | 'error';

/** Maps a purchaseProduct() rejection to an outcome. */
export function classifyPurchaseError(e: unknown): ErrorKind {
  const err = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown };
  const code = typeof err.code === 'string' ? err.code.toUpperCase() : '';
  const msg = (typeof err.message === 'string' ? err.message : typeof e === 'string' ? e : '').toLowerCase();
  if (code === 'USER_CANCELED' || code === 'USER_CANCELLED' || msg.includes('cancel')) return 'cancelled';
  if (code === 'ITEM_ALREADY_OWNED' || /already[ _-]?owned/.test(msg)) return 'already_owned';
  if (code === 'PURCHASE_STATE_2' || msg.includes('pending')) return 'pending';
  return 'error';
}

function toRecord(t: Partial<Transaction>): PurchaseRecord {
  return {
    productIdentifier: String(t.productIdentifier ?? ''),
    purchaseState: t.purchaseState === undefined ? undefined : String(t.purchaseState),
    isAcknowledged: t.isAcknowledged,
    purchaseToken: t.purchaseToken ?? t.transactionId,
  };
}

export function createIapService(opts: IapServiceOptions): IapService {
  const supported = opts.native ?? isNative();
  const plugin: PurchasesLike = opts.plugin ?? NativePurchases;
  const productId = opts.productId ?? IAP_NO_ADS_PRODUCT_ID;
  const now = opts.now ?? Date.now;
  const changes = new Emitter<[EntitlementState]>('press.iap');

  let state: EntitlementState = newEntitlement();
  let loading: Promise<EntitlementState> | null = null;
  let refreshing: Promise<EntitlementState> | null = null;
  let purchasing: Promise<PurchaseOutcome> | null = null;
  let productCache: ProductInfo | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  /** One plugin operation at a time (see header). */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  };

  const apply = (next: EntitlementState): void => {
    const changed = next.entitled !== state.entitled || next.pending !== state.pending;
    state = { ...next };
    opts.store.saveJSON(STORAGE_KEYS.iap, state).catch(() => undefined);
    if (changed) changes.emit({ ...state });
  };

  const load = (): Promise<EntitlementState> => {
    if (!supported) return Promise.resolve({ ...state });
    if (!loading) {
      loading = opts.store
        .loadJSON<EntitlementState>(STORAGE_KEYS.iap, newEntitlement(), normalizeEntitlement)
        .then((s) => {
          const changed = s.entitled !== state.entitled || s.pending !== state.pending;
          state = s;
          if (changed) changes.emit({ ...state });
          return { ...state };
        })
        .catch(() => ({ ...state }));
    }
    return loading;
  };

  /** restore → query → reduce → acknowledge. `allowRevoke=false` right after a purchase. */
  const query = (allowRevoke: boolean): Promise<EntitlementState> =>
    serial(async () => {
      await load();
      try {
        await plugin.restorePurchases();
      } catch (e) {
        console.warn('[press.iap] restorePurchases failed', e);
      }
      let q: PurchaseQuery = { ok: false };
      let records: PurchaseRecord[] = [];
      try {
        const r = await plugin.getPurchases({ productType: PURCHASE_TYPE.INAPP });
        if (Array.isArray(r?.purchases)) {
          records = r.purchases.map(toRecord);
          q = { ok: true, purchases: records };
        }
      } catch (e) {
        console.warn('[press.iap] getPurchases failed', e);
      }
      const next = reduceEntitlement(state, q, now(), productId);
      if (!allowRevoke && state.entitled) next.entitled = true;
      if (next.entitled) next.pending = false;
      apply(next);
      for (const token of unacknowledgedTokens(records, productId)) {
        try {
          await plugin.acknowledgePurchase({ purchaseToken: token });
        } catch (e) {
          console.warn('[press.iap] acknowledgePurchase failed', e);
        }
      }
      return { ...state };
    });

  const refresh = (): Promise<EntitlementState> => {
    if (!supported) return Promise.resolve({ ...state });
    if (!refreshing) {
      refreshing = query(true).finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  };

  const doPurchase = (): Promise<PurchaseOutcome> =>
    serial(async (): Promise<PurchaseOutcome> => {
      await load();
      if (state.entitled) return 'already_owned';
      try {
        const tx = await plugin.purchaseProduct({
          productIdentifier: productId,
          productType: PURCHASE_TYPE.INAPP,
          isConsumable: false,
          autoAcknowledgePurchases: true,
        });
        const st = tx?.purchaseState === undefined ? '1' : String(tx.purchaseState);
        if (st === '2') {
          apply({ ...state, pending: true });
          return 'pending';
        }
        if (st !== '1') return 'error';
        apply({ ...state, entitled: true, pending: false });
        return 'purchased';
      } catch (e) {
        const kind = classifyPurchaseError(e);
        if (kind === 'pending') apply({ ...state, pending: true });
        if (kind === 'error') console.warn('[press.iap] purchase failed', e);
        return kind;
      }
    });

  return {
    supported,
    get entitled() {
      return supported && state.entitled;
    },
    get pending() {
      return supported && state.pending;
    },
    get purchasing() {
      return purchasing !== null;
    },
    get snapshot() {
      return { ...state };
    },
    load,
    refresh,
    restore: refresh,
    async product() {
      if (!supported) return null;
      if (productCache) return productCache;
      return serial(async () => {
        try {
          const r = await plugin.getProducts({
            productIdentifiers: [productId],
            productType: PURCHASE_TYPE.INAPP,
          });
          const list = Array.isArray(r?.products) ? r.products : [];
          const p = list.find((x) => x?.identifier === productId) ?? list[0];
          if (!p || typeof p.priceString !== 'string' || p.priceString === '') return null;
          productCache = p.title ? { price: p.priceString, title: p.title } : { price: p.priceString };
          return productCache;
        } catch (e) {
          console.warn('[press.iap] getProducts failed', e);
          return null;
        }
      });
    },
    async purchase() {
      if (!supported) return 'unavailable';
      if (!purchasing) {
        purchasing = doPurchase().finally(() => {
          purchasing = null;
        });
      }
      const outcome = await purchasing;
      if (outcome === 'purchased') {
        // Confirm + acknowledge; never revoke on the heels of a successful purchase.
        await query(false);
      } else if (outcome === 'already_owned') {
        // ITEM_ALREADY_OWNED = restore (GDD §11.5).
        const s = await refresh();
        if (!s.entitled && s.pending) return 'pending';
      }
      return outcome;
    },
    onChange: (cb) => changes.add(cb),
  };
}
