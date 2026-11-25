/**
 * Jobs fed by KitStak Programs (docs/programs/SPEC.md 6.1). A program, or a build, bills to a
 * Pulse job through a `bills_to` edge in `core.record_links`; the sync mirrors the edge into
 * `pulse.job_links` (`pm_program`, `pm_build`) so Pulse screens and checks read it from Pulse.
 *
 * On a job fed this way, units, prices and fees come from Projects. Lines written by the sync
 * (`pmb:` refs) are read only, fee rows (`pmf:` refs) cannot be edited, and people may add typed
 * lines with hours and crew only. Every refusal in Pulse uses the words here.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import type { Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { rows, type DomainContext } from './_shared';

/** A sync written build line (`pmb:<buildId>:<date>`). */
export const isBuildRef = (ref: string | null | undefined): boolean => typeof ref === 'string' && ref.startsWith('pmb:');
/** A sync written program fee row (`pmf:<programId>:...`). */
export const isFeeRef = (ref: string | null | undefined): boolean => typeof ref === 'string' && ref.startsWith('pmf:');
/** A sync written prep labor row (`pmt:<programId>:...`). */
export const isPrepRef = (ref: string | null | undefined): boolean => typeof ref === 'string' && ref.startsWith('pmt:');
/** Any row the program sync owns. */
export const isProgramRef = (ref: string | null | undefined): boolean => isBuildRef(ref) || isFeeRef(ref) || isPrepRef(ref);

export const TYPED_UNITS_REFUSED = 'Units for this job come from builds in Projects.';
export const buildLineReadOnly = (buildKey: string | null): string =>
  `This line comes from build ${buildKey ?? 'a build'} in Projects. Change it there.`;
export const feeReadOnly = (programKey: string | null): string =>
  `This fee comes from the ${programKey ?? 'program'} price card in Projects. Change it there.`;
export const prepLineReadOnly = (programKey: string | null): string =>
  `This line is time logged on ${programKey ?? 'a program'} in Projects. Change it there.`;
export const jobDeleteRefused = (programKey: string | null): string =>
  `${programKey ?? 'A program'} bills to this job. Remove the link in Projects first.`;
export const modelChangeRefused = (programKey: string | null): string =>
  `${programKey ?? 'A program'} bills to this job, so it stays a per unit job. Remove the link in Projects first.`;
export const workOrderRefused = (programKey: string | null): string =>
  `${programKey ?? 'A program'} feeds this job, so it cannot also take units from a WMS work order.`;
export const jobPricesFromProgram = (programKey: string | null): string =>
  `Prices for this job come from the ${programKey ?? 'program'} price card in Projects.`;

export interface ProgramMirror {
  readonly linkId: string;
  readonly targetType: 'pm_program' | 'pm_build';
  readonly targetId: string;
  readonly title: string | null;
  readonly path: string | null;
  /** Program key (`GLOVE`) for a program mirror, build key (`GLOVE-212`) for a build mirror. */
  readonly key: string | null;
  /** The program a build mirror belongs to, when it has one. */
  readonly programId: string | null;
  readonly programKey: string | null;
  readonly importsTime: boolean;
}

interface MirrorRow {
  id: string;
  target_type: 'pm_program' | 'pm_build';
  target_id: string;
  cached_title: string | null;
  cached_url: string | null;
  imports_time: boolean;
  meta: Record<string, unknown> | null;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

function toMirror(row: MirrorRow): ProgramMirror {
  const meta = row.meta ?? {};
  return {
    linkId: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    title: row.cached_title,
    path: row.cached_url,
    key: text(meta.key),
    programId: row.target_type === 'pm_program' ? row.target_id : text(meta.programId),
    programKey: row.target_type === 'pm_program' ? text(meta.key) : text(meta.programKey),
    importsTime: row.imports_time,
  };
}

/** The program and build mirrors on one job, program first. */
export const jobProgramMirrors = scoped(async function jobProgramMirrors(executor: Executor, ctx: DomainContext, jobId: string): Promise<ProgramMirror[]> {
  const found = await rows<MirrorRow>(
    executor,
    sql`SELECT id, target_type, target_id, cached_title, cached_url, imports_time, meta FROM pulse.job_links
         WHERE org_id = ${ctx.orgId} AND job_id = ${jobId} AND target_type IN ('pm_program', 'pm_build')
         ORDER BY (target_type = 'pm_program') DESC, created_at`,
  );
  return found.map(toMirror);
}, 1);

/** Program and build mirrors for many jobs at once (lists). */
export const programMirrorsByJob = scoped(async function programMirrorsByJob(executor: Executor, ctx: DomainContext, jobIds: readonly string[]): Promise<Map<string, ProgramMirror[]>> {
  const out = new Map<string, ProgramMirror[]>();
  if (jobIds.length === 0) return out;
  const found = await rows<MirrorRow & { job_id: string }>(
    executor,
    sql`SELECT job_id, id, target_type, target_id, cached_title, cached_url, imports_time, meta FROM pulse.job_links
         WHERE org_id = ${ctx.orgId} AND target_type IN ('pm_program', 'pm_build')
           AND job_id IN (${sql.join(jobIds.map((id) => sql`${id}::uuid`), sql`, `)})
         ORDER BY (target_type = 'pm_program') DESC, created_at`,
  );
  for (const row of found) out.set(row.job_id, [...(out.get(row.job_id) ?? []), toMirror(row)]);
  return out;
}, 1);

/** What feeds a job from Projects, in one line for refusals: the program key, or the first build's program. */
export interface JobFeed {
  readonly fed: boolean;
  readonly programMirror: ProgramMirror | null;
  /** The key to name in messages: the program key, else the program of a build, else the build key. */
  readonly label: string | null;
}

export function feedOf(mirrors: readonly ProgramMirror[]): JobFeed {
  const program = mirrors.find((mirror) => mirror.targetType === 'pm_program') ?? null;
  const first = mirrors[0] ?? null;
  return { fed: mirrors.length > 0, programMirror: program, label: program?.key ?? first?.programKey ?? first?.key ?? null };
}

/** The feed of one job. */
export const jobFeed = scoped(async function jobFeed(executor: Executor, ctx: DomainContext, jobId: string): Promise<JobFeed> {
  return feedOf(await jobProgramMirrors(executor, ctx, jobId));
}, 1);
