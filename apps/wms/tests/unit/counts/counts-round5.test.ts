/**
 * Round 5 (parity loop): magnitude-coloured variance bands, Status last on every line grid,
 * found-stock dedupe, accuracy target, filtered Details links, timeline events, job-counter and
 * one-open-count-per-location integrity checks.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobTypeSettingsSchema } from '@/lib/domain-types';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { ledger } from '@/server/domain/ledger';
import { bandTone, differenceBand } from '@/components/counts/count-badges';
import { buildLineColumns } from '@/components/counts/counts-columns';
import { findExistingRow, type EntryDraft } from '@/components/counts/count-entry-table';
import { weekBelowTarget, IRA_TARGET_PCT } from '@/components/counts/count-accuracy-drawer';
import { countDetailsHref } from '@/components/counts/count-dialogs';
import { countChangeParts } from '@/components/counts/count-timeline';
import {
  COUNT_EVENT_FIELD,
  entryEventText,
  jobEventText,
  updateInvEventText,
} from '@/server/repositories/counts-events';
import {
  findCountJobCounterDrift,
  findOpenCountOverlaps,
  repairCountJobCounterDrift,
  repairOpenCountOverlaps,
} from '@/server/repositories/counts-integrity';
import { createCountJobs, createRecounts } from '@/server/repositories/counts-jobs';
import { cancelCountLines, updateInventoryForLines } from '@/server/repositories/counts-ops';
import { countSheet, submitSheetLine } from '@/server/repositories/counts-sheet';
import { createCountPlan } from '@/server/repositories/counts-plans';
import { createWorld, type World } from '../foundation/domain/fixtures';

let w: World;
let auth: AuthContext;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
  auth = {
    scope,
    viewScope: scope,
    permissions: new Set<string>(['inventory.count_plans.delete']),
    restrictions: [],
    user: { id: w.userId, role: 'admin' },
    context: { warehouseId: null, clientId: null },
  } as unknown as AuthContext;
});
afterEach(() => w.close());

async function locationPlan(code: string, locationId = w.loc.storageA) {
  await ledger.add(w.db, w.ctx, {
    warehouseId: w.warehouseId,
    clientId: w.clientId,
    productId: w.productId,
    locationId,
    qty: 12,
  });
  return await createCountPlan(w.db, w.ctx, auth, {
    code,
    warehouseId: w.warehouseId,
    description: null,
    scheduledAt: new Date().toISOString(),
    lockLocations: false,
    countType: 'Location',
    locationIds: [locationId],
    productIds: [],
  });
}
const jobType = async () =>
  (
    await w.db
      .insert(schema.jobTypes)
      .values({
        code: 'Cycle Count',
        description: 'Cycle Count',
        warehouseId: w.warehouseId,
        operationType: 'Count',
        settings: jobTypeSettingsSchema.parse({ count: {} }),
      })
      .returning()
  )[0].id;
const events = async (planId: string) =>
  (await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.field, COUNT_EVENT_FIELD))).filter(
    (r) => r.entityId === planId || r.parentEntityId === planId,
  );

describe('variance bands are coloured by magnitude', () => {
  it('over- and under-counts beyond tolerance are both red; within tolerance amber; zero grey', () => {
    expect(bandTone(differenceBand(150))).toBe('red');
    expect(bandTone(differenceBand(-12))).toBe('red');
    expect(bandTone(differenceBand(3))).toBe('amber');
    expect(bandTone(differenceBand(-3))).toBe('amber');
    expect(bandTone(differenceBand(0))).toBe('grey');
  });
});

describe('frozen Status is the last data column of every line grid', () => {
  it.each([['locations'], ['skus']] as const)('%s', (kind) => {
    const cols = buildLineColumns(kind, 'Location');
    const last = cols[cols.length - 1] as { id?: string; meta?: { sticky?: string } };
    expect(last.id).toBe('status');
    expect(last.meta?.sticky).toBe('right');
    expect(cols.filter((c) => (c as { meta?: { sticky?: string } }).meta?.sticky === 'right')).toHaveLength(
      1,
    );
  });
});

describe('plan Lines grid leads with Status and the count numbers (round 6)', () => {
  it('has no frozen overlay and Status within the first columns', () => {
    const cols = buildLineColumns('plan', 'Location') as { id?: string; meta?: { sticky?: string } }[];
    expect(cols.filter((c) => c.meta?.sticky === 'right')).toHaveLength(0);
    expect(cols.findIndex((c) => c.id === 'status')).toBeLessThan(3);
    expect(cols.slice(0, 6).map((c) => c.id)).toEqual(
      expect.arrayContaining(['countedQty', 'approvedStockQty', 'difference']),
    );
  });
});

describe('found stock never duplicates an expected row', () => {
  const row = (over: Partial<EntryDraft>): EntryDraft => ({
    key: 'k',
    inventoryId: 'i',
    productId: 'p1',
    sku: 'SKU-1',
    productName: '',
    lotNumber: null,
    lpNumber: null,
    systemQty: 4,
    counted: null,
    ...over,
  });
  it('matches an expected row of the same SKU and lot (case-insensitive lot)', () => {
    const drafts = [row({ key: 'a', lotNumber: 'L1' }), row({ key: 'b', productId: 'p2', sku: 'SKU-2' })];
    expect(findExistingRow(drafts, 'p1', 'l1')?.key).toBe('a');
    expect(findExistingRow(drafts, 'p2', null)?.key).toBe('b');
  });
  it('a different lot or a damaged row is not a match', () => {
    const drafts = [
      row({ key: 'a', lotNumber: 'L1' }),
      row({ key: 'd', inventoryId: null, damageReason: 'Crushed', lotNumber: 'L2' }),
    ];
    expect(findExistingRow(drafts, 'p1', 'L2')).toBeNull();
    expect(findExistingRow(drafts, 'p1', null)).toBeNull();
  });
});

describe('accuracy chart target', () => {
  it('flags only weeks below the IRA target', () => {
    expect(IRA_TARGET_PCT).toBe(95);
    expect(weekBelowTarget(64, 100)).toBe(true);
    expect(weekBelowTarget(95, 100)).toBe(false);
    expect(weekBelowTarget(0, 0)).toBe(false);
  });
});

describe('Update Inv. Details links', () => {
  it('pre-filter Location / SKU Details by the affected plan codes', () => {
    const href = countDetailsHref('/counts/locations', ['CNT1', 'A,B']);
    expect(href.startsWith('/counts/locations?')).toBe(true);
    expect(new URLSearchParams(href.split('?')[1]).get('f.planCode')).toBe('in:CNT1,A\\,B');
  });
});

describe('timeline event text', () => {
  it('job, entry and Update Inv. events read as one line each', () => {
    expect(
      jobEventText({
        kind: 'created',
        jobCode: 'Job1',
        tasks: 3,
        locations: 3,
        batchSize: 25,
        assignee: null,
      }),
    ).toBe('Count job Job1 created · 3 tasks across 3 locations · batch size 25 · job pool (unassigned)');
    expect(
      jobEventText({
        kind: 'recount',
        jobCode: 'Job2',
        tasks: 1,
        locations: 1,
        assignee: 'Ann',
        recountOf: ['A-1'],
      }),
    ).toBe('Recount job Job2 created · 1 task across 1 location · assigned to Ann · recounts A-1');
    expect(
      entryEventText({
        counted: 10,
        system: 12,
        buckets: 2,
        found: 0,
        damaged: 1,
        location: 'A-1',
        note: 'torn box',
      }),
    ).toBe('Counted 10 vs system 12 (−2) · at A-1 · 2 buckets · 1 damaged · note: torn box');
    expect(
      updateInvEventText({ lines: 2, postings: 3, reason: 'Cycle count', note: null, cancelledOpen: 1 }),
    ).toBe(
      'Inventory updated for 2 counted lines · 3 ledger postings · reason Cycle count · 1 open line cancelled',
    );
  });
  it('the timeline renders the stored event text, without the line prefix', () => {
    const parts = countChangeParts({
      type: 'Update',
      field: COUNT_EVENT_FIELD,
      fieldLabel: null,
      fromValue: null,
      toValue: 'Counted 1 vs system 1 (0)',
      message: 'A-1 -> Counted 1 vs system 1 (0)',
      lineLabel: null,
      parentEntityType: 'count_plan',
    } as never);
    expect(parts).toEqual({ label: 'A-1', text: 'Counted 1 vs system 1 (0)' });
  });
});

describe('timeline events are written by the commands', () => {
  it('Create Job, count submit, Create Recount and Update Inv. each leave an event', async () => {
    const p = await locationPlan('KS-R5-EVT');
    const jt = await jobType();
    const reasonId = (
      await w.db
        .insert(schema.lookupValues)
        .values({ type: 'adjustment_reason', name: 'Cycle count' })
        .returning()
    )[0].id;
    await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: jt,
      batchSize: 5,
      assigneeUserId: null,
    });
    expect(
      (await events(p.id)).some((e) =>
        /^Count job .+ created · 1 task across 1 location · batch size 5/.test(e.toValue ?? ''),
      ),
    ).toBe(true);

    const line = (await countSheet(w.db, auth.scope, p.id))[0];
    if (!line) throw new Error('sheet line');
    const bucket = line.buckets[0];
    if (!bucket) throw new Error('bucket');
    await submitSheetLine(w.db, w.ctx, auth, p.id, {
      lineId: line.lineId,
      entries: [{ inventoryId: bucket.inventoryId, countedQty: 10 }],
      note: 'two missing',
    });
    expect(
      (await events(p.id)).some(
        (e) =>
          /^Counted 10 vs system 12 \(−2\) · at .+ · 1 bucket · note: two missing$/.test(e.toValue ?? '') &&
          e.parentEntityId === p.id,
      ),
    ).toBe(true);

    const recount = await createRecounts(w.db, w.ctx, auth, [line.lineId]);
    expect(recount.failed).toEqual([]);
    expect((await events(p.id)).some((e) => /^Recount created in job /.test(e.toValue ?? ''))).toBe(true);
    expect((await events(p.id)).some((e) => /^Recount job .+ created/.test(e.toValue ?? ''))).toBe(true);

    const rl = (await countSheet(w.db, auth.scope, p.id))[0];
    if (!rl?.buckets[0]) throw new Error('recount line');
    await submitSheetLine(w.db, w.ctx, auth, p.id, {
      lineId: rl.lineId,
      entries: [{ inventoryId: rl.buckets[0].inventoryId, countedQty: 11 }],
      note: null,
    });
    expect(
      (await updateInventoryForLines(w.db, w.ctx, auth, [rl.lineId], reasonId, 'verified twice')).failed,
    ).toEqual([]);
    expect(
      (await events(p.id)).some(
        (e) =>
          e.toValue ===
          'Inventory updated for 1 counted line · 1 ledger posting · reason Cycle count · note: verified twice',
      ),
    ).toBe(true);
  });
});

describe('job counter integrity', () => {
  it('finds and repairs a count job whose counters disagree with its tasks', async () => {
    const p = await locationPlan('KS-R5-JOB');
    const { jobIds } = await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: await jobType(),
      batchSize: 5,
      assigneeUserId: null,
    });
    const jobId = jobIds[0];
    if (!jobId) throw new Error('job');
    expect(await findCountJobCounterDrift(w.db as never)).toEqual([]);
    await w.db.update(schema.tasks).set({ status: 'Completed' }).where(eq(schema.tasks.jobId, jobId));
    const drift = await findCountJobCounterDrift(w.db as never);
    expect(
      drift.map((d) => [d.expectedTaskCount, d.completedTaskCount, d.expectedCompletedTaskCount]),
    ).toEqual([[1, 0, 1]]);
    await repairCountJobCounterDrift(w.db, w.ctx);
    expect(await findCountJobCounterDrift(w.db as never)).toEqual([]);
    expect(
      (await w.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1))[0]
        ?.completedTaskCount,
    ).toBe(1);
  });
});

describe('one open count per location', () => {
  it('reports a location held by two open plans and the repair cancels the newer uncounted line', async () => {
    const a = await locationPlan('KS-R5-OLD');
    const b = await locationPlan('KS-R5-NEW', w.loc.storageB);
    // Legacy row from before the conflict rule: plan B also holds plan A's location.
    const legacy = (
      await w.db
        .insert(schema.countPlanLines)
        .values({ planId: b.id, locationId: w.loc.storageA, status: 'Pending', initialStockQty: 12 })
        .returning()
    )[0];
    const overlaps = await findOpenCountOverlaps(w.db as never);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.plans.map((p) => p.code)).toEqual(['KS-R5-OLD', 'KS-R5-NEW']);
    const res = await repairOpenCountOverlaps(w.db, w.ctx, async (ids) => {
      await cancelCountLines(w.db, w.ctx, auth, ids);
    });
    expect(res.cancelledLineIds).toEqual([legacy.id]);
    expect(await findOpenCountOverlaps(w.db as never)).toEqual([]);
    const kept = (
      await w.db
        .select()
        .from(schema.countPlanLines)
        .where(
          and(eq(schema.countPlanLines.planId, a.id), eq(schema.countPlanLines.locationId, w.loc.storageA)),
        )
        .limit(1)
    )[0];
    expect(kept?.status).toBe('Pending');
  });
});
