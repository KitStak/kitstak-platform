/** M12 round 2 parity: import-error hardening, relative dates, putaway fields, live channel mappers, carriers. */
import { describe, expect, it } from 'vitest';
import {
  ORDER_CODE_CONFLICT,
  classifyImportError,
  isInternalDbText,
  repeatedFailures,
} from '@/lib/grid-defs/integrations/import-errors';
import {
  DATE_PRESETS,
  PUTAWAY_CONDITION_FIELDS,
  RELATIVE_DATES_SUPPORTED,
  comparatorsFor,
  datePresetValue,
  describeCondition,
  describeDatePreset,
  parseDatePresetValue,
} from '@/lib/grid-defs/integrations/rule-fields';
import { channelCredentialProfile, connectStoreSchema } from '@/lib/grid-defs/integrations/channels';
import { pauseLabel } from '@/lib/grid-defs/integrations/monitoring';
import { wooBaseUrl, wooToOrder } from '@/server/integrations/woocommerce';
import { ebayToOrder } from '@/server/integrations/ebay';
import { walmartToOrder } from '@/server/integrations/walmart';
import { amazonToOrder, spApiHost } from '@/server/integrations/amazon';
import { UPS_DEF } from '@/server/integrations/carriers/ups';
import { customAdapter } from '@/server/integrations/carriers/custom';
import { STAMPS_DEF } from '@/server/integrations/carriers/stamps';
import { CarrierError, type RateRequest } from '@/server/domain/carriers/adapter';
import { parseDateSpec } from '@/server/query/date-presets';

describe('classifyImportError', () => {
  it('maps the shipment-order code collision to a catalog code, retryable, without SQL text', () => {
    const r = classifyImportError(new Error('UNIQUE constraint failed: shipment_orders.code'));
    expect(r.code).toBe(ORDER_CODE_CONFLICT);
    expect(r.retryable).toBe(true);
    expect(isInternalDbText(r.message)).toBe(false);
    expect(r.message).not.toMatch(/constraint|shipment_orders/i);
  });
  it('hides other driver errors behind a plain message', () => {
    const r = classifyImportError(
      Object.assign(new Error('FOREIGN KEY constraint failed'), {
        name: 'SqliteError',
        code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
      }),
    );
    expect(r.code).toBe('Unexpected Error');
    expect(r.retryable).toBe(false);
    expect(r.message).not.toMatch(/FOREIGN KEY|SQLITE/);
  });
  it('treats a busy database as transient', () => {
    expect(classifyImportError(new Error('database is locked')).retryable).toBe(true);
  });
  it('keeps domain validation messages', () => {
    expect(
      classifyImportError(Object.assign(new Error('Warehouse not found or inactive'), { code: 'VALIDATION' }))
        .message,
    ).toBe('Warehouse not found or inactive');
  });
  it('flags codes that repeat at or above the threshold, most frequent first', () => {
    expect(repeatedFailures(['a', 'b', 'a', 'a', 'b', 'b', 'b', 'c'])).toEqual([
      { code: 'b', count: 4 },
      { code: 'a', count: 3 },
    ]);
    expect(repeatedFailures(['a', 'a'])).toEqual([]);
  });
});

