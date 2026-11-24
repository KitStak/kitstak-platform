/**
 * Tasks on production entries (0014), on a throwaway organization. The Projects task reader is
 * replaced with a fake (the test never writes into `pm.*`); everything on the Pulse side runs for
 * real. Skipped when no database answers.
 *
 *  - A day can hold one line per labor class and task: temps on two tasks the same day are two lines.
 *  - A task must be in a project linked to the job. Task units need a task.
 *  - The Log work grid offers each job's tasks and starts a new line on the last task used.
 *  - Cost by task groups hours, labor cost and task units, untagged lines last.
 *  - The job's Things to fix counts lines with hours and no task.
 *  - A production file can name the task by its number or its title. A file with no task column leaves tasks alone.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseCsv } from '@/lib/csv/parse';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { PmTask } from '@/server/integrations/projects';
import type { DomainContext } from './_shared';

const PROJECT = '00000000-0000-4000-8000-0000000000a1';
const OTHER_PROJECT = '00000000-0000-4000-8000-0000000000a2';
const PUZZLES = '00000000-0000-4000-8000-0000000000b1';
const KIT_PACK = '00000000-0000-4000-8000-0000000000b2';
const ELSEWHERE = '00000000-0000-4000-8000-0000000000b3';

vi.mock('@/server/integrations/projects', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/integrations/projects')>();
  const tasks: PmTask[] = [
    { id: PUZZLES, projectId: PROJECT, projectKey: 'ADV', number: 1, title: 'Puzzles', done: false, gone: false },
    { id: KIT_PACK, projectId: PROJECT, projectKey: 'ADV', number: 2, title: 'Kit pack', done: false, gone: false },
    { id: ELSEWHERE, projectId: OTHER_PROJECT, projectKey: 'OTH', number: 1, title: 'Other work', done: false, gone: false },
  ];
  return { ...real, tasksOfProjects: async (_ctx: unknown, ids: readonly string[]) => tasks.filter((task) => ids.includes(task.projectId)) };
});
vi.mock('@/server/integrations/detect', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/integrations/detect')>();
  return { ...real, integrationAvailability: async () => ({ crm: false, wms: false, projects: true }) };
});

const {
  addJobLink,
  appendImportRows,
  checkImportBatch,
  commitImportBatch,
  createClient,
  createImportBatch,
  createJob,
  createLaborClass,
  createLaborRate,
  getJob,
  getJobTaskCosts,
  getLogGrid,
  listJobTasks,
  listProduction,
  saveProductionEntry,
} = await import('./test-exports');
const ready = await databaseReady();
process.env.PULSE_IMPORT_UPLOADS_PER_HOUR = '1000';

describe.skipIf(!ready)('tasks on production entries', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let jobId = '';
  let jobNumber = '';
  let temp = '';
  let today = '';

  beforeAll(async () => {
    org = await createTestOrg('pulse-tasks');
    owner = await org.member('owner', 'Task Owner');
    temp = (await createLaborClass(owner, { code: 'TEMP', name: 'Temp' })).id;
    await createLaborRate(owner, { laborClassId: temp, effectiveFrom: '2020-01-01', wageCents: 2000 });
    const client = await createClient(owner, { name: 'Advent Client' });
    const job = await createJob(owner, { name: 'Advent 2026', clientId: client.id, status: 'active', pricingModel: 'per_unit', unitPrice: '8.0300', plannedUnits: '18200' });
    jobId = job.id;
    jobNumber = job.number;
    today = new Date().toISOString().slice(0, 10);
    await addJobLink(owner, job.id, { targetType: 'pm_project', targetId: PROJECT, title: 'Advent 2026' });
  }, 60_000);
  afterAll(async () => {
    await org?.destroy();
  });

  const line = (pmTaskId: string | null, hours: string, extra: Record<string, string> = {}) =>
    saveProductionEntry(owner, { jobId, workDate: today, laborClassId: temp, headcount: '1', hours, pmTaskId, ...extra });

  it('keeps temps on two tasks the same day as two lines', async () => {
    await line(PUZZLES, '16', { taskUnits: '1080' });
    await line(KIT_PACK, '24', { unitsGood: '600' });
    const rows = await listProduction(owner, { jobId, from: today, to: today });
    expect(rows.map((row) => [row.pmTaskId, Number(row.hours), row.taskUnits === null ? null : Number(row.taskUnits)]).sort()).toEqual(
      [
        [KIT_PACK, 24, null],
        [PUZZLES, 16, 1080],
      ].sort(),
    );
    // Saving the same task again updates that line instead of adding one.
    await line(PUZZLES, '20', { taskUnits: '1300' });
    const again = await listProduction(owner, { jobId, from: today, to: today });
    expect(again).toHaveLength(2);
    expect(Number(again.find((row) => row.pmTaskId === PUZZLES)?.hours)).toBe(20);
  }, 60_000);

  it('refuses a task from a project the job is not linked to, and task units with no task', async () => {
    await expect(line(ELSEWHERE, '8')).rejects.toThrow(/not in a project linked to this job/);
    await expect(line(null, '8', { taskUnits: '5' })).rejects.toThrow(/Task units need a task/);
  }, 60_000);

  it('never counts task units as finished units', async () => {
    const job = await getJob(owner, jobNumber);
    expect(Number(job.stats.unitsGood)).toBe(600);
  }, 60_000);

  it('offers the job tasks on Log work and starts a new line on the last task used', async () => {
    const tasks = await listJobTasks(owner, jobNumber);
    expect(tasks).toMatchObject({ hasProject: true });
    expect(tasks.tasks.map((task) => task.ref)).toEqual(['ADV-1', 'ADV-2']);
    const grid = await getLogGrid(owner, { date: today });
    const row = grid.rows.find((item) => item.jobId === jobId);
    expect(row?.hasProject).toBe(true);
    expect(row?.tasks.map((task) => task.title)).toEqual(['Puzzles', 'Kit pack']);
    expect([PUZZLES, KIT_PACK]).toContain(row?.lastTaskId);
  }, 60_000);

  it('shows cost by task with the untagged lines last, and counts them on Things to fix', async () => {
    await line(null, '4');
    const costs = await getJobTaskCosts(owner, jobNumber);
    expect(costs.hasProject).toBe(true);
    expect(costs.rows.map((row) => row.title)).toEqual(['Kit pack', 'Puzzles', 'Untagged']);
    const puzzles = costs.rows.find((row) => row.taskId === PUZZLES);
    expect(puzzles).toMatchObject({ ref: 'ADV-1', hours: '20.00' });
    expect(Number(puzzles?.taskUnits)).toBe(1300);
    expect(puzzles?.unitsPerHour).toBe('65.0');
    expect(costs.untaggedEntries).toBe(1);
    expect(Number(costs.untaggedHours)).toBe(4);
    const shares = costs.rows.map((row) => row.sharePct ?? 0);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(99);
    const job = await getJob(owner, jobNumber);
    expect(job.stats.needs).toMatchObject({ untaggedLines: 1 });
  }, 60_000);

  it('leaves a job alone when its project has no tasks', async () => {
    const client = await createClient(owner, { name: 'Ecomm Client' });
    const plain = await createJob(owner, { name: 'Ecomm job', clientId: client.id, status: 'active', pricingModel: 'per_unit', unitPrice: '3.0000' });
    await addJobLink(owner, plain.id, { targetType: 'pm_project', targetId: '00000000-0000-4000-8000-0000000000a9', title: 'Empty project' });
    await saveProductionEntry(owner, { jobId: plain.id, workDate: today, laborClassId: temp, headcount: '1', hours: '8', unitsGood: '40' });
    const grid = await getLogGrid(owner, { date: today });
    expect(grid.rows.find((item) => item.jobId === plain.id)?.hasProject).toBe(false);
    expect(await listJobTasks(owner, plain.number)).toMatchObject({ hasProject: false });
    expect(await getJobTaskCosts(owner, plain.number)).toMatchObject({ hasProject: false, untaggedEntries: 0 });
    expect((await getJob(owner, plain.number)).stats.needs).toMatchObject({ untaggedLines: 0 });
  }, 60_000);

  it('takes the task from a production file by number or title, and leaves it alone when the file has none', async () => {
    const upload = async (csv: string) => {
      const parsed = parseCsv(csv);
      const start = await createImportBatch(owner, { stream: 'production', fileName: 'production.csv', fileSize: csv.length, headers: parsed.headers, delimiter: parsed.delimiter });
      await appendImportRows(owner, start.batch.id, parsed.rows.map((cells, index) => ({ n: parsed.rowNumbers[index] as number, cells })), { done: true });
      return checkImportBatch(owner, start.batch.id, {});
    };
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const checked = await upload(
      [
        'work_date,job_number,labor_class,task,units_good,people,labor_hours,task_units',
        `${yesterday},${jobNumber},TEMP,ADV-1,0,2,16,900`,
        `${yesterday},${jobNumber},TEMP,kit pack,500,3,24,`,
      ].join('\n'),
    );
    expect(checked.counts).toMatchObject({ error: 0 });
    await commitImportBatch(owner, checked.id);
    const rows = await listProduction(owner, { jobId, from: yesterday, to: yesterday });
    expect(rows.map((row) => row.pmTaskId).sort()).toEqual([PUZZLES, KIT_PACK].sort());
    // A file with no task column, matched by entry id, leaves the task alone.
    const puzzleRow = rows.find((row) => row.pmTaskId === PUZZLES)!;
    const keep = await upload(['entry_id,work_date,job_number,labor_class,units_good,people,labor_hours', `${puzzleRow.id},${yesterday},${jobNumber},TEMP,0,2,18`].join('\n'));
    expect(keep.counts).toMatchObject({ error: 0 });
    await commitImportBatch(owner, keep.id);
    const kept = (await listProduction(owner, { jobId, from: yesterday, to: yesterday })).find((row) => row.id === puzzleRow.id);
    expect(kept).toMatchObject({ pmTaskId: PUZZLES, hours: '18.00' });
    expect(Number(kept?.taskUnits)).toBe(900);
    const bad = await upload(['work_date,job_number,labor_class,task,units_good,labor_hours', `${yesterday},${jobNumber},TEMP,Shrink wrap,0,8`].join('\n'));
    expect(bad.counts).toMatchObject({ error: 1 });
  }, 120_000);
});
