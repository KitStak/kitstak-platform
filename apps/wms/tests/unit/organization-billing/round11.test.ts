/**
 * Round 11 (parity loop, critic R5 6): the bill number sequence skips numbers already taken via
 * Edit Info, the scheduler pauses contracts of Inactive clients (with an audit note on each
 * contract), VAS has a Created by filter, and fee / billing form names cap at 100 like Logiwa.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';
import { contractSchema, FEE_DEFAULTS, feeSchema } from '@/lib/grid-defs/organization/billing';
import { VAS_FIELDS } from '@/lib/grid-defs/organization/vas';
import {
  autoCalculateDue,
  calculateContracts,
  getReport,
  updateReportInfo,
} from '@/server/repositories/billing-reports';
import {
  approveContracts,
  createContract,
  createFee,
  duplicateContracts,
} from '@/server/repositories/billing';
import { wideBillNumber } from '@/server/repositories/billing-engine';
import { setClientStatus } from '@/server/repositories/clients';
import { listVas, vasCreators } from '@/server/repositories/vas';
import { createWorld, type World } from '../foundation/domain/fixtures';

describe('billing round 11', () => {
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

  const contract = async (name = `C${Math.random()}`, calcStartDate = '2026-10-01') => {
    const c = await createContract(
      w.db,
      auth,
      actor(),
      contractSchema.parse({
        name,
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
        tiers: [{ fromQty: 1, toQty: null, rate: 50 }],
      }),
    );
    return c;
  };
  const at = new Date('2026-11-10T15:00:00.000Z');

  it('skips a bill number already taken through Edit Info', async () => {
    const c = await contract();
    const first = (
      await calculateContracts(
        w.db,
        auth,
        actor(),
        { ids: [c.id], mode: 'custom', start: '2026-10-01', end: '2026-10-15' },
        at,
      )
    ).reports[0]!;
    expect(first.status).toBe('Successful');
    const next = String(BigInt(first.billNumber) + BigInt(1)).padStart(first.billNumber.length, '0');
    const row = await getReport(w.db, auth, first.reportId);
    await updateReportInfo(w.db, auth, actor(), first.reportId, {
      billNumber: next,
      billStatus: 'Draft',
      version: row.version,
    } as Parameters<typeof updateReportInfo>[4]);
    const second = await calculateContracts(
      w.db,
      auth,
      actor(),
      { ids: [c.id], mode: 'custom', start: '2026-10-16', end: '2026-10-31' },
      at,
    );
    expect(second.failed).toEqual([]);
    const bill = second.reports[0]!;
    expect(bill.status).toBe('Successful');
    expect(bill.billNumber).not.toBe(next);
    expect(BigInt(bill.billNumber)).toBe(BigInt(next) + BigInt(1));
  });

  it('wideBillNumber never returns a number in use', async () => {
    const taken = new Set(
      (await w.db.select({ n: schema.billingReports.billNumber }).from(schema.billingReports)).map(
        (x) => x.n,
      ),
    );
    for (let i = 0; i < 5; i++) expect(taken.has(await wideBillNumber(w.db, at))).toBe(false);
  });

  it('pauses automatic billing for Inactive clients and logs it on the contract', async () => {
    const c = await contract('Paused');
    await approveContracts(w.db, auth, actor(), [c.id]);
    expect((await setClientStatus(w.db, auth, actor(), [w.clientId], 'Inactive')).succeeded).toEqual([
      w.clientId,
    ]);
    const notes = await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, c.id));
    expect(notes.some((n) => /automatic billing is paused/.test(n.message ?? ''))).toBe(true);
    expect(await autoCalculateDue(w.db, at)).toMatchObject({ calculated: 0, failed: 0 });
    // A final bill stays a manual Calculate.
    expect(
      (await calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: 'lastClosed' }, at)).reports[0]
        ?.status,
    ).toBe('Successful');
    await setClientStatus(w.db, auth, actor(), [w.clientId], 'Active');
    expect(
      (await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, c.id))).some((n) =>
        /automatic billing resumes/.test(n.message ?? ''),
      ),
    ).toBe(true);
  });

  it('offers Created by as a VAS filter backed by real creators', async () => {
    expect(VAS_FIELDS.some((f) => f.field === 'createdBy' && f.type === 'enum')).toBe(true);
    expect(await vasCreators(w.db, auth)).toEqual([]);
    await listVas(w.db, auth, {
      ...EMPTY_GRID_QUERY,
      filters: [{ field: 'createdBy', op: 'eq', value: w.userId }],
    } as never);
  });

  it('caps fee and billing form names at 100 characters', async () => {
    const long = 'x'.repeat(101);
    expect(
      contractSchema.safeParse({
        name: long,
        clientId: w.clientId,
        warehouseId: w.warehouseId,
        calcStartDate: '2026-11-01',
        frequency: 'Monthly',
      }).success,
    ).toBe(false);
    expect(
      feeSchema.safeParse({
        ...FEE_DEFAULTS,
        name: long,
        operationType: 'Recurring',
        feeBy: 'Recurring',
        chargeBy: 'Recurring',
        tiers: [{ fromQty: 1, toQty: null, rate: 1 }],
      }).success,
    ).toBe(false);
    const c = await contract('y'.repeat(100));
    const copy = (await duplicateContracts(w.db, auth, actor(), [c.id])).created[0]!;
    expect(copy.name.length).toBeLessThanOrEqual(100);
    expect(copy.name.endsWith(' (copy)')).toBe(true);
  });
});
