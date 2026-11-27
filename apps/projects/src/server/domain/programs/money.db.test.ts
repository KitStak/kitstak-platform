/**
 * Output, ledger, prices, locks and close (docs/programs/SPEC.md 9.2) against the live database,
 * in a throwaway org, on the program clock fixed at 2026-11-25 (America/Chicago).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from '../_shared';

const ready = await databaseReady(['pm.projects', 'pm.builds', 'pm.build_output', 'pm.program_ledger', 'core.record_links']);

describe.skipIf(!ready)('programs: output, ledger, prices, locks and close', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let member: DomainContext;
  let programs: typeof import('./index');
  let tasksDomain: typeof import('../tasks');
  let structure: typeof import('../structure');
  let time: typeof import('../time');
  let activity: typeof import('../activity');
  let engine: typeof import('@kitstak/programs-engine');
  let programId = '';
  const variant: Record<string, string> = {};
  const status: Record<string, string> = {};

  const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await org.query<T>(text, values))[0]!;
  const ledger = async (kind?: string) =>
    org.query<{ ref: string; kind: string; cents: string; charge_date: string }>(
      `select ref, kind, cents::text, charge_date::text from pm.program_ledger where program_id = $1 and deleted_at is null ${kind ? 'and kind = $2' : ''} order by ref`,
      kind ? [programId, kind] : [programId],
    );
  const build = async (variantKey: string, date: string, qty = '100') => programs.createBuild(owner, 'MONY', { variantId: variant[variantKey], buildDate: date, plannedQty: qty });

  beforeAll(async () => {
    programs = await import('./index');
    tasksDomain = await import('../tasks');
    structure = await import('../structure');
    time = await import('../time');
    activity = await import('../activity');
    engine = await import('@kitstak/programs-engine');
    programs.setProgramClock(() => new Date('2026-11-25T15:00:00Z'));
    org = await createTestOrg('programs-money');
    owner = await org.member('owner', 'Maya Owner');
    member = await org.member('member', 'Sam Member');
    const { fixturePayload } = await import('./fixture');
    const payload = fixturePayload({ key: 'MONY', name: 'Money program', ownerId: owner.userId, startDate: '2026-09-01', withSchedule: false });
    await programs.createProgram(owner, payload);
    const row = await one<{ id: string }>(`select id from pm.projects where org_id = $1 and key = 'MONY'`, [org.orgId]);
    programId = row.id;
    for (const v of await org.query<{ id: string; key: string }>(`select id, key from pm.program_variants where program_id = $1`, [programId])) variant[v.key] = v.id;
    for (const s of await org.query<{ id: string; category: string }>(`select id, category from pm.statuses where project_id = $1 order by position collate "C"`, [programId])) status[s.category] ??= s.id;
  });

  afterAll(async () => {
    programs?.resetProgramClock();
    await org?.destroy();
  });

  it('logs output in add and set modes with a concrete price snapshot equal to the engine', async () => {
    const b = await build('S-BR', '2026-11-25');
    const first = await programs.logOutput(owner, 'MONY', { date: '2026-11-25', entries: [{ buildId: b.id, mode: 'add', qty: '40' }] });
    expect(first.sheet.rows.find((r) => r.buildId === b.id)?.builtToday).toBe('40.000');
    await programs.logOutput(owner, 'MONY', { date: '2026-11-25', entries: [{ buildId: b.id, mode: 'add', qty: '10' }] });
    const row = await one<{ qty: string; unit_price: string; price_source: string; revenue_cents: string; posting: string; version: number; id: string }>(
      `select id, qty::text, unit_price::text, price_source, revenue_cents::text, posting, version from pm.build_output where build_id = $1 and deleted_at is null`,
      [b.id],
    );
    expect(row.qty).toBe('50.000');
    expect(row.unit_price).toBe('1.9500');
    expect(row.price_source).toBe('card');
    expect(row.revenue_cents).toBe(engine.mulQuantityPrice('50', '1.95').toString());
    expect(row.posting).toBe('program');
    // Auto start moved it to an in progress status.
    const task = await one<{ category: string }>(`select s.category from pm.tasks t join pm.statuses s on s.id = t.status_id where t.id = $1`, [b.id]);
    expect(task.category).toBe('in_progress');
    // Set mode needs the version.
    await expect(programs.logOutput(owner, 'MONY', { date: '2026-11-25', entries: [{ buildId: b.id, mode: 'set', qty: '60', expectedVersion: Number(row.version) + 5 }] })).rejects.toThrow('Someone else changed this. Reload to see their change.');
    await programs.logOutput(owner, 'MONY', { date: '2026-11-25', entries: [{ buildId: b.id, mode: 'set', qty: '60', expectedVersion: Number(row.version) }] });
    const built = await one<{ built_qty: string }>(`select built_qty::text from pm.builds where task_id = $1`, [b.id]);
    expect(built.built_qty).toBe('60.000');
  });

  it('counts two concurrent adds on the first log of a day and never deadlocks on big batches', async () => {
    const b = await build('M-BR', '2026-11-24');
    await Promise.all([
      programs.logOutput(owner, 'MONY', { date: '2026-11-24', entries: [{ buildId: b.id, mode: 'add', qty: '5' }] }),
      programs.logOutput(member, 'MONY', { date: '2026-11-24', entries: [{ buildId: b.id, mode: 'add', qty: '7' }] }),
    ]);
    const row = await one<{ qty: string }>(`select qty::text from pm.build_output where build_id = $1 and deleted_at is null`, [b.id]);
    expect(row.qty).toBe('12.000');
    const created = await programs.createBuilds(owner, 'MONY', Array.from({ length: 50 }, (_, i) => ({ variantId: variant[i % 2 ? 'L-BR' : 'L-YE']!, buildDate: '2026-11-23', plannedQty: '10' })));
    const ids = created.createdIds;
    expect(ids.length).toBe(50);
    await Promise.all([
      programs.logOutput(owner, 'MONY', { date: '2026-11-23', entries: ids.map((id) => ({ buildId: id, mode: 'add' as const, qty: '1' })) }),
      programs.logOutput(member, 'MONY', { date: '2026-11-23', entries: [...ids].reverse().map((id) => ({ buildId: id, mode: 'add' as const, qty: '1' })) }),
    ]);
    const total = await one<{ qty: string }>(`select sum(qty)::text as qty from pm.build_output where work_date = '2026-11-23' and program_id = $1 and deleted_at is null`, [programId]);
    expect(Number(total.qty)).toBe(100);
  });

  it('adds a row (unplanned), marks done, closes short and moves the rest', async () => {
    const result = await programs.logOutput(owner, 'MONY', { date: '2026-11-25', entries: [{ newBuild: { variantId: variant['XL-BR']! }, qty: '12' }] });
    expect(result.createdBuildIds.length).toBe(1);
    const unplanned = await one<{ unplanned: boolean; planned_qty: string; planned_from: string; finished_on: string | null }>(`select unplanned, planned_qty::text, planned_from, finished_on::text from pm.builds where task_id = $1`, [result.createdBuildIds[0]]);
    expect(unplanned).toMatchObject({ unplanned: true, planned_qty: '12.000', planned_from: 'unplanned', finished_on: '2026-11-25' });
    const xlPrice = await one<{ unit_price: string }>(`select unit_price::text from pm.build_output where build_id = $1`, [result.createdBuildIds[0]]);
    expect(xlPrice.unit_price).toBe('2.2000');
    const short = await build('M-YE', '2026-11-25', '50');
    const moved = await build('S-YE', '2026-11-25', '50');
    await programs.logOutput(owner, 'MONY', {
      date: '2026-11-25',
      entries: [
        { buildId: short.id, mode: 'add', qty: '30' },
        { buildId: moved.id, mode: 'add', qty: '20' },
      ],
      endOfDay: { decisions: [{ buildId: short.id, action: 'close_short', reason: 'Ran out of bags' }, { buildId: moved.id, action: 'move_rest', toDate: '2026-11-27' }] },
    });
    const s = await one<{ closed_short: boolean; finished_on: string | null }>(`select closed_short, finished_on::text from pm.builds where task_id = $1`, [short.id]);
    expect(s).toEqual({ closed_short: true, finished_on: '2026-11-25' });
    const split = await one<{ planned_qty: string; build_date: string; planned_from: string }>(`select planned_qty::text, build_date::text, planned_from from pm.builds where split_from_id = $1`, [moved.id]);
    expect(split).toEqual({ planned_qty: '30.000', build_date: '2026-11-27', planned_from: 'split' });
  });

  it('keeps the batch fee in the ledger as builds finish, leave done, refinish and cancel', async () => {
    const card = await programs.createDraftVersion(owner, 'MONY', { from: 'current', effectiveFrom: '2026-11-01' });
    const lines = [...card.lines.filter((l) => !l.ruleId).map((l) => ({ ...l, amountCents: l.amountCents })), { kind: 'per_order' as const, variantId: null, amountCents: '1500', prorate: true, chargeWhilePaused: true }, { kind: 'per_hour' as const, variantId: null, rateCents: 4500, prorate: true, chargeWhilePaused: true }];
    const updated = await programs.updateDraftVersion(owner, card.id, { lines: lines as never }, card.version);
    await programs.publishVersion(owner, card.id, updated.version);
    const b = await build('L-YE', '2026-11-20', '10');
    await programs.logOutput(owner, 'MONY', { date: '2026-11-20', entries: [{ buildId: b.id, mode: 'add', qty: '10' }] });
    // Auto done when full: the batch fee is in the ledger in the same transaction.
    let fees = await ledger('per_order');
    expect(fees.find((f) => f.ref.endsWith(b.id))?.cents).toBe('1500');
    expect(fees.find((f) => f.ref.endsWith(b.id))?.charge_date).toBe('2026-11-25');
    // Leaving done in an open month removes it.
    const task = await one<{ id: string }>(`select id from pm.tasks where id = $1`, [b.id]);
    await tasksDomain.updateTask(owner, task.id, { statusId: status.in_progress });
    fees = await ledger('per_order');
    expect(fees.some((f) => f.ref.endsWith(b.id))).toBe(false);
    // Re finishing keeps the first finish date.
    await tasksDomain.updateTask(owner, task.id, { statusId: status.done });
    const fin = await one<{ first_finished_on: string; finished_on: string }>(`select first_finished_on::text, finished_on::text from pm.builds where task_id = $1`, [b.id]);
    expect(fin).toEqual({ first_finished_on: '2026-11-25', finished_on: '2026-11-25' });
    expect((await ledger('per_order')).some((f) => f.ref.endsWith(b.id))).toBe(true);
    // A cancelled build keeps its per unit revenue and has no batch fee.
    await programs.cancelBuilds(owner, [b.id]);
    expect((await ledger('per_order')).some((f) => f.ref.endsWith(b.id))).toBe(false);
    const kept = await one<{ revenue_cents: string }>(`select revenue_cents::text from pm.build_output where build_id = $1 and deleted_at is null`, [b.id]);
    expect(kept.revenue_cents).toBe('1950');
  });

  it('follows a status category change in structure.ts', async () => {
    const b = await build('XL-YE', '2026-11-19', '5');
    await programs.logOutput(owner, 'MONY', { date: '2026-11-19', entries: [{ buildId: b.id, mode: 'add', qty: '5', markDone: true }] });
    expect((await ledger('per_order')).some((f) => f.ref.endsWith(b.id))).toBe(true);
    // A new "Shipped" status in done, then made in progress, takes the build out of done.
    const shipped = await structure.createStatus(owner, programId, { name: 'Shipped', category: 'done' });
    await tasksDomain.updateTask(owner, b.id, { statusId: shipped.id });
    expect((await ledger('per_order')).some((f) => f.ref.endsWith(b.id))).toBe(true);
    await structure.updateStatus(owner, shipped.id, { category: 'in_progress' });
    expect((await ledger('per_order')).some((f) => f.ref.endsWith(b.id))).toBe(false);
    await structure.updateStatus(owner, shipped.id, { category: 'done' });
    expect((await ledger('per_order')).some((f) => f.ref.endsWith(b.id))).toBe(true);
  });

  it('posts per hour fees from time and setup fees and adjustments', async () => {
    const b = await build('S-BR', '2026-11-18', '10');
    await time.addManualTime(owner, { taskId: b.id, minutes: 90, date: '2026-11-18', billable: true });
    const hours = await ledger('per_hour');
    expect(hours.find((h) => h.ref.endsWith('2026-11-18'))?.cents).toBe('6750');
    const adj = await programs.addOneTimeCharge(owner, 'MONY', { kind: 'adjustment', chargeOn: '2026-11-10', amountCents: '-2500', label: 'Credit for late bags', reason: 'Bags came late', countsTowardMinimum: true });
    expect((await ledger('adjustment')).find((r) => r.ref.endsWith(adj.id))?.cents).toBe('-2500');
    expect((await ledger('setup')).length).toBe(1);
  });

  it('publishes a future version, then a past one that only reprices open rows', async () => {
    const future = await programs.createDraftVersion(owner, 'MONY', { from: 'current', effectiveFrom: '2026-12-01' });
    const card = future.lines.filter((l) => !l.ruleId).map((l) => (l.kind === 'per_unit' && l.variantId === null ? { ...l, unitPrice: '2.0000' } : l));
    const fu = await programs.updateDraftVersion(owner, future.id, { lines: card as never }, future.version);
    const published = await programs.publishVersion(owner, future.id, fu.version);
    expect(published.repricedRows).toBe(0);
    // Scheduled back to draft and republished.
    await programs.unpublishVersion(owner, future.id);
    const draft = await programs.getCardVersion(owner, future.id);
    expect(draft.status).toBe('draft');
    const again = await programs.publishVersion(owner, future.id, draft.version);
    expect(again.number).toBe(published.number);
    // Same day fold: a new version on Dec 1 replaces the one with no stamped rows.
    const fold = await programs.createDraftVersion(owner, 'MONY', { from: 'current', effectiveFrom: '2026-12-01' });
    await programs.publishVersion(owner, fold.id, fold.version);
    const dec1 = await org.query(`select id from pm.price_card_versions where program_id = $1 and status = 'published' and effective_from = '2026-12-01' and deleted_at is null`, [programId]);
    expect(dec1.length).toBe(1);
    // Past version from Nov 20 at $2.10: open rows on or after Nov 20 change, earlier rows keep theirs.
    const early = await build('S-YE', '2026-11-17', '10');
    await programs.logOutput(owner, 'MONY', { date: '2026-11-17', entries: [{ buildId: early.id, mode: 'add', qty: '3' }] });
    const past = await programs.createDraftVersion(owner, 'MONY', { from: 'current', effectiveFrom: '2026-11-20' });
    const pastLines = past.lines.filter((l) => !l.ruleId).map((l) => (l.kind === 'per_unit' && l.variantId === null ? { ...l, unitPrice: '2.1000' } : l));
    const pu = await programs.updateDraftVersion(owner, past.id, { lines: pastLines as never }, past.version);
    const result = await programs.publishVersion(owner, past.id, pu.version);
    expect(result.repricedRows).toBeGreaterThan(0);
    const before = await org.query<{ unit_price: string }>(`select distinct unit_price::text from pm.build_output where program_id = $1 and work_date < '2026-11-20' and price_source = 'card' and deleted_at is null`, [programId]);
    expect(before.map((r) => r.unit_price)).toEqual(['1.9500']);
    const after = await org.query<{ unit_price: string }>(`select distinct unit_price::text from pm.build_output where program_id = $1 and work_date >= '2026-11-20' and price_source = 'card' and deleted_at is null`, [programId]);
    expect(after.map((r) => r.unit_price)).toEqual(['2.1000']);
  });

  it('gathers three variant rate edits into one pending draft, and review sends it back', async () => {
    const a = await programs.setVariantRate(owner, variant['S-BR']!, { unitPrice: '2.05', startsOn: '2026-11-26' });
    const b = await programs.setVariantRate(owner, variant['M-BR']!, { unitPrice: '2.06', startsOn: '2026-11-26' });
    const c = await programs.setVariantRate(owner, variant['L-BR']!, { unitPrice: '2.07', startsOn: '2026-11-26' });
    expect(new Set([a.versionId, b.versionId, c.versionId]).size).toBe(1);
    expect(c.pendingCount).toBe(3);
    await programs.requestReview(owner, c.versionId);
    expect((await programs.getCardVersion(owner, c.versionId)).reviewStatus).toBe('waiting');
    await programs.sendBack(owner, c.versionId, 'Use the deal prices');
    const sent = await programs.getCardVersion(owner, c.versionId);
    expect(sent.reviewStatus).toBe('sent_back');
    expect(sent.reviewNote).toBe('Use the deal prices');
  });

  it('closes months in order with a lock that refuses edits, and reopens only the latest', async () => {
    const sep = await build('S-BR', '2026-09-15', '10');
    await programs.logOutput(owner, 'MONY', { date: '2026-09-15', entries: [{ buildId: sep.id, mode: 'add', qty: '10' }] });
    const oct = await build('S-BR', '2026-10-15', '10');
    await programs.logOutput(owner, 'MONY', { date: '2026-10-15', entries: [{ buildId: oct.id, mode: 'add', qty: '10' }] });
    await expect(programs.closeMonth(owner, 'MONY', '2026-10')).rejects.toThrow('Close September first.');
    const closedSep = await programs.closeMonth(owner, 'MONY', '2026-09');
    expect(closedSep.lockedThrough).toBe('2026-09-30');
    const closedOct = await programs.closeMonth(owner, 'MONY', '2026-10');
    expect(closedOct.lockedThrough).toBe('2026-10-31');
    // The minimum top up was posted for both months before they closed.
    expect((await ledger('minimum_top_up')).map((r) => r.charge_date)).toEqual(['2026-09-30', '2026-10-31']);
    await expect(programs.logOutput(owner, 'MONY', { date: '2026-10-15', entries: [{ buildId: oct.id, mode: 'add', qty: '1' }] })).rejects.toThrow('October is closed for MONY. An owner can reopen it.');
    await expect(programs.addOneTimeCharge(owner, 'MONY', { kind: 'adjustment', chargeOn: '2026-10-02', amountCents: '100', label: 'Late fix', reason: 'Missed a pallet' })).rejects.toThrow('October is closed for MONY. An owner can reopen it.');
    await expect(time.addManualTime(owner, { taskId: oct.id, minutes: 30, date: '2026-10-15' })).rejects.toThrow('October is closed for MONY. An owner can reopen it.');
    // A timer started on a day that closed while it ran cannot write its time onto that day.
    const [running] = await org.query<{ id: string }>(
      `insert into pm.time_entries (org_id, project_id, task_id, user_id, started_at, billable, source) values ($1, $2, $3, $4, '2026-10-15T16:00:00Z', true, 'timer') returning id::text as id`,
      [org.orgId, programId, oct.id, owner.userId],
    );
    await expect(time.stopTimer(owner)).rejects.toThrow('October is closed for MONY. An owner can reopen it.');
    expect((await org.query<{ ended: boolean }>(`select ended_at is not null as ended from pm.time_entries where id = $1`, [running!.id]))[0]!.ended).toBe(false);
    await org.query(`update pm.time_entries set deleted_at = now() where id = $1`, [running!.id]);
    await expect(tasksDomain.deleteTasks(owner, [oct.id])).rejects.toThrow('This build has output in a closed month. Cancel it instead.');
    await expect(programs.reopenMonth(owner, 'MONY', '2026-09', 'Fix')).rejects.toThrow('Only the latest closed month can be reopened.');
    // Set membership: reopen October, then September; close October again: September is open.
    await programs.reopenMonth(owner, 'MONY', '2026-10', 'Recount');
    await programs.reopenMonth(owner, 'MONY', '2026-09', 'Recount');
    await org.query(`insert into pm.program_closes (org_id, program_id, month, total_cents, units, checklist, closed_by, closed_at) values ($1, $2, '2026-10-01', 0, 0, '{}'::jsonb, $3, now())`, [org.orgId, programId, owner.userId]);
    const locks = await programs.programLocks(owner, { id: programId, key: 'MONY' });
    expect(programs.isLocked(locks, '2026-09-15', { goesToJob: false })).toBe(false);
    expect(programs.isLocked(locks, '2026-10-15', { goesToJob: false })).toBe(true);
    await programs.logOutput(owner, 'MONY', { date: '2026-09-15', entries: [{ buildId: sep.id, mode: 'add', qty: '1' }] });
  });

  it('refuses days that go to a Pulse job when the Pulse month is closed', async () => {
    const hasPulse = (await org.query<{ ok: boolean }>(`select to_regclass('pulse.periods') is not null as ok`))[0]?.ok;
    if (!hasPulse) return;
    await org.query(`insert into pulse.periods (org_id, period_month, status, closed_at) values ($1, '2026-08-01', 'closed', now())`, [org.orgId]);
    const { resetPulseLockCache } = await import('./locks');
    resetPulseLockCache();
    const locks = await programs.programLocks(owner, { id: programId, key: 'MONY' });
    expect(locks.pulseClosed).toContain('2026-08');
    expect(programs.isLocked(locks, '2026-08-10', { goesToJob: true })).toBe(true);
    expect(programs.isLocked(locks, '2026-08-10', { goesToJob: false })).toBe(false);
    expect(() => programs.assertOpen(locks, '2026-08-10', { goesToJob: true })).toThrow('August is closed in Pulse. Ask a Pulse admin to reopen it.');
  });

  it('deletes a build with its open output and restores only open rows', async () => {
    const b = await build('M-YE', '2026-11-16', '10');
    await programs.logOutput(owner, 'MONY', { date: '2026-11-16', entries: [{ buildId: b.id, mode: 'add', qty: '4' }] });
    await tasksDomain.deleteTasks(owner, [b.id]);
    expect((await org.query(`select 1 from pm.build_output where build_id = $1 and deleted_at is null`, [b.id])).length).toBe(0);
    await tasksDomain.restoreTasks(owner, [b.id]);
    expect((await org.query(`select 1 from pm.build_output where build_id = $1 and deleted_at is null`, [b.id])).length).toBe(1);
  });

  it('strips money from activity for an implicit org member', async () => {
    const page = await activity.listProjectActivity(member, programId, { verbs: ['build.output_logged'] });
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) expect(JSON.stringify(item.after)).not.toContain('money');
    const ownerPage = await activity.listProjectActivity(owner, programId, { verbs: ['build.output_logged'] });
    expect(JSON.stringify(ownerPage.items[0]?.after)).toContain('money');
  });

  it('keeps the stored ledger equal to the engine for the current month', async () => {
    const summary = await programs.getProgramSummary(owner, 'MONY', { month: '2026-11' });
    const inputs = await (await import('@kitstak/db/programs')).loadProgramMonthInputs((await import('@/server/db')).db as never, org.orgId, programId, '2026-11');
    const result = engine.monthCharges({ ...inputs, asOf: '2026-11-25' });
    expect(summary.result.totalCents).toBe(result.totalCents.toString());
  });
});
