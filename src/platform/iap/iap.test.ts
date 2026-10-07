import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PurchasesModule from '@capgo/native-purchases';
import { IAP_NO_ADS_PRODUCT_ID } from '../../config';
import { createMemoryStore, createSaveStore } from '../storage';
import { classifyPurchaseError, createIapService } from './index';

const ID = IAP_NO_ADS_PRODUCT_ID;

const np = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    purchases: [] as unknown[],
    queryFails: false,
    restorePurchases: vi.fn(async () => void calls.push('restorePurchases')),
    getPurchases: vi.fn(async (_o?: unknown): Promise<{ purchases: unknown[] }> => {
      calls.push('getPurchases');
      if (np.queryFails)
        throw Object.assign(new Error('Failed to query purchases'), { code: 'QUERY_PURCHASES_FAILED' });
      return { purchases: np.purchases };
    }),
    getProducts: vi.fn(async (_o: unknown): Promise<{ products: unknown[] }> => ({
      products: [{ identifier: 'press_no_ads', priceString: '9,99 zł', title: 'No ads' }],
    })),
    purchaseProduct: vi.fn(async (_o: unknown): Promise<unknown> => {
      calls.push('purchaseProduct');
      return {
        productIdentifier: 'press_no_ads',
        purchaseState: '1',
        isAcknowledged: false,
        purchaseToken: 'tok',
      };
    }),
    acknowledgePurchase: vi.fn(
      async (o: { purchaseToken: string }) => void calls.push(`ack:${o.purchaseToken}`),
    ),
  };
});
vi.mock('@capgo/native-purchases', async (importOriginal) => ({
  ...(await importOriginal<typeof PurchasesModule>()),
  NativePurchases: np,
}));

const err = (message: string, code?: string): Error =>
  Object.assign(new Error(message), code ? { code } : {});

function setup(seed?: Record<string, string>) {
  const kv = createMemoryStore(seed);
  const store = createSaveStore(kv, { onError: () => undefined });
  const iap = createIapService({ store, native: true, now: () => 42 });
  return { iap, kv, store };
}

