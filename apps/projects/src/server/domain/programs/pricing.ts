/**
 * Output price snapshots (docs/programs/SPEC.md M4, D5, 4.3.3). Each `pm.build_output` row stores
 * a concrete unit price, its source, the card version, the revenue cents and where it posts.
 * `restampOutput` re-resolves open rows after a version, variant, override, job price or posting
 * change. Locked rows never change.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { loadPublishedVersions } from '@kitstak/db/programs';
import { mulQuantityPrice } from '@kitstak/programs-engine/money';
import { resolveUnitPrice, type ResolvedPrice } from '@kitstak/programs-engine/price';
import type { CardVersion, IsoDate } from '@kitstak/programs-engine/types';
import type { PostingTarget } from '@kitstak/programs-engine/accrual';
import type { Executor } from '@/server/db';
import type { DomainContext } from '../_shared';
import { shared } from './_program';
import { isLocked, type ProgramLocks } from './locks';
import { jobPricesFor, resolvePostings, type PostingContext } from './postings';

export interface Snapshot {
  readonly unitPrice: string;
  readonly priceSource: ResolvedPrice['source'];
  readonly cardVersionId: string | null;
  readonly revenueCents: string;
  readonly posting: PostingTarget['posting'];
  readonly pulseJobId: string | null;
}

export async function versionsFor(executor: Executor, ctx: DomainContext, programId: string | null): Promise<CardVersion[]> {
  return programId ? loadPublishedVersions(shared(executor), ctx.orgId, programId) : [];
}

/** The snapshot of one build day (M4). */
export async function snapshotFor(
  executor: Executor,
  ctx: DomainContext,
  input: {
    readonly buildId: string;
    readonly variantId: string | null;
    readonly rateOverride: string | null;
    readonly workDate: IsoDate;
    readonly qty: string;
    readonly versions: readonly CardVersion[];
    readonly postings: PostingContext;
  },
): Promise<Snapshot> {
  const target = input.postings.targets.get(input.buildId) ?? ({ posting: 'unbilled', jobId: null } as PostingTarget);
  const jobPrices = await jobPricesFor(executor, ctx, input.postings, target.jobId);
  const price = resolveUnitPrice({ workDate: input.workDate, variantId: input.variantId, buildOverride: input.rateOverride, versions: input.versions, jobPrices });
  return {
    unitPrice: price.unitPrice,
    priceSource: price.source,
    cardVersionId: price.versionId,
    revenueCents: mulQuantityPrice(input.qty, price.unitPrice).toString(),
    posting: target.posting,
    pulseJobId: target.jobId,
  };
}

interface OpenRow {
  id: string;
  build_id: string;
  variant_id: string | null;
  rate_override: string | null;
  work_date: string;
  qty: string;
  unit_price: string;
  price_source: string;
  card_version_id: string | null;
  revenue_cents: string;
  posting: string;
  pulse_job_id: string | null;
}

/**
 * Re-resolves the snapshot of every open output row of a container (optionally only some builds,
 * only from a date) and writes the rows whose snapshot changed. Returns the number of rows changed.
 * The caller refreshes the ledger and emits the program event.
 */
export async function restampOutput(
  tx: Executor,
  ctx: DomainContext,
  input: {
    readonly containerId: string;
    readonly programId: string | null;
    readonly locks: ProgramLocks | null;
    readonly buildIds?: readonly string[];
    readonly from?: IsoDate | null;
  },
): Promise<number> {
  const builds = input.buildIds && input.buildIds.length > 0 ? sql` and o.build_id in (${sql.join(input.buildIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  const from = input.from ? sql` and o.work_date >= ${input.from}::date` : sql``;
  const result = await tx.execute(
    sql`select o.id::text as id, o.build_id::text as build_id, b.variant_id::text as variant_id, b.rate_override::text as rate_override,
               o.work_date::text as work_date, o.qty::text as qty, o.unit_price::text as unit_price, o.price_source,
               o.card_version_id::text as card_version_id, o.revenue_cents::text as revenue_cents, o.posting, o.pulse_job_id::text as pulse_job_id
          from pm.build_output o
          join pm.builds b on b.task_id = o.build_id
          join pm.tasks t on t.id = o.build_id and t.deleted_at is null
         where o.org_id = ${ctx.orgId}::uuid and o.container_id = ${input.containerId}::uuid and o.deleted_at is null${builds}${from}
         order by o.build_id, o.work_date`,
  );
  const rows = (result as unknown as { rows: OpenRow[] }).rows;
  if (rows.length === 0) return 0;
  const versions = await versionsFor(tx, ctx, input.programId);
  const postings = await resolvePostings(tx, ctx, { programId: input.programId, buildIds: [...new Set(rows.map((row) => row.build_id))] });
  let changed = 0;
  for (const row of rows) {
    const next = await snapshotFor(tx, ctx, { buildId: row.build_id, variantId: row.variant_id, rateOverride: row.rate_override, workDate: row.work_date, qty: row.qty, versions, postings });
    if (input.locks) {
      const wasJob = row.posting === 'program_job' || row.posting === 'build_job';
      const goesJob = next.posting === 'program_job' || next.posting === 'build_job';
      if (isLocked(input.locks, row.work_date, { goesToJob: wasJob }) || isLocked(input.locks, row.work_date, { goesToJob: goesJob })) continue;
    }
    const same =
      next.unitPrice === row.unit_price &&
      next.priceSource === row.price_source &&
      (next.cardVersionId ?? null) === (row.card_version_id ?? null) &&
      next.revenueCents === row.revenue_cents &&
      next.posting === row.posting &&
      (next.pulseJobId ?? null) === (row.pulse_job_id ?? null);
    if (same) continue;
    await tx.execute(
      sql`update pm.build_output set unit_price = ${next.unitPrice}::numeric, price_source = ${next.priceSource},
               card_version_id = ${next.cardVersionId}::uuid, revenue_cents = ${next.revenueCents}::bigint,
               posting = ${next.posting}, pulse_job_id = ${next.pulseJobId}::uuid, updated_at = now(), version = version + 1
           where id = ${row.id}::uuid`,
    );
    changed += 1;
  }
  return changed;
}
