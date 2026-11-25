/**
 * Where a build day's revenue goes (docs/programs/SPEC.md D4, M2, 4.3.3): the build's own live
 * `bills_to` Pulse job, else the program's live job, else the program, else not billed. Edges
 * live in `core.record_links`; liveness and job prices come from Pulse through the bridge.
 */
import 'server-only';
import { listRecordLinks, listRecordLinksMany } from '@kitstak/db/record-links';
import { postingTarget, type PostingTarget } from '@kitstak/programs-engine/accrual';
import type { JobPriceRow } from '@kitstak/programs-engine/types';
import { getJobFacts, getJobPriceRows, type ProgramJobFacts } from '@kitstak/pulse-bridge/programs';
import type { Executor } from '@/server/db';
import type { DomainContext } from '../_shared';
import { bridge, shared } from './_program';

export interface JobInfo {
  readonly id: string;
  readonly live: boolean;
  readonly facts: ProgramJobFacts | null;
}

export interface PostingContext {
  readonly programJob: JobInfo | null;
  readonly buildJobs: ReadonlyMap<string, JobInfo>;
  readonly targets: ReadonlyMap<string, PostingTarget>;
  /** Job prices per job id, read once per batch. */
  readonly jobPrices: Map<string, JobPriceRow[]>;
}

async function jobInfo(executor: Executor, ctx: DomainContext, jobId: string, cache: Map<string, JobInfo>): Promise<JobInfo> {
  const hit = cache.get(jobId);
  if (hit) return hit;
  const result = await getJobFacts(bridge(executor), { orgId: ctx.orgId, userId: ctx.userId }, jobId);
  // When Pulse cannot answer, keep the edge's money where it is: treat the job as live.
  const info: JobInfo = result.available ? { id: jobId, live: result.job?.live === true, facts: result.job } : { id: jobId, live: true, facts: null };
  cache.set(jobId, info);
  return info;
}

/** The program's `bills_to` job id, if any. */
export async function programJobId(executor: Executor, ctx: DomainContext, programId: string): Promise<string | null> {
  const edges = await listRecordLinks(shared(executor), ctx.orgId, { type: 'pm_program', id: programId }, { relation: 'bills_to', otherType: 'pulse_job' });
  const edge = edges.find((row) => row.from.type === 'pm_program' && row.from.id === programId && row.to.type === 'pulse_job');
  return edge?.to.id ?? null;
}

/** Build id to its own `bills_to` job id. */
export async function buildJobIds(executor: Executor, ctx: DomainContext, buildIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (buildIds.length === 0) return out;
  const edges = await listRecordLinksMany(shared(executor), ctx.orgId, buildIds.map((id) => ({ type: 'pm_build' as const, id })), { relation: 'bills_to' });
  for (const edge of edges) if (edge.from.type === 'pm_build' && edge.to.type === 'pulse_job') out.set(edge.from.id, edge.to.id);
  return out;
}

/** Resolves the posting of every build in `buildIds` (all in one container). */
export async function resolvePostings(
  executor: Executor,
  ctx: DomainContext,
  input: { readonly programId: string | null; readonly buildIds: readonly string[] },
): Promise<PostingContext> {
  const cache = new Map<string, JobInfo>();
  const programJobRef = input.programId ? await programJobId(executor, ctx, input.programId) : null;
  const programJob = programJobRef ? await jobInfo(executor, ctx, programJobRef, cache) : null;
  const ownJobs = await buildJobIds(executor, ctx, input.buildIds);
  const buildJobs = new Map<string, JobInfo>();
  const targets = new Map<string, PostingTarget>();
  for (const buildId of input.buildIds) {
    const jobRef = ownJobs.get(buildId);
    const buildJob = jobRef ? await jobInfo(executor, ctx, jobRef, cache) : null;
    if (buildJob) buildJobs.set(buildId, buildJob);
    targets.set(buildId, postingTarget({ buildJob, programId: input.programId, programJob }));
  }
  return { programJob, buildJobs, targets, jobPrices: new Map() };
}

/** Job prices for a job, read once per posting context. */
export async function jobPricesFor(executor: Executor, ctx: DomainContext, postings: PostingContext, jobId: string | null): Promise<JobPriceRow[] | undefined> {
  if (!jobId) return undefined;
  const hit = postings.jobPrices.get(jobId);
  if (hit) return hit;
  const rows = await getJobPriceRows(bridge(executor), ctx.orgId, jobId);
  postings.jobPrices.set(jobId, rows);
  return rows;
}

/** Where fees of a program go: its live job, else the program. */
export function feePosting(postings: Pick<PostingContext, 'programJob'>): { posting: 'program' | 'program_job'; jobId: string | null } {
  return postings.programJob && postings.programJob.live ? { posting: 'program_job', jobId: postings.programJob.id } : { posting: 'program', jobId: null };
}
