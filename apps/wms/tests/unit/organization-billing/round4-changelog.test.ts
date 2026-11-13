/** Round 4: contract change-log messages (fee names verbatim, Create/Delete types, readable calculation entries) and approval guard. */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { contractSchema, feeSchema, FEE_DEFAULTS } from '@/lib/grid-defs/organization/billing';
import {
  approveContracts,
  CONTRACT_ENTITY,
  createContract,
  createFee,
  deleteFee,
} from '@/server/repositories/billing';
import { calculateContracts } from '@/server/repositories/billing-reports';
import { createWorld, type World } from '../foundation/domain/fixtures';

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

const logs = async (id: string) =>
  await w.db
    .select()
    .from(schema.changeLog)
    .where(and(eq(schema.changeLog.entityType, CONTRACT_ENTITY), eq(schema.changeLog.entityId, id)));

describe('billing contract change log (round 4)', () => {
  it('logs fee create/delete with the exact name and a readable calculation entry', async () => {
    const contract = await createContract(
      w.db,
      auth,
      actor(),
      contractSchema.parse({
        name: 'R4 Contract',
        clientId: w.clientId,
        warehouseId: w.warehouseId,
        calcStartDate: '2026-10-01',
        frequency: 'Monthly',
      }),
    );
    expect((await approveContracts(w.db, auth, actor(), [contract.id])).failed[0]?.message).toMatch(
      /Add at least one fee/,
    );
    const fee = await createFee(
      w.db,
      auth,
      actor(),
      contract.id,
      feeSchema.parse({
        ...FEE_DEFAULTS,
        name: 'PickPack',
        operationType: 'Recurring',
        feeBy: 'Recurring',
        chargeBy: 'Recurring',
        tiers: [{ fromQty: 1, toQty: null, rate: 25 }],
      }),
    );
    const created = (await logs(contract.id)).find((l) => l.field === 'fee');
    expect(created).toMatchObject({ type: 'Create' });
    expect(created?.message).toMatch(/^Fee PickPack is created\. /);
    expect(created?.message).not.toContain('  ');

    await calculateContracts(
      w.db,
      auth,
      actor(),
      { ids: [contract.id], mode: 'custom', start: '2026-11-01', end: '2026-11-08' } as never,
      new Date('2026-11-09T12:00:00Z'),
    );
    const calc = (await logs(contract.id)).find((l) => l.field === 'lastCalculatedAt');
    expect(calc?.message).toMatch(/^Calculated bill \d{16} for 11\/01\/2026 to 11\/08\/2026\.$/);

    await deleteFee(w.db, auth, actor(), contract.id, fee.id);
    expect((await logs(contract.id)).find((l) => l.type === 'Delete')?.message).toBe(
      'Fee PickPack is deleted.',
    );
  });
});
