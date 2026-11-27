/**
 * L2 kind isolation on the cross project surfaces (docs/programs/SPEC.md 4.1, 9.2): the portfolio
 * report, the project report behind Dashboards, Workload (project task lists and My Work), goals
 * and the inbox never treat a program or its builds as project work. Runs in a throwaway org on
 * the program clock fixed at 2026-11-25 (America/Chicago).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from '../_shared';

const ready = await databaseReady(['pm.projects', 'pm.builds', 'pm.build_output', 'pm.goals', 'pm.notifications']);

describe.skipIf(!ready)('programs: kind isolation on portfolio, dashboards, workload, goals and inbox', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let programs: typeof import('./index');
  let tasksDomain: typeof import('../tasks');
  let programId = '';
  let projectId = '';
  let programBuilds: string[] = [];
  const taskIds: string[] = [];

  const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await org.query<T>(text, values))[0]!;

  beforeAll(async () => {
    programs = await import('./index');
    tasksDomain = await import('../tasks');
    programs.setProgramClock(() => new Date('2026-11-25T15:00:00Z'));
    org = await createTestOrg('programs-kinds');
    owner = await org.member('owner', 'Maya Owner');
    await org.query(`insert into pm.org_calendar (org_id, timezone, working_days, holidays) values ($1, 'America/Chicago', '{1,2,3,4,5}', '[]'::jsonb)`, [org.orgId]);
    const projectsDomain = await import('../projects');
    projectId = (await projectsDomain.createProject(owner, { name: 'Frames', key: 'FRA' })).id;
    const { createFixtureProgram } = await import('./fixture');
    await createFixtureProgram(owner, { key: 'GLOVE', startDate: '2026-11-25' });
    programId = (await one<{ id: string }>(`select id::text as id from pm.projects where org_id = $1 and key = 'GLOVE'`, [org.orgId])).id;
    // Two project tasks (one done), both assigned to the owner and due yesterday.
    const statuses = await org.query<{ id: string; category: string }>(`select id::text, category from pm.statuses where project_id = $1`, [projectId]);
    for (const title of ['Order frame steel', 'Paint frames']) {
      const task = await tasksDomain.createTask(owner, { projectId, title, dueDate: '2026-11-24', assigneeId: owner.userId });
      taskIds.push(task.id);
    }
    await tasksDomain.updateTask(owner, taskIds[1]!, { statusId: statuses.find((s) => s.category === 'done')!.id });
    // Program builds: every one of today's builds assigned to the owner, due yesterday, half of them done.
    programBuilds = (await org.query<{ id: string }>(`select task_id::text as id from pm.builds where program_id = $1 and build_date = '2026-11-25'`, [programId])).map((r) => r.id);
    expect(programBuilds.length).toBeGreaterThan(2);
    await org.query(`update pm.tasks set assignee_id = $2, due_date = '2026-11-24' where id = any($1::uuid[])`, [programBuilds, owner.userId]);
    await org.query(`update pm.builds set build_date = '2026-11-24' where task_id = any($1::uuid[])`, [programBuilds]);
    const programDone = (await one<{ id: string }>(`select id::text from pm.statuses where project_id = $1 and category = 'done' limit 1`, [programId])).id;
    await org.query(`update pm.tasks set status_id = $2, completed_at = now() where id = any($1::uuid[])`, [programBuilds.slice(0, 2), programDone]);
  });

  afterAll(async () => {
    programs?.resetProgramClock();
    await org?.destroy();
  });

  it('portfolio: counts project tasks only, never program builds', async () => {
    const { getPortfolioReport } = await import('../portfolio');
    const report = await getPortfolioReport(owner);
    expect(report.scope).toMatchObject({ kind: 'portfolio', projectCount: 1 });
    expect(report.totals.total).toBe(2);
    expect(report.totals.done).toBe(1);
    expect(report.totals.overdue).toBe(1);
    expect(report.completedThisWeek.every((t) => t.key.startsWith('FRA-'))).toBe(true);
  });

  it('dashboards: the project report refuses a program; program panels list programs only', async () => {
    const { getProjectReport } = await import('../portfolio');
    await expect(getProjectReport(owner, { key: 'GLOVE' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getProjectReport(owner, { id: programId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const report = await getProjectReport(owner, { key: 'FRA' });
    expect(report.totals.total).toBe(2);
    const panels = await programs.dashboardPrograms(owner);
    expect(panels.today.programs).toBeLessThanOrEqual(1);
    expect(panels.atRisk.every((p) => p.key === 'GLOVE')).toBe(true);
    const { listProjects } = await import('../projects');
    expect((await listProjects(owner)).map((p) => p.key)).toEqual(['FRA']);
  });

  it('workload: a project lists its own work only, and My Work leaves builds out by default', async () => {
    const plainBuild = await programs.createBuild(owner, 'FRA', { buildDate: '2026-11-25', plannedQty: '12', title: 'Frames batch' });
    const all = await tasksDomain.listProjectTasks(owner, projectId);
    expect(all.some((t) => programBuilds.includes(t.id))).toBe(false);
    expect(all.find((t) => t.id === plainBuild.id)).toMatchObject({ kind: 'build', build: { plannedQty: '12.000' } });
    expect((await tasksDomain.listProjectTasks(owner, projectId, { workKind: 'tasks' })).map((t) => t.id).sort()).toEqual([...taskIds].sort());
    const mine = await tasksDomain.listMyTasks(owner);
    expect(mine.every((t) => (t.kind ?? 'task') === 'task')).toBe(true);
    expect(mine.some((t) => programBuilds.includes(t.id))).toBe(false);
    const withBuilds = await tasksDomain.listMyTasks(owner, { include: 'builds' });
    expect(withBuilds.some((t) => programBuilds.includes(t.id))).toBe(true);
    await tasksDomain.deleteTasks(owner, [plainBuild.id]);
  });

  it('goals: a project percent counts its tasks, never program builds; a program uses its target percent', async () => {
    const goals = await import('../goals');
    const goal = await goals.createGoal(owner, { name: 'Ship frames', progressMode: 'projects' });
    const linked = await goals.linkGoalProject(owner, goal.id, projectId, true);
    expect(linked.progress).toBe(50);
    // More program builds finish: the project percent does not move.
    const programDone = (await one<{ id: string }>(`select id::text from pm.statuses where project_id = $1 and category = 'done' limit 1`, [programId])).id;
    await org.query(`update pm.tasks set status_id = $2, completed_at = now() where id = any($1::uuid[])`, [programBuilds, programDone]);
    expect((await goals.getGoal(owner, goal.id)).progress).toBe(50);
    const programGoal = await goals.createGoal(owner, { name: 'Glove revenue', progressMode: 'projects' });
    const tracked = await goals.linkGoalProject(owner, programGoal.id, programId, true);
    const [item] = await programs.listPrograms(owner, { ids: [programId] });
    // Every build is done, but the goal moves with the percent of target, not the builds done.
    expect(tracked.progress).toBe(goals.programGoalPercent(item!.month.targetBp));
  });

  it('inbox: due reminders skip builds, and the Programs filter shows program notices only', async () => {
    const { listNotifications } = await import('../notifications');
    const { ensureDueReminders } = await import('../due-reminders');
    await ensureDueReminders(owner, { force: true });
    const due = await listNotifications(owner, { filter: 'due' });
    expect(due.items.length).toBeGreaterThan(0);
    expect(due.items.some((n) => n.taskId && programBuilds.includes(n.taskId))).toBe(false);
    expect(due.items.every((n) => n.taskId === taskIds[0])).toBe(true);
    await org.query(
      `insert into pm.notifications (org_id, user_id, kind, project_id, title, url) values ($1, $2, 'project', $3, 'GLOVE is short on liners', '/programs/GLOVE'), ($1, $2, 'project', $4, 'Frames update', '/p/FRA')`,
      [org.orgId, owner.userId, programId, projectId],
    );
    const programNotices = await listNotifications(owner, { filter: 'programs' });
    expect(programNotices.items.map((n) => n.title)).toEqual(['GLOVE is short on liners']);
    const everything = await listNotifications(owner);
    expect(everything.items.map((n) => n.title)).toEqual(expect.arrayContaining(['GLOVE is short on liners', 'Frames update']));
  });
});