describe('relative date presets', () => {
  it("lists Logiwa's 17 relative choices (16 presets + is between) in order", () => {
    expect(DATE_PRESETS.map((p) => p.label)).toEqual([
      'Today',
      'Last 3 Days',
      'Last 7 Days',
      'Last 30 Days',
      'Last 90 Days',
      'Last 12 Months',
      'X Days Ahead and More',
      'X Days Before and More',
      'Within Next X Days',
      'Within Past X Days',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
  });
  it('serialises to the shared date-spec grammar the engine resolves', () => {
    for (const p of DATE_PRESETS) {
      const v = datePresetValue(p.key, p.needsDays ? 5 : null);
      expect(parseDateSpec(v)).not.toBeNull();
      expect(parseDatePresetValue(v)?.preset.key).toBe(p.key);
    }
    expect(datePresetValue('withinNext', 30)).toBe('withinNext30d');
    expect(datePresetValue('ahead', -4)).toBe('ahead0d');
  });
  it('describes presets in plain language', () => {
    expect(describeDatePreset('withinNext1d')).toBe('Within Next 1 Day');
    expect(describeDatePreset('before10d')).toBe('10 Days Before and More');
    expect(describeDatePreset('mon')).toBe('Monday');
    expect(
      describeCondition('putaway', {
        field: 'expiryDate',
        comparator: 'dateIs' as never,
        value: 'withinNext30d',
      }),
    ).toBe('Expiry Date is Within Next 30 Days');
  });
  it('offers relative comparators only once the engine supports them', () => {
    const list = comparatorsFor('date') as readonly string[];
    expect(list.includes('dateIs')).toBe(RELATIVE_DATES_SUPPORTED);
    expect(list).toEqual(expect.arrayContaining(['between', 'gt', 'lt', 'isEmpty', 'isNotEmpty']));
  });
});

describe('putaway condition fields', () => {
  it('has the full Logiwa list: 33 base fields + 30 custom-field slots, unique and alphabetical', () => {
    expect(PUTAWAY_CONDITION_FIELDS).toHaveLength(63);
    const keys = PUTAWAY_CONDITION_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of [
      'allocatedTransferQuantity',
      'isPreventAllocation',
      'lpCarrier',
      'isParentLpTransfer',
      'locationCustomField.date3',
      'lpTypeCustomField.toggle2',
      'productCustomField.textBox1',
    ])
      expect(keys).toContain(k);
    const labels = PUTAWAY_CONDITION_FIELDS.map((f) => f.label);
    expect([...labels].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))).toEqual(labels);
    expect(PUTAWAY_CONDITION_FIELDS.find((f) => f.key === 'locationCustomField.date1')).toMatchObject({
      label: 'Location Custom Field Date Picker 1',
      kind: 'date',
    });
    expect(PUTAWAY_CONDITION_FIELDS.find((f) => f.key === 'productCustomField.toggle1')?.kind).toBe(
      'boolean',
    );
  });
});

