/**
 * Round 6 parity loop (M12): seeded credential-less stores run on the demo feed (Run, Simulate error,
 * scheduler, health), Recent Errors reconciles with Missing Shipment Orders, and the ShipStation carrier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import type { Scope } from '@/server/auth/scope';
import { channelSettingsSchema } from '@/lib/domain-types';
import {
  isDemoFeed,
  isSimulated,
  pauseReason,
  runChannelMethod,
  runDueChannelMethods,
} from '@/server/integrations/runtime/channel-runtime';
import { feedOrderCount } from '@/server/integrations/sandbox';
import { canSimulateError } from '@/lib/grid-defs/integrations/logs';
import { healthRows, recentErrorOrders, recentErrorRows } from '@/server/repositories/monitoring';
import { listMethods } from '@/server/repositories/integration-logs';
import {
  shipstationAuth,
  shipstationCarrierOf,
  SHIPSTATION_DEF,
} from '@/server/integrations/carriers/shipstation';
import { createWorld, type World } from '../foundation/domain/fixtures';

let w: World;
let auth: AuthContext;

beforeEach(async () => {
  w = await createWorld();
  const scope: Scope = { warehouseIds: [w.warehouseId], clientIds: 'all' };
  auth = {
    scope,
    viewScope: scope,
    permissions: new Set<string>(),
    restrictions: [],
    user: { id: w.userId },
    context: { warehouseId: null, clientId: null },
  } as unknown as AuthContext;
});
afterEach(() => {
  w.close();
  vi.unstubAllGlobals();
});

async function demoStore() {
  const settings = channelSettingsSchema.parse({ paymentStatuses: ['paid', 'pending'] });
  const c = (
    await w.db
      .insert(schema.channelConnections)
      .values({
        provider: 'shopify',
        storeName: 'Apex Demo Shopify',
        clientId: w.clientId,
        distribution: 'Custom App',
        status: 'Completed',
        settings,
      })
      .returning()
  )[0];
  await w.db
    .insert(schema.channelLocationMappings)
    .values({
      connectionId: c.id,
      channelLocationId: 'gid://loc/71200',
      channelLocationName: 'Louisville FC',
      warehouseId: w.warehouseId,
    });
  const orders = (
    await w.db
      .insert(schema.channelMethods)
      .values({
        connectionId: c.id,
        method: 'Download Orders',
        status: 'Active',
        intervalMinutes: 15,
        jobStatus: 'Paused',
        nextRunAt: '2026-01-01T00:00:00.000Z',
      })
      .returning()
  )[0];
  return { c, orders };
}

describe('demo feed (seeded store without credentials)', () => {
  it('is runnable, not paused, and offers Simulate error', () => {
    const row = {
      provider: 'shopify',
      distribution: 'Custom App' as const,
      credentialsEnc: null,
      isActive: true,
    };
    expect(isDemoFeed(row)).toBe(true);
    expect(isSimulated(row)).toBe(true);
    expect(pauseReason(row)).toBeNull();
    expect(pauseReason({ ...row, isActive: false })).toMatch(/inactive/);
    expect(isDemoFeed({ ...row, credentialsEnc: 'enc' })).toBe(false);
    expect(canSimulateError(true, 'Download Orders')).toBe(true);
    expect(canSimulateError(true, 'Sync Inventory')).toBe(false);
    expect(canSimulateError(false, 'Download Orders')).toBe(false);
  });

  it('keeps scheduled demo traffic sparse; a manual run always brings orders', () => {
    const scheduled = Array.from({ length: 40 }, (_, i) =>
      feedOrderCount('c1', i + 1, { demo: true, manual: false }),
    );
    expect(scheduled.filter((n) => n > 0).length).toBe(10);
    expect(Math.max(...scheduled)).toBeLessThanOrEqual(2);
    for (let i = 1; i <= 20; i++)
      expect(feedOrderCount('c1', i, { demo: true, manual: true })).toBeGreaterThan(0);
    // The KitStak Sandbox keeps its R5 behaviour (every 7th run is "No data").
    expect(feedOrderCount('c1', 7, {})).toBe(0);
    expect(feedOrderCount('c1', 7, { simulateError: true })).toBeGreaterThan(0);
  });

  it("Run imports orders into the store's mapped location; Simulate error lands in Missing Orders and Health", async () => {
    const { c, orders } = await demoStore();
    const ok = await runChannelMethod(w.db, orders.id, { manual: true });
    expect(ok.status).toBe('Successful');
    expect(ok.success).toBeGreaterThan(0);
    const created = await w.db
      .select()
      .from(schema.shipmentOrders)
      .where(eq(schema.shipmentOrders.channelConnectionId, c.id));
    expect(created.length).toBe(ok.success);
    expect(created.every((o) => o.warehouseId === w.warehouseId && o.channel === 'Shopify')).toBe(true);
    const m = (
      await w.db.select().from(schema.channelMethods).where(eq(schema.channelMethods.id, orders.id)).limit(1)
    )[0];
    expect(m?.jobStatus).toBe('Waiting For Next');
    expect(Date.parse(m?.nextRunAt ?? '')).toBeGreaterThan(Date.now());

    const sim = await runChannelMethod(w.db, orders.id, { manual: true, simulateError: true });
    expect(sim.error).toBe(1);
    const missing = await w.db
      .select()
      .from(schema.channelMissingOrders)
      .where(eq(schema.channelMissingOrders.connectionId, c.id));
    expect(missing).toHaveLength(1);

    const health = (await healthRows(w.db, auth)).find((h) => h.id === c.id);
    expect(health?.downloadStatus).toBe('Active');
    expect(health?.pauseReason).toBeNull();
    expect(health?.successRate).not.toBeNull();

    const methods = (
      await listMethods(w.db, auth, { page: 1, pageSize: 50, filters: [], sort: [], search: '' } as never)
    ).rows;
    const row = methods.find((x) => x.id === orders.id);
    expect(row?.demoFeed).toBe(true);
    expect(row?.canSimulateError).toBe(true);
    expect(row?.pauseReason).toBeNull();
  });

  it('the scheduler runs due demo methods instead of pausing them', async () => {
    const { orders } = await demoStore();
    const res = await runDueChannelMethods(w.db, new Date());
    expect(res).toEqual({ ran: 1, skipped: 0 });
    expect(
      (
        await w.db
          .select()
          .from(schema.channelMethods)
          .where(eq(schema.channelMethods.id, orders.id))
          .limit(1)
      )[0]?.jobStatus,
    ).toBe('Waiting For Next');
  });
});

describe('Recent Errors reconciles with Missing Shipment Orders', () => {
  it('counts open missing orders that have no run item, with a drilldown', async () => {
    const { c } = await demoStore();
    const now = new Date();
    const at = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
    const mk = async (
      n: string,
      code: string,
      h: number,
      status: 'Error' | 'Retrying' | 'Resolved' = 'Error',
    ) =>
      await w.db.insert(schema.channelMissingOrders).values({
        connectionId: c.id,
        orderCode: `SHP-${n}`,
        channelOrderNumber: `#${n}`,
        orderDate: at(h + 3),
        lastUpdated: at(h),
        lastErrorCode: code,
        payload: '{}',
        status,
      });
    await mk('1', 'Open Api Error', 30);
    await mk('2', 'Open Api Error', 30.1);
    await mk('3', 'All products are Digital', 50, 'Retrying');
    await mk('4', 'Open Api Error', 60, 'Resolved');
    await mk('5', 'Open Api Error', 24 * 20);
    const rows = await recentErrorRows(w.db, auth, now, 'UTC');
    expect(rows.reduce((s, r) => s + r.occurrences, 0)).toBe(3);
    const api = rows.find((r) => r.errorReason === 'Open Api Error');
    expect(api?.affectedOrders).toBe(2);
    const drill = await recentErrorOrders(w.db, auth, c.id, 'Open Api Error', api?.day ?? '', 'UTC');
    expect(drill.map((d) => d.storeOrderNumber).sort()).toEqual(['#1', '#2']);
    expect(drill.every((d) => d.missingOrderId)).toBe(true);
  });
});

describe('ShipStation carrier (live API)', () => {
  it('maps services to ShipStation carrier codes and uses Basic auth', () => {
    expect(shipstationCarrierOf('usps_priority_mail')).toBe('stamps_com');
    expect(shipstationCarrierOf('ups_ground')).toBe('ups_walleted');
    expect(shipstationCarrierOf('fedex_ground')).toBe('fedex');
    expect(shipstationAuth({ apiKey: 'k', apiSecret: 's' })).toBe(
      `Basic ${Buffer.from('k:s').toString('base64')}`,
    );
    expect(SHIPSTATION_DEF.credentialFields.map((f) => f.key)).toEqual(['apiKey', 'apiSecret']);
  });

  it('validates credentials against GET /carriers and rates per carrier code', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init: RequestInit = {}) => {
        const url = String(input);
        calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
        if (url.endsWith('/carriers'))
          return new Response(JSON.stringify([{ code: 'stamps_com' }, { code: 'ups_walleted' }]), {
            status: 200,
          });
        return new Response(
          JSON.stringify([
            {
              serviceCode: 'usps_priority_mail',
              serviceName: 'USPS Priority Mail',
              shipmentCost: 8.1,
              otherCost: 0.4,
            },
          ]),
          { status: 200 },
        );
      }),
    );
    const creds = { apiKey: 'k', apiSecret: 's' };
    await expect(SHIPSTATION_DEF.live.validate(creds, 'Production')).resolves.toMatch(/2 carriers/);
    const svc = {
      id: 'svc1',
      serviceCode: 'usps_priority_mail',
      name: 'USPS Priority Mail (ShipStation)',
      transitDays: 3,
    } as never;
    const quotes = await SHIPSTATION_DEF.live.rate(
      {
        connection: {} as never,
        services: [svc],
        from: {
          name: 'WH',
          line1: '1 A St',
          city: 'Louisville',
          state: 'KY',
          postalCode: '40202',
          country: 'US',
        },
        to: { name: 'Ann', line1: '2 B St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
        packages: [{ weightOz: 12, length: 8, width: 6, height: 4 }],
      },
      creds,
    );
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.amount).toBe(8.5);
    const rateCall = calls.find((c) => c.url.endsWith('/shipments/getrates'));
    expect((rateCall?.body as { carrierCode: string }).carrierCode).toBe('stamps_com');
  });

  it('maps a 401 to a clear credential error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );
    await expect(
      SHIPSTATION_DEF.live.validate({ apiKey: 'k', apiSecret: 'bad' }, 'Production'),
    ).rejects.toThrow(/rejected/);
  });
});
