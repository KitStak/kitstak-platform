/**
 * Tasks on a job (0014). A job linked to a Projects project can tag each production entry with the
 * project task the hours were for: prebuild, labels, shippers, kit pack. One priced program stays
 * one job, and its cost still splits by step.
 *
 * - `listJobTasks`: the tasks a person may pick on this job, for the Log work grid and the day form.
 * - `getJobTaskCosts`: hours, labor cost and task units per task, plus the untagged lines.
 *
 * Task names come from Projects and are read fail soft: with Projects gone the breakdown still
 * shows, with "Task no longer in Projects" in place of the name.
 */
import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { productionEntries } from '@/server/db/schema';
import { pickableTasks, tasksOfProjects, type PmTask } from '@/server/integrations/projects';
import { programTaskNames, readPrograms, type ProgramFeed, type ProgramTaskName } from '@/server/integrations/programs';
import type { JobTaskCostRowDTO, JobTaskCostsDTO } from '@/lib/types';
import { moneyOut, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { getJobRowForReader } from './jobs';
import { linkedProjectIds } from './production';

export interface JobTaskOption {
  readonly id: string;
  /** Like ADV-12. */
  readonly ref: string;
  readonly title: string;
  readonly done: boolean;
}

export interface JobTaskList {
  /** True when the job has at least one linked project. Without one the grid hides the Task column. */
  readonly hasProject: boolean;
  readonly tasks: readonly JobTaskOption[];
}

export type JobTaskCostRow = JobTaskCostRowDTO;
export type JobTaskCosts = JobTaskCostsDTO;

const refOf = (task: PmTask): string => `${task.projectKey}-${task.number}`;

/** The tasks a person may tag on this job: open and done tasks of its linked projects, deleted ones left out. */
export const listJobTasks = scoped(async function listJobTasks(ctx: DomainContext, jobRef: string): Promise<JobTaskList> {
  const access = await requirePulse(ctx, 'pulse:read');
  const job = await getJobRowForReader(ctx, jobRef, access);
  const projectIds = await linkedProjectIds(db, ctx, job.id);
  if (projectIds.length === 0) return { hasProject: false, tasks: [] };
  const tasks = pickableTasks(await tasksOfProjects(ctx, projectIds));
  return { hasProject: tasks.length > 0, tasks: tasks.map((task) => ({ id: task.id, ref: refOf(task), title: task.title, done: task.done })) };
});

const UNTAGGED = 'Untagged';
const GONE = 'Task no longer in Projects';

type LineKind = 'task' | 'build' | 'prep';

interface Grouped {
  taskId: string | null;
  kind: LineKind;
  programId: string | null;
  entries: number;
  hours: string;
  setupHours: string;
  laborCents: string;
  taskUnits: string | null;
  unitsGood: string;
}

/** Sums of hour strings with 2 places, without floats. */
const addHours = (a: string, b: string): string => (Math.round(Number(a) * 100 + Number(b) * 100) / 100).toFixed(2);

/**
 * Hours, labor cost and task units of a job by task, the untagged lines last.
 *
 * Lines from a program are named through the programs reader: build lines (`pmb:`) roll up to one
 * "Builds" row per program (the By variant table on the overview splits them by variant), and
 * prep time (`pmt:`) shows one row per prep task, or one program row when the time is not per task.
 * A row with no hours is left out: build lines with units only carry no labor to compare.
 */
export const getJobTaskCosts = scoped(async function getJobTaskCosts(ctx: DomainContext, jobRef: string): Promise<JobTaskCosts> {
  const access = await requirePulse(ctx, 'pulse:read');
  const job = await getJobRowForReader(ctx, jobRef, access);
  const kindSql = sql<LineKind>`case when ${productionEntries.source} = 'projects' and ${productionEntries.sourceRef} like 'pmb:%' then 'build'
                                     when ${productionEntries.source} = 'projects' and ${productionEntries.sourceRef} like 'pmt:%' then 'prep' else 'task' end`;
  const raw = await db
    .select({
      taskId: productionEntries.pmTaskId,
      kind: kindSql,
      programId: sql<string | null>`${productionEntries.pmProgramId}::text`,
      entries: sql<number>`count(*) filter (where ${productionEntries.hours} > 0 or ${productionEntries.taskUnits} > 0 or ${productionEntries.unitsGood} > 0)::int`,
      hours: sql<string>`coalesce(sum(${productionEntries.hours}), 0)::text`,
      setupHours: sql<string>`coalesce(sum(${productionEntries.setupHours}), 0)::text`,
      laborCents: sql<string>`coalesce(sum(${productionEntries.laborCostCents}), 0)::text`,
      taskUnits: sql<string | null>`sum(${productionEntries.taskUnits})::text`,
      unitsGood: sql<string>`coalesce(sum(${productionEntries.unitsGood}), 0)::text`,
    })
    .from(productionEntries)
    .where(and(eq(productionEntries.orgId, ctx.orgId), eq(productionEntries.jobId, job.id), isNull(productionEntries.deletedAt)))
    .groupBy(productionEntries.pmTaskId, kindSql, productionEntries.pmProgramId);

  // Build lines roll up per program: one row, not one per build.
  const grouped: Grouped[] = [];
  const buildRows = new Map<string, Grouped>();
  for (const row of raw as Grouped[]) {
    if (row.kind !== 'build') {
      grouped.push({ ...row, entries: Number(row.entries) });
      continue;
    }
    const key = row.programId ?? 'none';
    const have = buildRows.get(key);
    if (!have) {
      const next: Grouped = { ...row, taskId: `builds:${key}`, entries: Number(row.entries), taskUnits: row.unitsGood };
      buildRows.set(key, next);
      grouped.push(next);
      continue;
    }
    have.entries += Number(row.entries);
    have.hours = addHours(have.hours, row.hours);
    have.setupHours = addHours(have.setupHours, row.setupHours);
    have.laborCents = (BigInt(have.laborCents) + BigInt(row.laborCents)).toString();
    have.taskUnits = (Number(have.taskUnits ?? 0) + Number(row.unitsGood)).toFixed(3);
  }

  const projectIds = await linkedProjectIds(db, ctx, job.id);
  const taskIdsOf = (kind: LineKind) => grouped.filter((row) => row.kind === kind && row.taskId).map((row) => row.taskId as string);
  const taggedIds = taskIdsOf('task');
  const programIds = [...new Set(grouped.filter((row) => row.kind !== 'task' && row.programId).map((row) => row.programId as string))];
  const [tasks, programs, prepNames] = await Promise.all([
    projectIds.length > 0 ? tasksOfProjects(ctx, projectIds, taggedIds) : Promise.resolve([] as PmTask[]),
    programIds.length > 0 ? readPrograms(ctx, programIds) : Promise.resolve(new Map<string, ProgramFeed>()),
    taskIdsOf('prep').length > 0 ? programTaskNames(ctx, taskIdsOf('prep')) : Promise.resolve(new Map<string, ProgramTaskName>()),
  ]);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const totalCents = grouped.reduce((sum, row) => sum + BigInt(row.laborCents), BigInt(0));
  const seesMoney = access.seesMoney;

  const nameOf = (row: Grouped): { title: string; ref: string | null; gone: boolean } => {
    const program = row.programId ? programs.get(row.programId) : undefined;
    if (row.kind === 'build') return { title: program ? `Builds of ${program.name}` : 'Builds from Projects', ref: program?.key ?? null, gone: false };
    if (row.kind === 'prep') {
      const prep = row.taskId ? prepNames.get(row.taskId) : undefined;
      if (prep) return { title: prep.title, ref: prep.key, gone: prep.deleted };
      return { title: program ? `Prep time on ${program.name}` : 'Prep time from Projects', ref: program?.key ?? null, gone: false };
    }
    if (!row.taskId) return { title: UNTAGGED, ref: null, gone: false };
    const task = byId.get(row.taskId);
    return { title: task?.title ?? GONE, ref: task ? refOf(task) : null, gone: !task || task.gone };
  };

  const rows: JobTaskCostRow[] = grouped
    // Program lines without hours only carry units: nothing to compare here.
    .filter((row) => (row.kind === 'task' ? row.taskId !== null || Number(row.hours) > 0 || projectIds.length > 0 : Number(row.hours) > 0))
    .map((row) => {
      const cents = BigInt(row.laborCents);
      const hours = Number(row.hours);
      const units = row.taskUnits === null ? null : Number(row.taskUnits);
      const name = nameOf(row);
      return {
        taskId: row.kind === 'prep' && !row.taskId ? `prep:${row.programId ?? 'none'}` : row.taskId,
        title: name.title,
        ref: name.ref,
        entries: row.entries,
        hours: row.hours,
        setupHours: row.setupHours,
        laborCostCents: moneyOut(seesMoney, cents),
        sharePct: seesMoney && totalCents > BigInt(0) ? Math.round(Number((cents * BigInt(1000)) / totalCents) / 10) : null,
        taskUnits: row.kind === 'prep' ? null : row.taskUnits,
        unitsPerHour: row.kind !== 'prep' && units !== null && units > 0 && hours > 0 ? (units / hours).toFixed(1) : null,
        gone: name.gone,
      };
    })
    .sort((a, b) => (a.taskId === null ? 1 : 0) - (b.taskId === null ? 1 : 0) || Number(b.hours) - Number(a.hours));
  const untagged = grouped.find((row) => row.kind === 'task' && row.taskId === null);
  const taggedShown = rows.filter((row) => row.taskId !== null).length;
  // The panel shows for a job whose projects have tasks, or that has tagged lines with hours.
  const usesTasks = tasks.some((task) => !task.gone) || taggedIds.length > 0 || taggedShown > 0;
  // Untagged lines only count once the job has a tagged line: until then there is nothing to compare.
  const counting = usesTasks && taggedShown > 0;
  return {
    hasProject: usesTasks,
    rows,
    untaggedEntries: counting && untagged && Number(untagged.hours) > 0 ? Number(untagged.entries) : 0,
    untaggedHours: counting && untagged ? untagged.hours : '0',
    moneyHidden: !seesMoney,
  };
});
