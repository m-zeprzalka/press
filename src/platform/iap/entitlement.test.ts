import { describe, expect, it } from 'vitest';
import { IAP_NO_ADS_PRODUCT_ID } from '../../config';
import {
  newEntitlement,
  normalizeEntitlement,
  reduceEntitlement,
  unacknowledgedTokens,
  type EntitlementState,
  type PurchaseQuery,
} from './entitlement';

const ID = IAP_NO_ADS_PRODUCT_ID;
const NOW = 1_700_000_000_000;
const ENTITLED: EntitlementState = { entitled: true, pending: false, checkedAt: 1 };
const PENDING: EntitlementState = { entitled: false, pending: true, checkedAt: 1 };
const NONE = newEntitlement();

const ok = (...purchases: Array<{ productIdentifier: string; purchaseState?: string }>): PurchaseQuery => ({
  ok: true,
  purchases,
});

describe('reduceEntitlement (GDD §11.5)', () => {
  it.each<[string, EntitlementState, PurchaseQuery, Omit<EntitlementState, 'checkedAt'>, 'now' | 'kept']>([
    [
      'purchased (1) → entitled',
      NONE,
      ok({ productIdentifier: ID, purchaseState: '1' }),
      { entitled: true, pending: false },
      'now',
    ],
    [
      'pending (2) → pending, nothing granted',
      NONE,
      ok({ productIdentifier: ID, purchaseState: '2' }),
      { entitled: false, pending: true },
      'now',
    ],
    [
      'pending → purchased',
      PENDING,
      ok({ productIdentifier: ID, purchaseState: '1' }),
      { entitled: true, pending: false },
      'now',
    ],
    ['pending cancelled by Play → cleared', PENDING, ok(), { entitled: false, pending: false }, 'now'],
    [
      'unspecified (0) → nothing',
      NONE,
      ok({ productIdentifier: ID, purchaseState: '0' }),
      { entitled: false, pending: false },
      'now',
    ],
    [
      'other products are ignored',
      NONE,
      ok({ productIdentifier: 'other', purchaseState: '1' }),
      { entitled: false, pending: false },
      'now',
    ],
    [
      'successful query without the product revokes (refund)',
      ENTITLED,
      ok(),
      { entitled: false, pending: false },
      'now',
    ],
    [
      'successful query, only another product → revoke',
      ENTITLED,
      ok({ productIdentifier: 'x', purchaseState: '1' }),
      { entitled: false, pending: false },
      'now',
    ],
    [
      'failed query keeps an entitlement',
      ENTITLED,
      { ok: false },
      { entitled: true, pending: false },
      'kept',
    ],
    ['failed query keeps pending', PENDING, { ok: false }, { entitled: false, pending: true }, 'kept'],
    ['failed query keeps "not entitled"', NONE, { ok: false }, { entitled: false, pending: false }, 'kept'],
    [
      'entitled + stray pending copy → entitled only',
      NONE,
      ok({ productIdentifier: ID, purchaseState: '2' }, { productIdentifier: ID, purchaseState: '1' }),
      { entitled: true, pending: false },
      'now',
    ],
    [
      'missing purchaseState is not a purchase',
      ENTITLED,
      ok({ productIdentifier: ID }),
      { entitled: false, pending: false },
      'now',
    ],
  ])('%s', (_name, cached, query, expected, checked) => {
    const next = reduceEntitlement(cached, query, NOW);
    expect({ entitled: next.entitled, pending: next.pending }).toEqual(expected);
    expect(next.checkedAt).toBe(checked === 'now' ? NOW : cached.checkedAt);
    expect(next).not.toBe(cached);
  });

  it('lists owned-but-unacknowledged tokens', () => {
    expect(
      unacknowledgedTokens([
        { productIdentifier: ID, purchaseState: '1', isAcknowledged: false, purchaseToken: 'a' },
        { productIdentifier: ID, purchaseState: '1', isAcknowledged: true, purchaseToken: 'b' },
        { productIdentifier: ID, purchaseState: '2', isAcknowledged: false, purchaseToken: 'c' },
        { productIdentifier: 'other', purchaseState: '1', isAcknowledged: false, purchaseToken: 'd' },
        { productIdentifier: ID, purchaseState: '1', isAcknowledged: false },
      ]),
    ).toEqual(['a']);
  });

  it('normalizes the persisted cache', () => {
    expect(normalizeEntitlement(undefined)).toEqual(NONE);
    expect(normalizeEntitlement({ entitled: 'yes', pending: true, checkedAt: 'x' })).toEqual({
      ...NONE,
      pending: true,
    });
    expect(normalizeEntitlement({ entitled: true, checkedAt: 5 })).toEqual({
      entitled: true,
      pending: false,
      checkedAt: 5,
    });
  });
});