beforeEach(() => {
  vi.clearAllMocks();
  np.calls.length = 0;
  np.purchases = [];
  np.queryFails = false;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('refresh', () => {
  it('restorePurchases → getPurchases({ productType: inapp }) → persisted entitlement', async () => {
    np.purchases = [{ productIdentifier: ID, purchaseState: '1', isAcknowledged: true, purchaseToken: 't' }];
    const { iap, kv, store } = setup();
    const changes = vi.fn();
    iap.onChange(changes);
    const s = await iap.refresh();
    expect(np.calls).toEqual(['restorePurchases', 'getPurchases']);
    expect(np.getPurchases).toHaveBeenCalledWith({ productType: 'inapp' });
    expect(s).toEqual({ entitled: true, pending: false, checkedAt: 42 });
    expect(iap.entitled).toBe(true);
    expect(changes).toHaveBeenCalledWith({ entitled: true, pending: false, checkedAt: 42 });
    await store.flush();
    expect(JSON.parse(kv.data.get('press.iap') as string)).toEqual({
      entitled: true,
      pending: false,
      checkedAt: 42,
    });
  });

  it('works offline from the cache; a failed query never revokes', async () => {
    const { iap } = setup({ 'press.iap': JSON.stringify({ entitled: true, pending: false, checkedAt: 7 }) });
    expect((await iap.load()).entitled).toBe(true);
    np.queryFails = true;
    expect(await iap.refresh()).toEqual({ entitled: true, pending: false, checkedAt: 7 });
    np.queryFails = false;
    np.purchases = [];
    expect((await iap.refresh()).entitled).toBe(false); // refund: successful query without the product
  });

  it('pending purchase: nothing granted, pending flagged', async () => {
    np.purchases = [{ productIdentifier: ID, purchaseState: '2' }];
    const { iap } = setup();
    await iap.refresh();
    expect(iap.entitled).toBe(false);
    expect(iap.pending).toBe(true);
  });

  it('acknowledges owned-but-unacknowledged purchases explicitly', async () => {
    np.purchases = [
      { productIdentifier: ID, purchaseState: '1', isAcknowledged: false, purchaseToken: 'tok-1' },
    ];
    const { iap } = setup();
    await iap.refresh();
    expect(np.calls).toEqual(['restorePurchases', 'getPurchases', 'ack:tok-1']);
  });

  it('a restore failure still queries; concurrent refreshes share one run', async () => {
    np.restorePurchases.mockRejectedValueOnce(new Error('BILLING_UNAVAILABLE'));
    np.purchases = [{ productIdentifier: ID, purchaseState: '1', isAcknowledged: true }];
    const { iap } = setup();
    const [a, b] = await Promise.all([iap.refresh(), iap.restore()]);
    expect(a).toEqual(b);
    expect(np.getPurchases).toHaveBeenCalledTimes(1);
    expect(iap.entitled).toBe(true);
  });
});

describe('purchase', () => {
  it('purchased → entitled, then confirmed + acknowledged', async () => {
    np.purchases = [
      { productIdentifier: ID, purchaseState: '1', isAcknowledged: false, purchaseToken: 'tok' },
    ];
    const { iap } = setup();
    expect(await iap.purchase()).toBe('purchased');
    expect(np.purchaseProduct).toHaveBeenCalledWith({
      productIdentifier: ID,
      productType: 'inapp',
      isConsumable: false,
      autoAcknowledgePurchases: true,
    });
    expect(iap.entitled).toBe(true);
    expect(np.calls).toEqual(['purchaseProduct', 'restorePurchases', 'getPurchases', 'ack:tok']);
  });

  it('a post-purchase query that lags behind Play does not revoke', async () => {
    np.purchases = [];
    const { iap } = setup();
    expect(await iap.purchase()).toBe('purchased');
    expect(iap.entitled).toBe(true);
  });

  it.each([
    ['user cancel → cancelled', err('Purchase is not purchased', 'USER_CANCELED'), 'cancelled', false],
    ['pending → pending', err('Purchase is pending'), 'pending', true],
    ['generic → error', err('Billing service unavailable', 'BILLING_SETUP_FAILED'), 'error', false],
  ])('%s', async (_name, rejection, outcome, pending) => {
    np.purchaseProduct.mockRejectedValueOnce(rejection);
    const { iap } = setup();
    expect(await iap.purchase()).toBe(outcome);
    expect(iap.entitled).toBe(false);
    expect(iap.pending).toBe(pending);
  });

  it('ITEM_ALREADY_OWNED is a restore', async () => {
    np.purchaseProduct.mockRejectedValueOnce(err('Purchase is not purchased', 'ITEM_ALREADY_OWNED'));
    np.purchases = [{ productIdentifier: ID, purchaseState: '1', isAcknowledged: true }];
    const { iap } = setup();
    expect(await iap.purchase()).toBe('already_owned');
    expect(iap.entitled).toBe(true);
    expect(np.purchaseProduct).toHaveBeenCalledTimes(1);
    expect(np.calls).toEqual(['restorePurchases', 'getPurchases']);
  });

  it('owners are not charged twice', async () => {
    const { iap } = setup({ 'press.iap': JSON.stringify({ entitled: true, pending: false, checkedAt: 1 }) });
    expect(await iap.purchase()).toBe('already_owned');
    expect(np.purchaseProduct).not.toHaveBeenCalled();
  });

  it('serializes plugin calls: a resume refresh waits for the open purchase sheet', async () => {
    let finish!: (v: unknown) => void;
    np.purchaseProduct.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          np.calls.push('purchaseProduct');
          finish = resolve;
        }),
    );
    np.purchases = [{ productIdentifier: ID, purchaseState: '1', isAcknowledged: true }];
    const { iap } = setup();
    const buying = iap.purchase();
    const doubleTap = iap.purchase();
    await new Promise((r) => setTimeout(r, 0));
    expect(iap.purchasing).toBe(true);
    const resumed = iap.refresh(); // appStateChange while the Play sheet is up
    await new Promise((r) => setTimeout(r, 0));
    expect(np.calls).toEqual(['purchaseProduct']); // nothing else touched the BillingClient
    finish({ productIdentifier: ID, purchaseState: '1', isAcknowledged: true });
    expect(await buying).toBe('purchased');
    expect(await doubleTap).toBe('purchased');
    await resumed;
    expect(np.purchaseProduct).toHaveBeenCalledTimes(1);
    expect(np.calls[0]).toBe('purchaseProduct');
    expect(iap.purchasing).toBe(false);
  });

  it('classifies plugin errors', () => {
    expect(classifyPurchaseError(err('x', 'USER_CANCELED'))).toBe('cancelled');
    expect(classifyPurchaseError(err('User cancelled'))).toBe('cancelled');
    expect(classifyPurchaseError(err('x', 'ITEM_ALREADY_OWNED'))).toBe('already_owned');
    expect(classifyPurchaseError(err('Purchase is pending'))).toBe('pending');
    expect(classifyPurchaseError(err('Purchase is not purchased', 'PURCHASE_STATE_2'))).toBe('pending');
    expect(classifyPurchaseError(err('Purchase is not purchased', 'PURCHASE_STATE_0'))).toBe('error');
    expect(classifyPurchaseError(null)).toBe('error');
    expect(classifyPurchaseError('pending payment')).toBe('pending');
  });
});

describe('product & web', () => {
  it('returns the localized price from getProducts', async () => {
    const { iap } = setup();
    expect(await iap.product()).toEqual({ price: '9,99 zł', title: 'No ads' });
    expect(np.getProducts).toHaveBeenCalledWith({ productIdentifiers: [ID], productType: 'inapp' });
    await iap.product();
    expect(np.getProducts).toHaveBeenCalledTimes(1); // cached
  });

  it('null when the product is missing or the store errors', async () => {
    np.getProducts.mockResolvedValueOnce({ products: [] });
    expect(await setup().iap.product()).toBeNull();
    np.getProducts.mockRejectedValueOnce(new Error('offline'));
    expect(await setup().iap.product()).toBeNull();
  });

  it('web/PWA: unsupported, never entitled, no plugin calls', async () => {
    const store = createSaveStore(createMemoryStore({ 'press.iap': '{"entitled":true}' }));
    const iap = createIapService({ store, native: false });
    expect(iap.supported).toBe(false);
    await iap.load();
    await iap.refresh();
    expect(iap.entitled).toBe(false);
    expect(await iap.purchase()).toBe('unavailable');
    expect(await iap.product()).toBeNull();
    expect(np.restorePurchases).not.toHaveBeenCalled();
    expect(np.purchaseProduct).not.toHaveBeenCalled();
  });
});