describe('live channel mappers', () => {
  it('WooCommerce: processing order → paid, shipping address, # number', () => {
    expect(wooBaseUrl('http://shop.example.com/')).toBe('https://shop.example.com/wp-json/wc/v3');
    const o = wooToOrder({
      id: 812,
      number: '812',
      status: 'processing',
      date_created_gmt: '2026-11-01T10:00:00',
      date_paid_gmt: '2026-11-01T10:01:00',
      total: '42.00',
      billing: { email: 'a@b.com', phone: '5551234567' },
      shipping: {
        first_name: 'Ana',
        last_name: 'Diaz',
        address_1: '1 Main St',
        city: 'Austin',
        state: 'TX',
        postcode: '78701',
        country: 'US',
      },
      line_items: [{ sku: 'SKU-1', name: 'Tee', quantity: 2, price: 21, product_id: 9 }],
    });
    expect(o).toMatchObject({
      id: '812',
      number: '#812',
      financialStatus: 'paid',
      email: 'a@b.com',
      createdAt: '2026-11-01T10:00:00.000Z',
    });
    expect(o.shipTo).toMatchObject({
      name: 'Ana Diaz',
      line1: '1 Main St',
      zip: '78701',
      country: 'United States',
      phone: '5551234567',
    });
    expect(o.lines[0]).toMatchObject({ sku: 'SKU-1', quantity: 2, price: 21, isCustom: false });
  });
  it('eBay: fulfillment start instructions give the ship-to; fulfilled lines count as fulfilled', () => {
    const o = ebayToOrder({
      orderId: '12-34567-89012',
      creationDate: '2026-11-02T09:00:00.000Z',
      orderPaymentStatus: 'PAID',
      pricingSummary: { total: { value: '30.00' } },
      fulfillmentStartInstructions: [
        {
          shippingStep: {
            shipTo: {
              fullName: 'Lee Park',
              contactAddress: {
                addressLine1: '9 Elm',
                city: 'Reno',
                stateOrProvince: 'NV',
                postalCode: '89501',
                countryCode: 'US',
              },
            },
          },
        },
      ],
      lineItems: [
        {
          sku: 'A',
          title: 'Mug',
          quantity: 3,
          lineItemCost: { value: '30.00' },
          lineItemFulfillmentStatus: 'NOT_STARTED',
        },
        {
          sku: 'B',
          title: 'Cap',
          quantity: 1,
          lineItemCost: { value: '5' },
          lineItemFulfillmentStatus: 'FULFILLED',
        },
      ],
    });
    expect(o).toMatchObject({
      number: '12-34567-89012',
      financialStatus: 'paid',
      hasFulfillmentOrders: true,
    });
    expect(o.shipTo).toMatchObject({
      firstName: 'Lee',
      lastName: 'Park',
      state: 'NV',
      country: 'United States',
    });
    expect(o.lines.map((l) => [l.sku, l.price, l.fulfilledQuantity])).toEqual([
      ['A', 10, 0],
      ['B', 5, 1],
    ]);
  });
  it('Walmart: epoch order date, PRODUCT charge as price, shipped quantity', () => {
    const o = walmartToOrder({
      purchaseOrderId: '1796277083022',
      customerOrderId: '5281956426648',
      orderDate: Date.UTC(2026, 10, 3),
      customerEmailId: 'x@relay.walmart.com',
      shippingInfo: {
        phone: '3155598681',
        postalAddress: {
          name: 'Kim Lee',
          address1: '3258BLUE',
          city: 'Bentonville',
          state: 'AR',
          postalCode: '72712',
          country: 'USA',
        },
      },
      orderLines: {
        orderLine: [
          {
            lineNumber: '1',
            item: { sku: 'W-1', productName: 'Lamp' },
            orderLineQuantity: { amount: '2' },
            charges: { charge: [{ chargeType: 'PRODUCT', chargeAmount: { amount: 15 } }] },
            orderLineStatuses: { orderLineStatus: [{ status: 'Shipped', statusQuantity: { amount: '1' } }] },
          },
        ],
      },
    });
    expect(o).toMatchObject({
      id: '1796277083022',
      number: '5281956426648',
      createdAt: '2026-11-03T00:00:00.000Z',
      totalPrice: 30,
    });
    expect(o.shipTo?.country).toBe('United States');
    expect(o.lines[0]).toMatchObject({ sku: 'W-1', quantity: 2, price: 15, fulfilledQuantity: 1 });
  });
  it('Amazon: MFN order with items, Prime tag, region host', () => {
    const o = amazonToOrder(
      {
        AmazonOrderId: '113-1234567-1234567',
        PurchaseDate: '2026-11-04T12:00:00Z',
        OrderStatus: 'Unshipped',
        FulfillmentChannel: 'MFN',
        IsPrime: true,
        OrderTotal: { Amount: '19.98' },
        ShippingAddress: {
          Name: 'Sam Roe',
          AddressLine1: '5 Oak Ave',
          City: 'Seattle',
          StateOrRegion: 'WA',
          PostalCode: '98101',
          CountryCode: 'US',
        },
        BuyerInfo: { BuyerEmail: 's@marketplace.amazon.com' },
      },
      [
        {
          SellerSKU: 'AMZ-1',
          Title: 'Socks',
          QuantityOrdered: 2,
          QuantityShipped: 0,
          ItemPrice: { Amount: '19.98' },
        },
      ],
    );
    expect(o).toMatchObject({
      financialStatus: 'paid',
      tags: ['Prime'],
      email: 's@marketplace.amazon.com',
      hasFulfillmentOrders: true,
    });
    expect(o.lines[0]).toMatchObject({ sku: 'AMZ-1', quantity: 2, price: 9.99 });
    expect(spApiHost('ATVPDKIKX0DER')).toContain('-na.');
    expect(spApiHost('A1PA6795UKMFR9')).toContain('-eu.');
    expect(spApiHost('A1VC38T7YXB528')).toContain('-fe.');
  });
});

