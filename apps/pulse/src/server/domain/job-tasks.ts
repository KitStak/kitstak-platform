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
import { tasksOfProjects, type PmTask } from '@/server/integrations/projects';
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
  const tasks = await tasksOfProjects(ctx, projectIds);
  return { hasProject: tasks.length > 0, tasks: tasks.map((task) => ({ id: task.id, ref: refOf(task), title: task.title, done: task.done })) };
});

const UNTAGGED = 'Untagged';
const GONE = 'Task no longer in Projects';

/** Hours, labor cost and task units of a job by task, the untagged lines last. */
export const getJobTaskCosts = scoped(async function getJobTaskCosts(ctx: DomainContext, jobRef: string): Promise<JobTaskCosts> {
  const access = await requirePulse(ctx, 'pulse:read');
  const job = await getJobRowForReader(ctx, jobRef, access);
  const grouped = await db
    .select({
      taskId: productionEntries.pmTaskId,
      entries: sql<number>`count(*) filter (where ${productionEntries.hours} > 0 or ${productionEntries.taskUnits} > 0 or ${productionEntries.unitsGood} > 0)::int`,
      hours: sql<string>`coalesce(sum(${productionEntries.hours}), 0)::text`,
      setupHours: sql<string>`coalesce(sum(${productionEntries.setupHours}), 0)::text`,
      laborCents: sql<string>`coalesce(sum(${productionEntries.laborCostCents}), 0)::text`,
      taskUnits: sql<string | null>`sum(${productionEntries.taskUnits})::text`,
    })
    .from(productionEntries)
    .where(and(eq(productionEntries.orgId, ctx.orgId), eq(productionEntries.jobId, job.id), isNull(productionEntries.deletedAt)))
    .groupBy(productionEntries.pmTaskId);
  const projectIds = await linkedProjectIds(db, ctx, job.id);
  const taggedIds = grouped.map((row) => row.taskId).filter((id): id is string => Boolean(id));
  const tasks = projectIds.length > 0 ? await tasksOfProjects(ctx, projectIds, taggedIds) : [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const totalCents = grouped.reduce((sum, row) => sum + BigInt(row.laborCents), BigInt(0));
  const seesMoney = access.seesMoney;
  const rows: JobTaskCostRow[] = grouped
    .filter((row) => row.taskId !== null || Number(row.hours) > 0 || projectIds.length > 0)
    .map((row) => {
      const task = row.taskId ? byId.get(row.taskId) : undefined;
      const cents = BigInt(row.laborCents);
      const hours = Number(row.hours);
      const units = row.taskUnits === null ? null : Number(row.taskUnits);
      return {
        taskId: row.taskId,
        title: row.taskId ? (task?.title ?? GONE) : UNTAGGED,
        ref: task ? refOf(task) : null,
        entries: Number(row.entries),
        hours: row.hours,
        setupHours: row.setupHours,
        laborCostCents: moneyOut(seesMoney, cents),
        sharePct: seesMoney && totalCents > BigInt(0) ? Math.round(Number((cents * BigInt(1000)) / totalCents) / 10) : null,
        taskUnits: row.taskUnits,
        unitsPerHour: units !== null && hours > 0 ? (units / hours).toFixed(1) : null,
        gone: Boolean(row.taskId) && (!task || task.gone),
      };
    })
    .sort((a, b) => (a.taskId === null ? 1 : 0) - (b.taskId === null ? 1 : 0) || Number(b.hours) - Number(a.hours));
  const untagged = grouped.find((row) => row.taskId === null);
  // The panel shows for a job whose projects have tasks, or that has tagged lines already.
  const usesTasks = tasks.some((task) => !task.gone) || taggedIds.length > 0;
  // Untagged lines only count once the job has a tagged line: until then there is nothing to compare.
  const counting = usesTasks && taggedIds.length > 0;
  return {
    hasProject: usesTasks,
    rows,
    untaggedEntries: counting && untagged && Number(untagged.hours) > 0 ? Number(untagged.entries) : 0,
    untaggedHours: counting && untagged ? untagged.hours : '0',
    moneyHidden: !seesMoney,
  };
});
