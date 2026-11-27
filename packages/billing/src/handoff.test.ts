import { describe, expect, it } from 'vitest';
import { PRODUCT_IDS, type PlanSelection, type ProductId } from './catalog';
import {
  BUSINESS_TYPES,
  HANDOFF_SOURCES,
  START_MODES,
  TEAM_SIZES,
  type SignupHandoff,
  encodeHandoff,
  encodeHandoffIdentity,
  parseHandoff,
  parseHandoffIdentity,
  signupUrl,
} from './handoff';

function everyStack(): ProductId[][] {
  const out: ProductId[][] = [];
  for (let mask = 1; mask < 1 << PRODUCT_IDS.length; mask += 1) {
    out.push(PRODUCT_IDS.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  return out;
}

describe('handoff round trip', () => {
  it('parse(encode(x)) equals x for every valid cart', () => {
    let checked = 0;
    for (const products of everyStack()) {
      for (const interval of ['monthly', 'yearly'] as const) {
        for (const [seats, warehouses] of [
          [1, 1],
          [5, 2],
          [500, 50],
        ]) {
          const selection: PlanSelection = { products, seats, warehouses, interval };
          const handoff: SignupHandoff = { selection, profile: {}, source: 'pricing' };
          expect(parseHandoff(encodeHandoff(handoff))).toEqual(handoff);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(15 * 2 * 3);
  });

  it('parse(encode(x)) equals x for every profile answer and source', () => {
    for (const source of HANDOFF_SOURCES) {
      for (const businessType of BUSINESS_TYPES) {
        for (const teamSize of TEAM_SIZES) {
          for (const startMode of START_MODES) {
            for (const guided of [true, false, undefined]) {
              const handoff: SignupHandoff = {
                selection: { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'yearly' },
                profile: { businessType, teamSize, startMode, ...(guided === undefined ? {} : { guided }) },
                source,
              };
              expect(parseHandoff(encodeHandoff(handoff))).toEqual(handoff);
            }
          }
        }
      }
    }
  });

  it('round trips a link with no cart', () => {
    const handoff: SignupHandoff = { selection: null, profile: { teamSize: 'small' }, source: 'direct' };
    expect(parseHandoff(encodeHandoff(handoff))).toEqual(handoff);
  });

  it('reads the same values from a Next searchParams record', () => {
    const handoff: SignupHandoff = {
      selection: { products: ['crm', 'pulse'], seats: 12, warehouses: 1, interval: 'monthly' },
      profile: { businessType: '3pl', guided: true },
      source: 'wizard',
    };
    const record = Object.fromEntries(encodeHandoff(handoff));
    expect(parseHandoff(record)).toEqual(handoff);
    expect(parseHandoff({ ...record, products: [record.products, 'wms'] })).toEqual(handoff);
  });
});

describe('handoff validation', () => {
  it('drops junk, unknown apps and huge numbers', () => {
    const parsed = parseHandoff(
      new URLSearchParams(
        'products=crm,hack,wms&seats=99999999999&warehouses=-3&billing=weekly&businessType=bank&teamSize=huge&startMode=x&guided=maybe&src=evil&price=1',
      ),
    );
    expect(parsed).toEqual({
      selection: { products: ['crm', 'wms'], seats: 1, warehouses: 1, interval: 'monthly' },
      profile: {},
      source: 'direct',
    });
  });

  it('clamps numbers to the catalog limits', () => {
    const parsed = parseHandoff(new URLSearchParams('products=crm,wms&seats=900&warehouses=75'));
    expect(parsed.selection).toEqual({ products: ['crm', 'wms'], seats: 500, warehouses: 50, interval: 'monthly' });
  });

  it('has no selection when no valid product is named', () => {
    expect(parseHandoff(new URLSearchParams('products=nope&seats=5')).selection).toBeNull();
    expect(parseHandoff(new URLSearchParams('')).selection).toBeNull();
    expect(parseHandoff({}).source).toBe('direct');
  });

  it('reads the legacy focus value only when products is missing', () => {
    expect(parseHandoff(new URLSearchParams('focus=both')).selection?.products).toEqual(['crm', 'wms']);
    expect(parseHandoff(new URLSearchParams('focus=wms')).selection?.products).toEqual(['wms']);
    expect(parseHandoff(new URLSearchParams('focus=both&products=pulse')).selection?.products).toEqual(['pulse']);
  });

  it('reads annual as yearly', () => {
    expect(parseHandoff(new URLSearchParams('products=crm&billing=annual')).selection?.interval).toBe('yearly');
    expect(parseHandoff(new URLSearchParams('products=crm&billing=yearly')).selection?.interval).toBe('yearly');
  });

  it('carries no price and no identity in the query', () => {
    const query = encodeHandoff({
      selection: { products: ['crm'], seats: 3, warehouses: 1, interval: 'monthly' },
      profile: {},
      source: 'pricing',
    }).toString();
    expect(query).toBe('products=crm&seats=3&warehouses=1&billing=monthly&src=pricing');
  });
});

describe('handoff identity (after the #)', () => {
  it('round trips name, email and company', () => {
    const identity = { name: 'Maya Chen', email: 'maya@northwind.example', company: 'Northwind Robotics & Co' };
    expect(parseHandoffIdentity(`#${encodeHandoffIdentity(identity)}`)).toEqual(identity);
    expect(parseHandoffIdentity(encodeHandoffIdentity(identity))).toEqual(identity);
  });

  it('trims values to 120 characters and drops empty ones', () => {
    const long = 'x'.repeat(300);
    const parsed = parseHandoffIdentity(encodeHandoffIdentity({ name: long, email: '   ', company: undefined }));
    expect(parsed.name).toHaveLength(120);
    expect(parsed.email).toBeUndefined();
    expect(parsed.company).toBeUndefined();
  });

  it('reads junk as nothing', () => {
    expect(parseHandoffIdentity('')).toEqual({});
    expect(parseHandoffIdentity('#')).toEqual({});
    expect(parseHandoffIdentity('#role=admin&price=0')).toEqual({});
  });
});

describe('signupUrl', () => {
  const handoff: SignupHandoff = {
    selection: { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' },
    profile: { businessType: '3pl' },
    source: 'wizard',
  };

  it('puts the cart in the query and the person after the #', () => {
    const url = signupUrl('http://localhost:3300/', handoff, { name: 'Maya Chen', email: 'maya@northwind.example' });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('http://localhost:3300/signup');
    expect(parseHandoff(parsed.searchParams)).toEqual(handoff);
    expect(parsed.search).not.toContain('maya');
    expect(parseHandoffIdentity(parsed.hash)).toEqual({ name: 'Maya Chen', email: 'maya@northwind.example' });
  });

  it('has no # when there is no identity', () => {
    expect(signupUrl('https://kitstak.app', handoff)).toBe(
      'https://kitstak.app/signup?products=crm%2Cwms&seats=5&warehouses=1&billing=monthly&businessType=3pl&src=wizard',
    );
    expect(signupUrl('https://kitstak.app', handoff, {})).not.toContain('#');
  });
});