describe('connect store schema per channel', () => {
  const base = { distribution: 'Custom App', storeName: 'Store', clientId: 'c1' } as const;
  it('Amazon needs LWA client + refresh token + seller ID', () => {
    const r = connectStoreSchema.safeParse({
      ...base,
      provider: 'amazon',
      authMethod: 'Client ID & Secret',
      apiClientId: 'id',
      apiClientSecret: 's',
    });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['refreshToken', 'sellerId']));
    expect(
      connectStoreSchema.safeParse({
        ...base,
        provider: 'amazon',
        authMethod: 'Client ID & Secret',
        apiClientId: 'id',
        apiClientSecret: 's',
        refreshToken: 'Atzr|x',
        sellerId: 'A1B2C3',
      }).success,
    ).toBe(true);
  });
  it('WooCommerce only takes a consumer key + secret', () => {
    const r = connectStoreSchema.safeParse({
      ...base,
      provider: 'woocommerce',
      authMethod: 'Access Token',
      accessToken: 't',
    });
    expect(r.success).toBe(false);
    expect(channelCredentialProfile('woocommerce').clientIdLabel).toBe('Consumer key');
  });
});

describe('pauseLabel', () => {
  it('labels credential-less seeded stores as neutral demo stores', () => {
    expect(
      pauseLabel(
        "Demo store: no credentials are stored. Reconnect it with the store's credentials to start syncing",
      ),
    ).toEqual({ label: 'Demo store', tone: 'neutral' });
    expect(pauseLabel('The store connection is inactive')).toEqual({ label: 'Inactive', tone: 'neutral' });
    expect(pauseLabel(null)).toBeNull();
  });
});

describe('carrier catalogs', () => {
  it('UPS lists the full Logiwa service and package catalog', () => {
    expect(UPS_DEF.services).toHaveLength(21);
    expect(UPS_DEF.services.map((s) => s.name)).toEqual(
      expect.arrayContaining([
        'UPS Ground Saver',
        'UPS 2nd Day Air A.M.',
        'UPS Next Day Air Early',
        'UPS Worldwide Economy DDP',
        'UPS Economy Mail Innovations',
      ]),
    );
    expect(UPS_DEF.packages.length).toBeGreaterThanOrEqual(23);
    expect(new Set(UPS_DEF.services.map((s) => s.code)).size).toBe(21);
    expect(STAMPS_DEF.credentialFields.map((f) => f.key)).toEqual([
      'clientId',
      'clientSecret',
      'refreshToken',
    ]);
  });
  it('Custom Carrier rates locally without credentials, also in Production', async () => {
    const req = {
      connection: { environment: 'Production', credentialsEnc: null },
      services: [
        { id: 's1', serviceCode: 'STD', name: 'Custom Standard' },
        { id: 's2', serviceCode: 'INT', name: 'Custom International' },
      ],
      from: {
        name: 'WH',
        line1: '1 Dock',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        country: 'US',
        phone: '5125550100',
      },
      to: { name: 'Ana', line1: '2 Main', city: 'Denver', state: 'CO', postalCode: '80202', country: 'US' },
      packages: [{ weightOz: 32, length: 10, width: 8, height: 4 }],
    } as unknown as RateRequest;
    const quotes = await customAdapter.rate(req);
    expect(quotes.map((q) => q.serviceCode)).toEqual(['STD']);
    expect(quotes[0]?.amount).toBeGreaterThan(0);
    await expect(
      customAdapter.rate({ ...req, to: { ...req.to, postalCode: '' } } as RateRequest),
    ).rejects.toBeInstanceOf(CarrierError);
  });
});
