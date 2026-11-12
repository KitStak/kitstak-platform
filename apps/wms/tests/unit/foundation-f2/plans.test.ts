import { describe, expect, it } from 'vitest';
import { buildPoPlans } from '@/server/db/seed-builders';
import { Rng } from '@/server/db/seed-data';
import { buildOrderPlans, type PlanInput } from '@/server/db/seed-orders';
import {
  caseGtinFor,
  caseQtyFor,
  gtinCheckDigit,
  taxonomyFor,
  upcCheckDigit,
  upcFor,
} from '@/server/db/seed/catalog-data';
import { ANCHOR_MS, utcAt } from '@/server/db/seed/runtime';

const products = (clientId: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${clientId}-p${i}`, clientId, price: 10 + i, isKit: false }));

function input(): PlanInput {
  const clients = [
    { id: 'c1', name: 'Apex', weight: 10, hasChannelConnection: true },
    { id: 'c2', name: 'Nova', weight: 5, hasChannelConnection: false },
  ];
  const catalog = new Map([
    ['c1', products('c1', 6)],
    ['c2', products('c2', 4)],
  ]);
  return {
    days: 30,
    at: utcAt,
    endMs: ANCHOR_MS,
    clients,
    products: { MLT1: catalog, KS2: new Map([['c1', products('c1', 3)]]) },
    customersByClient: new Map([
      [
        'c1',
        [
          {
            id: 'cu1',
            firstName: 'Ana',
            lastName: 'Lee',
            email: 'ana@x.com',
            phone: '1',
            address: {
              line1: '1 Main St',
              city: 'Austin',
              state: 'TX',
              zip: '78704',
              country: 'United States',
            },
          },
        ],
      ],
    ]),
    retailers: [
      {
        id: 'r1',
        name: 'Target',
        businessName: 'Target Corporation',
        dc: {
          line1: '7000 Target Pkwy N',
          city: 'Minneapolis',
          state: 'MN',
          zip: '55445',
          country: 'United States',
        },
      },
    ],
    ks2ClientIds: new Set(['c1']),
  };
}

describe('order plans', () => {
  it('is deterministic and stays inside the replay window', () => {
    const a = buildOrderPlans(new Rng(9), input());
    const b = buildOrderPlans(new Rng(9), input());
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(350);
    expect(a.every((p) => p.createdMs < ANCHOR_MS && p.createdMs >= utcAt(30, 0))).toBe(true);
    const times = a.map((p) => p.createdMs);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it('routes wholesale orders to retailers and KS2 orders to KS2 clients', () => {
    const plans = buildOrderPlans(new Rng(3), input());
    const b2b = plans.filter((p) => p.channel === 'Wholesale');
    expect(b2b.length).toBeGreaterThan(0);
    expect(b2b.every((p) => p.retailerId === 'r1' && p.serviceCode === 'SBX_GROUND')).toBe(true);
    expect(plans.filter((p) => p.warehouse === 'KS2').every((p) => p.clientId === 'c1')).toBe(true);
    expect(plans.filter((p) => p.fate === 'blocked').every((p) => p.shipTo.line1.startsWith('PO Box'))).toBe(
      true,
    );
    expect(plans.every((p) => p.lines.length > 0 && p.lines.every((l) => l.qty > 0))).toBe(true);
  });
});

describe('PO plans', () => {
  const client = {
    id: 'c1',
    vendorIds: ['v1', 'v2'],
    products: [
      { id: 'p1', price: 20, caseQty: 24 },
      { id: 'p2', price: 10, caseQty: null },
      { id: 'p3', price: 5, caseQty: null },
    ],
  };

  it('covers every PO status and keeps receipts within the ordered quantity', () => {
    const plans = buildPoPlans(new Rng(1), [client], [client, { ...client, id: 'c2' }]);
    expect(new Set(plans.map((p) => p.status))).toEqual(
      new Set(['Completed', 'Receiving', 'Started', 'Pending', 'Cancelled']),
    );
    expect(plans.filter((p) => p.warehouse === 'KS2')).toHaveLength(2);
    for (const p of plans) {
      for (const l of p.lines) expect(l.damagedQty + l.secondReceiptQty).toBeLessThan(l.orderedQty);
      if (p.status === 'Pending') expect(p.arrivalDaysAgo).toBeLessThan(0);
    }
  });
});

describe('catalog data', () => {
  it('computes GS1 check digits', () => {
    expect(upcCheckDigit('03600029145')).toBe(2);
    const upc = upcFor(3);
    expect(upc).toHaveLength(12);
    expect(Number(upc[11])).toBe(upcCheckDigit(upc.slice(0, 11)));
    const gtin = caseGtinFor(upc);
    expect(gtin).toHaveLength(14);
    expect(Number(gtin[13])).toBe(gtinCheckDigit(gtin.slice(0, 13)));
  });

  it('classifies products and case packs', () => {
    expect(taxonomyFor('Apparel', 'APX-TEE-BLK-M')).toEqual({ type: 'Tops', group: 'Core Line' });
    expect(taxonomyFor('Electronics', 'NOVA-CBL-USBC-1M').type).toBe('Cables');
    expect(taxonomyFor('Coffee', 'CPL-PODS-24').type).toBe('Single Serve');
    expect(taxonomyFor('Packaging', 'APX-PKG-POLY-1013').type).toBe('Packaging');
    expect(caseQtyFor('Apparel', 'APX-TEE-BLK-M')).toBe(24);
    expect(caseQtyFor('Electronics', 'VLT-KIT-DESK')).toBeNull();
    expect(caseQtyFor('Coffee', 'CPL-BAG-ESP-12')).toBe(12);
  });
});
