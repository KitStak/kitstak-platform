/**
 * Money and security fixes from the critic backlog (docs/programs/SPEC.md 4.3.3, 4.3.4, 8.3, 8.4):
 * signed Undo tokens for an output batch, lock order against a month close, time lock checks
 * inside the writing transaction, Pulse closed months for builds of plain projects that bill a
 * job, ledger locks judged by both postings, and build snapshots for comment automations. Runs in
 * a throwaway org on the program clock fixed at 2026-11-25 (America/Chicago).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from '../_shared';

const ready = await databaseReady(['pm.projects', 'pm.builds', 'pm.build_output', 'pm.program_ledger', 'pm.program_closes', 'pm.time_entries', 'core.record_links']);

const DAY = '2026-11-25';

describe.skipIf(!ready)('programs: undo tokens, lock order, time locks, Pulse locks and ledger postings', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let member: DomainContext;
  let programs: typeof import('./index');
  let time: typeof import('../time');
  let locksModule: typeof import('./locks');
  let pulse = false;
  const ids: Record<string, string> = {};
  const variant: Record<string, string> = {};

  const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await org.query<T>(text, values))[0]!;
  const programIdOf = async (key: string) => (await one<{ id: string }>(`select id::text as id from pm.projects where org_id = $1 and key = $2`, [org.orgId, key])).id;
  const todaysBuilds = async (programId: string) =>
    (await org.query<{ id: string }>(`select b.task_id::text as id from pm.builds b join pm.program_variants v on v.id = b.variant_id where b.program_id = $1 and b.build_date = $2 order by v.position`, [programId, DAY])).map((r) => r.id);

  /** Holds the program settings row `FOR UPDATE` and closes November in that transaction, as `closeMonth` does. */
  async function closeNovemberSlowly(programId: string) {
    const client = await org.pool.connect();
    await client.query('begin');
    await client.query('select program_id from pm.program_settings where program_id = $1 for update', [programId]);
    await client.query(
      `insert into pm.program_closes (org_id, program_id, month, total_cents, units, checklist, closed_by, closed_at) values ($1, $2, '2026-11-01', 0, 0, '{}'::jsonb, $3, now())`,
      [org.orgId, programId, owner.userId],
    );
    return {
      commit: async () => {
        await client.query('commit');
        client.release();
      },
    };
  }

  async function reopenNovember(programId: string): Promise<void> {
    await org.query(`update pm.program_closes set reopened_at = now(), reopened_by = $2, reopen_reason = 'test' where program_id = $1 and reopened_at is null`, [programId, owner.userId]);
  }

  /** Starts `run`, checks it waits for the settings lock, then commits the close and returns the outcome. */
  async function raceAgainstClose(programId: string, run: () => Promise<unknown>): Promise<unknown> {
    const close = await closeNovemberSlowly(programId);
    let settled = false;
    const pending = run().then(
      (value) => {
        settled = true;
        return { ok: true as const, value };
      },
      (error: unknown) => {
        settled = true;
        return { ok: false as const, error };
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    const waited = !settled;
    await close.commit();
    const outcome = await pending;
    expect(waited).toBe(true);
    return outcome;
  }

  /** A minimal ongoing per unit Pulse job with a dated price (only when Pulse is installed). */
  async function pulseJob(number: string, price: string): Promise<string> {
    const [site, client, type, job] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await org.query(`insert into pulse.sites (id, org_id, code, name, timezone) values ($1, $2, $3, 'Main', 'America/Chicago')`, [site, org.orgId, `S${number}`]);
    await org.query(`insert into pulse.clients (id, org_id, code, name) values ($1, $2, $3, 'Gripwell')`, [client, org.orgId, `C${number}`]);
    await org.query(`insert into pulse.job_types (id, org_id, code, name) values ($1, $2, $3, 'Kitting')`, [type, org.orgId, `T${number}`]);
    await org.query(
      `insert into pulse.jobs (id, org_id, number, name, client_id, job_type_id, site_id, kind, status, pricing_model, unit_label, unit_price) values ($1, $2, $3, 'Frames job', $4, $5, $6, 'ongoing', 'active', 'per_unit', 'kits', $7)`,
      [job, org.orgId, number, client, type, site, price],
    );
    await org.query(`insert into pulse.job_prices (org_id, job_id, effective_from, unit_price) values ($1, $2, '2026-01-01', $3)`, [org.orgId, job, price]);
    return job;
  }

  async function closeNovemberInPulse(): Promise<void> {
    await org.query(`insert into pulse.periods (org_id, period_month, status, closed_at) values ($1, '2026-11-01', 'closed', now())`, [org.orgId]);
    locksModule.resetPulseLockCache();
  }

  async function reopenPulse(): Promise<void> {
    await org.query(`delete from pulse.periods where org_id = $1`, [org.orgId]);
    locksModule.resetPulseLockCache();
  }

  beforeAll(async () => {
    programs = await import('./index');
    time = await import('../time');
    locksModule = await import('./locks');
    programs.setProgramClock(() => new Date('2026-11-25T15:00:00Z'));
    org = await createTestOrg('programs-safety');
    owner = await org.member('owner', 'Maya Owner');
    member = await org.member('member', 'Sam Member');
    await org.query(`insert into pm.org_calendar (org_id, timezone, working_days, holidays) values ($1, 'America/Chicago', '{1,2,3,4,5}', $2::jsonb)`, [org.orgId, JSON.stringify([{ date: '2026-11-26', name: 'Thanksgiving' }])]);
    const { createFixtureProgram } = await import('./fixture');
    for (const key of ['UNDO', 'LOCK', 'LEDG']) {
      await createFixtureProgram(owner, { key, startDate: DAY });
      ids[key] = await programIdOf(key);
    }
    for (const v of await org.query<{ id: string; key: string }>(`select id::text as id, key from pm.program_variants where program_id = $1`, [ids.UNDO])) variant[v.key] = v.id;
    const projectsDomain = await import('../projects');
    ids.FRM = (await projectsDomain.createProject(owner, { name: 'Frames', key: 'FRM' })).id;
    pulse = (await org.query<{ ok: boolean }>(`select to_regclass('pulse.jobs') is not null and to_regclass('pulse.periods') is not null as ok`))[0]?.ok === true;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    programs?.resetProgramClock();
    await org?.destroy();
  });

  // --- 1. Undo -------------------------------------------------------------------------------------

  it('refuses an undo token the server did not sign: forged ids, edited values, another sheet or another person', async () => {
    const [planned, other] = await todaysBuilds(ids.UNDO!);
    const logged = await programs.logOutput(owner, 'UNDO', { date: DAY, entries: [{ newBuild: { variantId: variant['XL-YE']! }, qty: '7' }, { buildId: other!, mode: 'add', qty: '3' }] });
    expect(logged.undo.sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const created = logged.createdBuildIds[0]!;
    // A planned build slipped into createdBuildIds: refused, and the planned build is untouched.
    await expect(programs.undoLogOutput(owner, 'UNDO', { ...logged.undo, createdBuildIds: [...logged.undo.createdBuildIds, planned!] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(programs.undoLogOutput(owner, 'UNDO', { ...logged.undo, createdBuildIds: [planned!] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Edited before values, a date moved to another day, or no signature at all.
    await expect(programs.undoLogOutput(owner, 'UNDO', { ...logged.undo, entries: logged.undo.entries.map((e) => ({ ...e, qty: '99.000' })) })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(programs.undoLogOutput(owner, 'UNDO', { ...logged.undo, date: '2026-11-24' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(programs.undoLogOutput(owner, 'UNDO', { ...logged.undo, sig: '' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The same token on another program's sheet, or from another person who may log output there.
    await expect(programs.undoLogOutput(owner, 'LOCK', logged.undo)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(programs.undoLogOutput(member, 'UNDO', logged.undo)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const untouched = await one<{ deleted: boolean; live: number }>(
      `select t.deleted_at is not null as deleted, (select count(*)::int from pm.build_output o where o.build_id = t.id and o.deleted_at is null) as live from pm.tasks t where t.id = $1`,
      [planned],
    );
    expect(untouched).toEqual({ deleted: false, live: 0 });
    expect((await one<{ qty: string }>(`select qty::text from pm.build_output where build_id = $1 and deleted_at is null`, [other])).qty).toBe('3.000');
    expect((await one<{ deleted: boolean }>(`select deleted_at is not null as deleted from pm.tasks where id = $1`, [created])).deleted).toBe(false);
  });

  it('refuses an undo after the window, and a second use of the same token', async () => {
    const [, , build] = await todaysBuilds(ids.UNDO!);
    const logged = await programs.logOutput(owner, 'UNDO', { date: DAY, entries: [{ buildId: build!, mode: 'add', qty: '4' }] });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + programs.UNDO_WINDOW_MS + 60_000);
    try {
      await expect(programs.undoLogOutput(owner, 'UNDO', logged.undo)).rejects.toMatchObject({ code: 'VALIDATION', message: 'Undo has expired. Change the numbers on the sheet instead.' });
    } finally {
      clock.mockRestore();
    }
    // A token issued later than now cannot be forged either: issuedAt is signed.
    await expect(programs.undoLogOutput(owner, 'UNDO', { ...logged.undo, issuedAt: Date.now() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await programs.undoLogOutput(owner, 'UNDO', logged.undo);
    expect(await org.query(`select 1 from pm.build_output where build_id = $1 and deleted_at is null`, [build])).toEqual([]);
    // Replay: the rows are no longer as the batch left them.
    await expect(programs.undoLogOutput(owner, 'UNDO', logged.undo)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('undoes only what this batch did: a later add by someone else blocks it, other days stay', async () => {
    const [, , , build] = await todaysBuilds(ids.UNDO!);
    await programs.logOutput(owner, 'UNDO', { date: '2026-11-24', entries: [{ buildId: build!, mode: 'add', qty: '6' }] });
    const logged = await programs.logOutput(owner, 'UNDO', { date: DAY, entries: [{ buildId: build!, mode: 'add', qty: '5' }] });
    await programs.logOutput(member, 'UNDO', { date: DAY, entries: [{ buildId: build!, mode: 'add', qty: '2' }] });
    await expect(programs.undoLogOutput(owner, 'UNDO', logged.undo)).rejects.toMatchObject({ code: 'CONFLICT' });
    const days = await org.query<{ work_date: string; qty: string }>(`select work_date::text, qty::text from pm.build_output where build_id = $1 and deleted_at is null order by work_date`, [build]);
    expect(days).toEqual([
      { work_date: '2026-11-24', qty: '6.000' },
      { work_date: DAY, qty: '7.000' },
    ]);
    // The member's own batch undoes cleanly, back to the owner's 5; the other day is untouched.
    const mine = await programs.logOutput(member, 'UNDO', { date: DAY, entries: [{ buildId: build!, mode: 'add', qty: '1' }] });
    await programs.undoLogOutput(member, 'UNDO', mine.undo);
    const after = await org.query<{ work_date: string; qty: string }>(`select work_date::text, qty::text from pm.build_output where build_id = $1 and deleted_at is null order by work_date`, [build]);
    expect(after).toEqual([
      { work_date: '2026-11-24', qty: '6.000' },
      { work_date: DAY, qty: '7.000' },
    ]);
  });

  // --- 2. Lock order ---------------------------------------------------------------------------------

  it('takes the settings lock before it reads the locks, so a month closed meanwhile refuses the batch', async () => {
    const [build] = await todaysBuilds(ids.LOCK!);
    try {
      const outcome = (await raceAgainstClose(ids.LOCK!, () => programs.logOutput(owner, 'LOCK', { date: DAY, entries: [{ buildId: build!, mode: 'add', qty: '5' }] }))) as { ok: boolean; error?: unknown };
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toMatchObject({ code: 'LOCKED' });
      expect(await org.query(`select 1 from pm.build_output where build_id = $1 and deleted_at is null`, [build])).toEqual([]);
    } finally {
      await reopenNovember(ids.LOCK!);
    }
  });

  // --- 3. Time -----------------------------------------------------------------------------------

  it('checks time locks inside the writing transaction, after the settings lock', async () => {
    const [, build] = await todaysBuilds(ids.LOCK!);
    const entry = await time.addManualTime(owner, { taskId: build!, minutes: 30, date: '2026-11-24' });
    try {
      const add = (await raceAgainstClose(ids.LOCK!, () => time.addManualTime(owner, { taskId: build!, minutes: 45, date: '2026-11-24' }))) as { ok: boolean; error?: unknown };
      expect(add.ok).toBe(false);
      expect(add.error).toMatchObject({ code: 'LOCKED' });
    } finally {
      await reopenNovember(ids.LOCK!);
    }
    try {
      const update = (await raceAgainstClose(ids.LOCK!, () => time.updateTimeEntry(owner, entry.id, { minutes: 90 }))) as { ok: boolean; error?: unknown };
      expect(update.error).toMatchObject({ code: 'LOCKED' });
      await expect(time.deleteTimeEntry(owner, entry.id)).rejects.toMatchObject({ code: 'LOCKED' });
    } finally {
      await reopenNovember(ids.LOCK!);
    }
    try {
      await time.startTimer(owner, build!);
      const stop = (await raceAgainstClose(ids.LOCK!, () => time.stopTimer(owner))) as { ok: boolean; error?: unknown };
      expect(stop.error).toMatchObject({ code: 'LOCKED' });
    } finally {
      await reopenNovember(ids.LOCK!);
    }
    await time.stopTimer(owner);
    const rows = await org.query<{ minutes: number | null; running: boolean }>(`select duration_minutes as minutes, ended_at is null as running from pm.time_entries where task_id = $1 and deleted_at is null order by started_at`, [build]);
    expect(rows.some((r) => r.minutes === 30)).toBe(true);
    expect(rows.some((r) => r.minutes === 45 || r.minutes === 90)).toBe(false);
    expect(rows.every((r) => !r.running)).toBe(true);
  });

  // --- 4. Pulse closed months for builds of a plain project ---------------------------------------

  it('freezes a plain project build that bills a Pulse job when Pulse closes the month', async () => {
    if (!pulse) return;
    const job = await pulseJob('J-7001', '3.2500');
    const billed = await programs.createBuild(owner, 'FRM', { buildDate: DAY, plannedQty: '10', title: 'Billed frames' });
    const plain = await programs.createBuild(owner, 'FRM', { buildDate: DAY, plannedQty: '10', title: 'Shop frames' });
    await programs.linkPulseJob(owner, { buildId: billed.id }, job);
    await programs.logOutput(owner, 'FRM', { date: DAY, entries: [{ buildId: billed.id, mode: 'add', qty: '4' }] });
    const entry = await time.addManualTime(owner, { taskId: billed.id, minutes: 20, date: '2026-11-24' });
    const output = await one<{ id: string; version: number; posting: string }>(`select id::text, version, posting from pm.build_output where build_id = $1 and deleted_at is null`, [billed.id]);
    expect(output.posting).toBe('build_job');
    await closeNovemberInPulse();
    try {
      await expect(programs.logOutput(owner, 'FRM', { date: DAY, entries: [{ buildId: billed.id, mode: 'add', qty: '1' }] })).rejects.toMatchObject({ code: 'LOCKED', message: 'November is closed in Pulse. Ask a Pulse admin to reopen it.' });
      await expect(programs.deleteOutput(owner, output.id, Number(output.version))).rejects.toMatchObject({ code: 'LOCKED' });
      await expect(time.addManualTime(owner, { taskId: billed.id, minutes: 15, date: '2026-11-24' })).rejects.toMatchObject({ code: 'LOCKED' });
      await expect(time.updateTimeEntry(owner, entry.id, { minutes: 25 })).rejects.toMatchObject({ code: 'LOCKED' });
      await expect(time.deleteTimeEntry(owner, entry.id)).rejects.toMatchObject({ code: 'LOCKED' });
      const tasksDomain = await import('../tasks');
      await expect(tasksDomain.deleteTasks(owner, [billed.id])).rejects.toMatchObject({ code: 'LOCKED' });
      // A build that bills no job is not frozen by Pulse.
      await programs.logOutput(owner, 'FRM', { date: DAY, entries: [{ buildId: plain.id, mode: 'add', qty: '2' }] });
      const sheet = await programs.getOutputSheet(owner, 'FRM', DAY);
      expect(sheet.locked).toBe(true);
      expect(sheet.lockReason).toBe('November is closed in Pulse. Ask a Pulse admin to reopen it.');
      expect((await one<{ qty: string }>(`select qty::text from pm.build_output where build_id = $1 and deleted_at is null`, [billed.id])).qty).toBe('4.000');
    } finally {
      await reopenPulse();
    }
    // Open again: the same writes go through.
    await programs.logOutput(owner, 'FRM', { date: DAY, entries: [{ buildId: billed.id, mode: 'add', qty: '1' }] });
    await time.deleteTimeEntry(owner, entry.id);
  });

  // --- 5. Ledger postings --------------------------------------------------------------------------

  it('keeps a month that went to a Pulse job and that Pulse closed frozen as a whole after the job is unlinked', async () => {
    if (!pulse) return;
    const { refreshLedgerFor } = await import('./ledger');
    const { db } = await import('@/server/db');
    const programId = ids.LEDG!;
    const live = () => org.query<{ ref: string; posting: string; cents: string }>(`select ref, posting, cents::text from pm.program_ledger where program_id = $1 and month = '2026-11-01' and deleted_at is null order by ref`, [programId]);
    const before = await live();
    expect(before.length).toBeGreaterThan(0);
    // November was posted to a job (the job is gone now, so fees would post to the program), and
    // one of its fees is missing: the engine would add it back under the current posting.
    await org.query(`update pm.program_ledger set posting = 'program_job', pulse_job_id = $2 where program_id = $1 and month = '2026-11-01' and deleted_at is null`, [programId, randomUUID()]);
    const dropped = before[0]!.ref;
    await org.query(`update pm.program_ledger set deleted_at = now() where program_id = $1 and ref = $2 and deleted_at is null`, [programId, dropped]);
    const frozen = await live();
    await closeNovemberInPulse();
    try {
      const result = await db.transaction((tx) => refreshLedgerFor(tx, owner, { programIds: [programId], months: ['2026-11'] }));
      expect(result).toMatchObject({ written: 0, removed: 0 });
      expect(result.skippedLocked).toBeGreaterThan(0);
      expect(await live()).toEqual(frozen);
      expect(frozen.some((row) => row.ref === dropped)).toBe(false);
    } finally {
      await reopenPulse();
    }
    // Pulse open again: the month is rewritten under the current posting, the missing fee included.
    await db.transaction((tx) => refreshLedgerFor(tx, owner, { programIds: [programId], months: ['2026-11'] }));
    const rewritten = await live();
    expect(rewritten.map((row) => row.ref)).toEqual(before.map((row) => row.ref));
    expect(rewritten.every((row) => row.posting === 'program')).toBe(true);
  });

  // --- 6. Build snapshots for automations ------------------------------------------------------------

  it('passes kind and variant to the automation engine, so a workspace comment rule skips builds', async () => {
    const { engineTaskFromSummary } = await import('../automation-sweep');
    const { selectTaskSummary } = await import('../task-queries');
    const [build] = await todaysBuilds(ids.LEDG!);
    const summary = await selectTaskSummary(build!);
    const snapshot = engineTaskFromSummary(summary!);
    expect(snapshot.kind).toBe('build');
    expect(snapshot.variantId).toBe(summary!.build?.variantId);
    expect(snapshot.variantId).toBeTruthy();
    const { createAutomation } = await import('../automations');
    const { addComment } = await import('../comments');
    const tasksDomain = await import('../tasks');
    const task = await tasksDomain.createTask(owner, { projectId: ids.FRM!, title: 'Order frame steel' });
    const rule = await createAutomation(owner, { projectId: null, name: 'Tell the owner about comments', trigger: { type: 'comment_added' }, actions: [{ type: 'notify', target: 'project_owner' }] });
    try {
      await addComment(member, { taskId: build!, body: 'Short two boxes of liners.' });
      await addComment(member, { taskId: task.id, body: 'Steel comes Friday.' });
      const runs = await org.query<{ task_id: string }>(`select task_id::text from pm.automation_runs where automation_id = $1`, [rule.id]);
      expect(runs.some((r) => r.task_id === task.id)).toBe(true);
      expect(runs.some((r) => r.task_id === build)).toBe(false);
    } finally {
      await org.query(`update pm.automations set enabled = false where id = $1`, [rule.id]);
    }
  });
});
