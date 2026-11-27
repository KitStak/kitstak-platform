/**
 * "Move the rest" for one and many builds, its undo, and Done with the charge choice
 * (docs/programs/SPEC.md 4.3.5, 5.8, 5.9), in a throwaway org on the program clock fixed at
 * 2026-11-25.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from '../_shared';

const ready = await databaseReady(['pm.projects', 'pm.builds', 'pm.build_output', 'pm.program_ledger']);

describe.skipIf(!ready)('programs: move the rest, undo and the Done charge choice', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let programs: typeof import('./index');
  let programId = '';
  let today: string[] = [];

  const build = async (id: string) =>
    (
      await org.query<{ planned: string; built: string; category: string; deleted: boolean; first: string | null; finished: string | null; split_from: string | null }>(
        `select b.planned_qty::text as planned, b.built_qty::text as built, s.category, t.deleted_at is not null as deleted,
                b.first_finished_on::text as first, b.finished_on::text as finished, b.split_from_id::text as split_from
           from pm.builds b join pm.tasks t on t.id = b.task_id join pm.statuses s on s.id = t.status_id where b.task_id = $1`,
        [id],
      )
    )[0]!;

  beforeAll(async () => {
    programs = await import('./index');
    programs.setProgramClock(() => new Date('2026-11-25T15:00:00Z'));
    org = await createTestOrg('programs-split');
    owner = await org.member('owner', 'Maya Owner');
    await org.query(`insert into pm.org_calendar (org_id, timezone, working_days, holidays) values ($1, 'America/Chicago', '{1,2,3,4,5}', '[]'::jsonb)`, [org.orgId]);
    const { createFixtureProgram } = await import('./fixture');
    await createFixtureProgram(owner, { key: 'SPLIT', startDate: '2026-11-25' });
    programId = (await org.query<{ id: string }>(`select id from pm.projects where org_id = $1 and key = 'SPLIT'`, [org.orgId]))[0]!.id;
    today = (await org.query<{ id: string }>(`select b.task_id::text as id from pm.builds b join pm.tasks t on t.id = b.task_id where b.program_id = $1 and b.build_date = '2026-11-25' order by t.number`, [programId])).map((r) => r.id);
    expect(today.length).toBeGreaterThanOrEqual(4);
  });

  afterAll(async () => {
    programs?.resetProgramClock();
    await org?.destroy();
  });

  it('moves the rest of a build with nothing built: it is cancelled and keeps its plan', async () => {
    const id = today[0]!;
    const { newBuildId } = await programs.splitBuild(owner, id, { toDate: '2026-11-27' });
    const original = await build(id);
    expect(original.category).toBe('cancelled');
    expect(Number(original.planned)).toBe(100);
    const moved = await build(newBuildId);
    expect(Number(moved.planned)).toBe(100);
    expect(moved.split_from).toBe(id);
  });

  it('moves the rest of many builds in one call and undoes it', async () => {
    const [a, b] = [today[1]!, today[2]!];
    await programs.logOutput(owner, 'SPLIT', { date: '2026-11-25', entries: [{ buildId: a, mode: 'add', qty: '60' }] });
    const { newBuildIds } = await programs.splitBuilds(owner, [a, b], { toDate: '2026-11-27' });
    expect(newBuildIds).toHaveLength(2);
    expect(Number((await build(newBuildIds[0]!)).planned)).toBe(40);
    expect(Number((await build(newBuildIds[1]!)).planned)).toBe(100);
    expect((await build(a)).category).toBe('done');
    expect(Number((await build(a)).planned)).toBe(60);
    expect((await build(b)).category).toBe('cancelled');

    const { reopened } = await programs.undoSplitBuilds(owner, newBuildIds);
    expect(reopened).toBe(2);
    const backA = await build(a);
    const backB = await build(b);
    expect(Number(backA.planned)).toBe(100);
    expect(Number(backB.planned)).toBe(100);
    expect(['todo', 'in_progress']).toContain(backA.category);
    expect(backB.category).toBe('todo');
    expect((await build(newBuildIds[0]!)).deleted).toBe(true);
    expect((await build(newBuildIds[1]!)).deleted).toBe(true);
  });

  it('refuses to undo a move once the new build has output', async () => {
    const id = today[3]!;
    const { newBuildIds } = await programs.splitBuilds(owner, [id], { toDate: '2026-11-25' });
    await programs.logOutput(owner, 'SPLIT', { date: '2026-11-25', entries: [{ buildId: newBuildIds[0]!, mode: 'add', qty: '10' }] });
    await expect(programs.undoSplitBuilds(owner, newBuildIds)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('offers the charge choice for a build finished earlier this month and charges on the new date', async () => {
    const id = today[4] ?? today[1]!;
    await programs.logOutput(owner, 'SPLIT', { date: '2026-11-25', entries: [{ buildId: id, mode: 'add', qty: '100', markDone: true }] });
    // It first finished on Nov 20, then was opened again.
    const open = (await org.query<{ id: string }>(`select id from pm.statuses where project_id = $1 and category = 'todo' order by position limit 1`, [programId]))[0]!.id;
    const tasks = await import('../tasks');
    await tasks.updateTask(owner, id, { statusId: open });
    await org.query(`update pm.builds set first_finished_on = '2026-11-20' where task_id = $1`, [id]);
    const before = await programs.getBuild(owner, id);
    expect(before.build.rechargeChoice).toMatchObject({ firstFinishedOn: '2026-11-20', newText: 'Charge on the new date' });
    expect(before.build.rechargeChoice?.firstText).toMatch(/first finished/);

    await programs.finishBuild(owner, id, { chargeOn: 'new_date' });
    const after = await build(id);
    expect(after.category).toBe('done');
    expect(after.first).toBe('2026-11-25');
    expect(after.finished).toBe('2026-11-25');
    expect((await programs.getBuild(owner, id)).build.rechargeChoice).toBeNull();
  });
});
