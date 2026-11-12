/**
 * Round 8 (parity loop, critic R3 5.6): previews never write, one live bill per contract period
 * (engine guard + DB trigger), "Last closed period" refuses an open first period, open-period
 * approval needs explicit confirmation, client code uniqueness checks, picker-safe client SQL.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import { dbErrorMessage } from '@/server/db/sql';
import type { AuthContext } from '@/server/auth/context';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';
import { contractSchema, FEE_DEFAULTS, feeSchema } from '@/lib/grid-defs/organization/billing';
import {
  approveReports,
  calculateContracts,
  periodFor,
  previewCalculation,
  usDay,
} from '@/server/repositories/billing-reports';
import { BILL_PERIOD_GUARD, calculateContract } from '@/server/repositories/billing-engine';
import { createContract, createFee } from '@/server/repositories/billing';
import { clientCodeCheck, listClientsForCaller } from '@/server/repositories/clients';
import { createWorld, type World } from '../foundation/domain/fixtures';

describe('billing round 8', () => {
  let w: World;
  let auth: AuthContext;
  const actor = () => ({ userId: w.userId, source: 'Web' });
  beforeEach(async () => {
    w = await createWorld();
    const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
    auth = {
      scope,
      viewScope: scope,
      permissions: new Set<string>(),
      restrictions: [],
      user: { id: w.userId },
      context: { warehouseId: null, clientId: null },
    } as unknown as AuthContext;
  });
  afterEach(() => w.close());
  const contract = async (calcStartDate = '2026-11-01') => {
    const c = await createContract(
      w.db,
      auth,
      actor(),
      contractSchema.parse({
        name: `C${Math.random()}`,
        clientId: w.clientId,
        warehouseId: w.warehouseId,
        calcStartDate,
        frequency: 'Monthly',
      }),
    );
    await createFee(
      w.db,
      auth,
      actor(),
      c.id,
      feeSchema.parse({
        ...FEE_DEFAULTS,
        name: 'Account',
        operationType: 'Recurring',
        feeBy: 'Recurring',
        chargeBy: 'Recurring',
        tiers: [{ fromQty: 1, toQty: null, rate: 77 }],
      }),
    );
    return c;
  };
  const billCount = async () => (await w.db.select().from(schema.billingReports)).length;
  const nov10 = new Date('2026-11-10T15:00:00.000Z');

  it('previews never write a bill, whatever the mode', async () => {
    const c = await contract();
    for (const mode of ['lastClosed', 'current'] as const)
      await previewCalculation(w.db, auth, { ids: [c.id], mode }, nov10);
    await previewCalculation(
      w.db,
      auth,
      { ids: [c.id], mode: 'custom', start: '2026-11-01', end: '2026-11-08' },
      nov10,
    );
    expect(await billCount()).toBe(0);
  });

  it("'Last closed period' refuses while the first period is still open, and never bills it", async () => {
    const c = await contract();
    expect(
      periodFor({ calcStartDate: '2026-11-01', frequency: 'Monthly' }, { mode: 'lastClosed' }, '2026-11-10'),
    ).toBeNull();
    const preview = (await previewCalculation(w.db, auth, { ids: [c.id], mode: 'lastClosed' }, nov10))
      .previews[0]!;
    expect(preview.blocked).toMatch(/^No closed period yet/);
    expect(preview.blocked).toContain('11/01/2026 – 11/30/2026');
    const out = await calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: 'lastClosed' }, nov10);
    expect(out.succeeded).toHaveLength(0);
    expect(out.failed[0]?.message).toMatch(/No closed period yet/);
    expect(await billCount()).toBe(0);
    // Once November has closed, the same contract bills 11/01–11/30.
    const dec1 = new Date('2026-12-01T15:00:00.000Z');
    const ok = (await calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: 'lastClosed' }, dec1))
      .reports[0]!;
    expect([ok.periodStart, ok.periodEnd]).toEqual(['2026-11-01', '2026-11-30']);
  });

  it('never keeps two live bills for overlapping periods: engine guard and DB trigger', async () => {
    const c = await contract();
    const first = (
      await calculateContracts(
        w.db,
        auth,
        actor(),
        { ids: [c.id], mode: 'custom', start: '2026-11-01', end: '2026-11-08' },
        nov10,
      )
    ).reports[0]!;
    expect(first.status).toBe('Successful');
    // An overlapping range without replace is refused before writing.
    const clash = await calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: 'current' }, nov10);
    expect(clash.failed[0]?.code).toBe('DUPLICATE');
    expect(await billCount()).toBe(1);
    // A direct engine call (e.g. a stale handler that ignored dryRun) is refused too.
    await expect(
      async () =>
        await calculateContract(
          w.db,
          { userId: null, source: 'test' },
          c.id,
          { start: '2026-11-01', end: '2026-12-01' },
          nov10,
        ),
    ).rejects.toThrow(/already covers part of this period/);
    // And the database itself refuses a raw overlapping insert.
    const row = (await w.db.select().from(schema.billingReports).limit(1))[0]!;
    const { id: _id, ...copy } = row;
    void _id;
    const raised = await w.db
      .insert(schema.billingReports)
      .values({
        ...copy,
        billNumber: 'X1',
        periodStart: '2026-11-05T00:00:00.000Z',
        periodEnd: '2026-11-30T23:59:59.999Z',
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(dbErrorMessage(raised)).toContain(BILL_PERIOD_GUARD);
    // Canceled or failed rows are not live, so they never trip the guard.
    await w.db.insert(schema.billingReports).values({ ...copy, billNumber: 'X2', billStatus: 'Canceled' });
    expect(await billCount()).toBe(2);
    // Replace recalculates the draft and cancels the other overlapping one: still one live bill.
    const replaced = (
      await calculateContracts(
        w.db,
        auth,
        actor(),
        { ids: [c.id], mode: 'current', replaceDrafts: true },
        nov10,
      )
    ).reports[0]!;
    expect(replaced.status).toBe('Successful');
    const live = (await w.db.select().from(schema.billingReports)).filter((b) => b.billStatus !== 'Canceled');
    expect(live).toHaveLength(1);
  });

  it("refuses approving a bill whose period hasn't ended unless explicitly confirmed", async () => {
    const c = await contract();
    const bill = (await calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: 'current' }, nov10))
      .reports[0]!;
    const refused = await approveReports(w.db, auth, actor(), [bill.reportId], { now: nov10 });
    expect(refused.failed[0]?.message).toMatch(/period ends 11\/10\/2026 and hasn't closed yet/);
    const ok = await approveReports(w.db, auth, actor(), [bill.reportId], {
      now: nov10,
      allowOpenPeriod: true,
    });
    expect(ok.succeeded).toEqual([bill.reportId]);
  });

  it('formats user-facing server dates as MM/DD/YYYY', () => {
    expect(usDay('2026-11-01')).toBe('11/01/2026');
    expect(usDay('2026-11-30T23:59:59.999Z')).toBe('11/30/2026');
  });

  it('checks client codes case-insensitively and suggests the nearest free one', async () => {
    const existing = (await w.db.select({ code: schema.clients.code }).from(schema.clients).limit(1))[0]!
      .code;
    const taken = await clientCodeCheck(w.db, existing.toLowerCase());
    expect(taken.available).toBe(false);
    expect(taken.suggestion).toBe(`${existing.toUpperCase()}2`);
    expect((await clientCodeCheck(w.db, 'ZZFREE9')).available).toBe(true);
  });

  it('selects only picker-safe client columns for callers without Clients view', async () => {
    const { rows } = await listClientsForCaller(w.db, auth, EMPTY_GRID_QUERY);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows)
      expect(Object.keys(row).sort()).toEqual([
        'code',
        'currency',
        'fullName',
        'id',
        'name',
        'officialName',
        'status',
      ]);
  });
});
