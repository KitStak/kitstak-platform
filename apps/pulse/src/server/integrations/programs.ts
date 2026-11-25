/**
 * Programs reader (docs/programs/SPEC.md 6.1): KitStak Programs in Projects feed per unit Pulse
 * jobs. Pulse never computes program money. It copies two stored things Projects writes:
 *
 *  - per unit snapshots in `pm.build_output` (one row per build per work date), and
 *  - posted fees in `pm.program_ledger`,
 *
 * both read through `@kitstak/db/programs`, the one shared loader, so the filters are the
 * Projects filters to the row. The `bills_to` edges in `core.record_links` decide which job a
 * program or a build feeds.
 *
 * Reads run through `siblingDb` (as the owner, so `core` and `pm` rows are visible) and keep
 * their own org filter. The edge read is strict (`throwOnError`): the sync takes rows away when
 * an edge is gone, so a failed read must never look like "no edges".
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import {
  loadBuildHoursByDay,
  loadPrepTimeByDay,
  programsAvailable,
  readBuildOutput,
  readProgramMonth,
  type Executor as ProgramsExecutor,
  type ProgramMonthRead,
} from '@kitstak/db/programs';
import type { IsoDate, IsoMonth, OutputRow } from '@kitstak/programs-engine/types';
import { scoped } from '@/server/db/scope';
import { rows, type DomainContext } from '@/server/domain/_shared';
import { siblingDb, tableExists } from './detect';
import { logSoftFail } from './log';
import { projectsReady } from './projects';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidList = (ids: readonly string[]) => sql.join([...new Set(ids.filter((id) => UUID.test(id)))].map((id) => sql`${id}::uuid`), sql`, `);

/** The shared loader takes a structural executor. Only `execute` is used by the readers. */
const shared = siblingDb as unknown as ProgramsExecutor;

/* ------------------------------------------------------------- detection */

const READY_TTL_MS = 60_000;
const readyCache = new Map<string, { ready: boolean; at: number }>();

/**
 * Programs can feed Pulse here: Projects is on and installed, `pm.projects.kind` exists (Projects
 * 0006), the program tables exist, and `core.record_links` exists. Without them the program sync
 * step is skipped and program UI is hidden. Fails soft.
 */
export const programsReady = scoped(async function programsReady(ctx: DomainContext): Promise<boolean> {
  const hit = readyCache.get(ctx.orgId);
  if (hit && Date.now() - hit.at < READY_TTL_MS) return hit.ready;
  let ready = false;
  try {
    if (await projectsReady(ctx)) {
      const available = await programsAvailable(shared);
      ready = available.kinds && available.tables && (await tableExists('core.record_links'));
    }
  } catch (error) {
    logSoftFail(ctx.orgId, 'programs.programsReady', error);
    ready = false;
  }
  if (readyCache.size > 5000) readyCache.clear();
  readyCache.set(ctx.orgId, { ready, at: Date.now() });
  return ready;
});

/** True when `pm.projects.kind` exists (Projects 0006), so project lists can leave programs out. */
export const projectKindsReady = scoped(async function projectKindsReady(ctx: DomainContext): Promise<boolean> {
  try {
    return (await programsAvailable(shared)).kinds;
  } catch (error) {
    logSoftFail(ctx.orgId, 'programs.projectKindsReady', error);
    return false;
  }
});

/* ------------------------------------------------------------------ edges */

export interface ProgramEdge {
  readonly id: string;
  readonly fromType: 'pm_program' | 'pm_build';
  readonly fromId: string;
  readonly jobId: string;
  readonly meta: Record<string, unknown>;
}

/**
 * Every `bills_to` edge of the org that points at a Pulse job. Strict: a failed read throws
 * after the log line, so the sync never removes rows on a read that went wrong.
 */
export const programEdges = scoped(async function programEdges(ctx: DomainContext): Promise<ProgramEdge[]> {
  try {
    const found = await rows<{ id: string; from_type: string; from_id: string; to_id: string; meta: Record<string, unknown> | null }>(
      siblingDb,
      sql`select l.id::text as id, l.from_type, l.from_id, l.to_id, l.meta
            from core.record_links l
           where l.org_id = ${ctx.orgId}::uuid and l.relation = 'bills_to' and l.to_type = 'pulse_job'
             and l.from_type in ('pm_program', 'pm_build')
           order by l.created_at, l.id`,
    );
    return found
      .filter((row) => UUID.test(row.from_id) && UUID.test(row.to_id))
      .map((row) => ({ id: row.id, fromType: row.from_type as 'pm_program' | 'pm_build', fromId: row.from_id, jobId: row.to_id, meta: row.meta ?? {} }));
  } catch (error) {
    logSoftFail(ctx.orgId, 'programs.programEdges', error);
    throw error;
  }
});

/** Which of these edge ids still exist (the guard rail for an empty edge read). Strict. */
export const existingEdgeIds = scoped(async function existingEdgeIds(ctx: DomainContext, ids: readonly string[]): Promise<Set<string>> {
  const clean = ids.filter((id) => UUID.test(id));
  if (clean.length === 0) return new Set();
  const found = await rows<{ id: string }>(siblingDb, sql`select id::text as id from core.record_links where org_id = ${ctx.orgId}::uuid and id in (${uuidList(clean)})`);
  return new Set(found.map((row) => row.id));
});

/** The `bills_to` edge of one program, if it has one (live or not). Fail soft: null. */
export const programEdgeOf = scoped(async function programEdgeOf(ctx: DomainContext, programId: string): Promise<{ id: string; jobId: string } | null> {
  if (!UUID.test(programId)) return null;
  try {
    const [row] = await rows<{ id: string; to_id: string }>(
      siblingDb,
      sql`select id::text as id, to_id from core.record_links
           where org_id = ${ctx.orgId}::uuid and relation = 'bills_to' and from_type = 'pm_program' and from_id = ${programId} limit 1`,
    );
    return row ? { id: row.id, jobId: row.to_id } : null;
  } catch (error) {
    logSoftFail(ctx.orgId, 'programs.programEdgeOf', error);
    return null;
  }
});

/* ------------------------------------------------------------------ feeds */

export interface ProgramFeed {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly status: string;
  /** Soft deleted in Projects. Its open rows leave Pulse; nothing new is written. */
  readonly deleted: boolean;
  readonly timezone: string;
  readonly unitSingular: string;
  readonly unitPlural: string;
  readonly startDate: IsoDate | null;
  readonly settledThrough: IsoDate | null;
  readonly coreCustomerId: string | null;
  /** Path in Projects (`/programs/GLOVE`). */
  readonly path: string;
}

export interface BuildFeed {
  readonly id: string;
  /** `GLOVE-212`, or `FRA-31` for a build in a project. */
  readonly key: string;
  readonly number: number;
  readonly title: string;
  readonly containerId: string;
  readonly containerKey: string;
  readonly programId: string | null;
  readonly variantId: string | null;
  readonly buildDate: IsoDate;
  readonly deleted: boolean;
  readonly path: string;
}

/** Programs by id, live or soft deleted, with their settings. Strict when `throwOnError`. */
export const readPrograms = scoped(async function readPrograms(ctx: DomainContext, ids: readonly string[], options: { throwOnError?: boolean } = {}): Promise<Map<string, ProgramFeed>> {
  const out = new Map<string, ProgramFeed>();
  if (ids.filter((id) => UUID.test(id)).length === 0) return out;
  try {
    const found = await rows<{ id: string; key: string; name: string; status: string; deleted: boolean; timezone: string | null; unit_singular: string | null; unit_plural: string | null; start_date: string | null; settled_through: string | null; core_customer_id: string | null }>(
      siblingDb,
      sql`select p.id::text as id, p.key, p.name, p.status, (p.deleted_at is not null) as deleted,
                 ps.timezone, ps.unit_singular, ps.unit_plural, p.start_date::text as start_date,
                 ps.settled_through::text as settled_through, p.crm_customer_id::text as core_customer_id
            from pm.projects p
            left join pm.program_settings ps on ps.program_id = p.id
           where p.org_id = ${ctx.orgId}::uuid and p.kind = 'program' and p.id in (${uuidList(ids)})`,
    );
    for (const row of found) {
      out.set(row.id, {
        id: row.id,
        key: row.key,
        name: row.name,
        status: row.status,
        deleted: Boolean(row.deleted),
        timezone: row.timezone || 'America/Chicago',
        unitSingular: row.unit_singular || 'unit',
        unitPlural: row.unit_plural || 'units',
        startDate: row.start_date,
        settledThrough: row.settled_through,
        coreCustomerId: row.core_customer_id,
        path: `/programs/${encodeURIComponent(row.key)}`,
      });
    }
  } catch (error) {
    logSoftFail(ctx.orgId, 'programs.readPrograms', error);
    if (options.throwOnError) throw error;
  }
  return out;
});

/** Builds by id with their container, live or soft deleted. Strict when `throwOnError`. */
export const readBuilds = scoped(async function readBuilds(ctx: DomainContext, ids: readonly string[], options: { throwOnError?: boolean } = {}): Promise<Map<string, BuildFeed>> {
  const out = new Map<string, BuildFeed>();
  if (ids.filter((id) => UUID.test(id)).length === 0) return out;
  try {
    const found = await rows<{ id: string; number: number; title: string; container_id: string; container_key: string; container_kind: string; program_id: string | null; variant_id: string | null; build_date: string; deleted: boolean }>(
      siblingDb,
      sql`select t.id::text as id, t.number, t.title, p.id::text as container_id, p.key as container_key, p.kind as container_kind,
                 b.program_id::text as program_id, b.variant_id::text as variant_id, b.build_date::text as build_date,
                 (t.deleted_at is not null or p.deleted_at is not null) as deleted
            from pm.builds b
            join pm.tasks t on t.id = b.task_id
            join pm.projects p on p.id = t.project_id
           where b.org_id = ${ctx.orgId}::uuid and b.task_id in (${uuidList(ids)})`,
    );
    for (const row of found) {
      const number = Number(row.number);
      out.set(row.id, {
        id: row.id,
        key: `${row.container_key}-${number}`,
        number,
        title: row.title,
        containerId: row.container_id,
        containerKey: row.container_key,
        programId: row.program_id,
        variantId: row.variant_id,
        buildDate: row.build_date,
        deleted: Boolean(row.deleted),
        path: row.container_kind === 'program' ? `/programs/${encodeURIComponent(row.container_key)}/${number}` : `/p/${encodeURIComponent(row.container_key)}/${number}`,
      });
    }
  } catch (error) {
    logSoftFail(ctx.orgId, 'programs.readBuilds', error);
    if (options.throwOnError) throw error;
  }
  return out;
});

/** Builds of the org by key (`GLOVE-212`), for the words on a read only Pulse line. Fail soft. */
export const buildKeysOf = scoped(async function buildKeysOf(ctx: DomainContext, buildIds: readonly string[]): Promise<Map<string, string>> {
  const builds = await readBuilds(ctx, buildIds);
  return new Map([...builds.values()].map((build) => [build.id, build.key]));
});

export interface ProgramVariant {
  readonly id: string;
  readonly programId: string;
  readonly key: string;
  readonly name: string;
  readonly sku: string | null;
  readonly color: string | null;
  readonly position: string;
  readonly retired: boolean;
  readonly deleted: boolean;
  /** Standard material cost for one unit, currency units with 4 places. */
  readonly materialCostPerUnit: string | null;
}

/** Variants of the given programs, including removed ones (so old rows still have a name). Fail soft. */
export const programVariants = scoped(async function programVariants(ctx: DomainContext, programIds: readonly string[], options: { throwOnError?: boolean } = {}): Promise<Map<string, ProgramVariant>> {
  const out = new Map<string, ProgramVariant>();
  if (programIds.filter((id) => UUID.test(id)).length === 0) return out;
  try {
    const found = await rows<{ id: string; program_id: string; key: string; name: string; sku: string | null; color: string | null; position: string; status: string; deleted: boolean; material_cost_per_unit: string | null }>(
      siblingDb,
      sql`select v.id::text as id, v.program_id::text as program_id, v.key, v.name, v.sku, v.color, v.position, v.status,
                 (v.deleted_at is not null) as deleted, v.material_cost_per_unit::text as material_cost_per_unit
            from pm.program_variants v
           where v.org_id = ${ctx.orgId}::uuid and v.program_id in (${uuidList(programIds)})
           order by v.position, v.name`,
    );
    for (const row of found) {
      out.set(row.id, {
        id: row.id,
        programId: row.program_id,
        key: row.key,
        name: row.name,
        sku: row.sku,
        color: row.color,
        position: row.position,
        retired: row.status === 'retired',
        deleted: Boolean(row.deleted),
        materialCostPerUnit: row.material_cost_per_unit,
      });
    }
  } catch (error) {
    logSoftFail(ctx.orgId, 'programs.programVariants', error);
    if (options.throwOnError) throw error;
  }
  return out;
});

/** Non build tasks of a program (prep work), for per task labor rows. Strict. */
export const prepTaskIds = scoped(async function prepTaskIds(ctx: DomainContext, programId: string): Promise<string[]> {
  if (!UUID.test(programId)) return [];
  const found = await rows<{ id: string }>(
    siblingDb,
    sql`select t.id::text as id from pm.tasks t where t.org_id = ${ctx.orgId}::uuid and t.project_id = ${programId}::uuid and t.kind <> 'build' and t.deleted_at is null`,
  );
  return found.map((row) => row.id);
});

/* ------------------------------------------------------------ money reads */

/** Stored money of one program month: output snapshots and posted fees. Strict. */
export const programMonth = scoped(async function programMonth(ctx: DomainContext, programId: string, month: IsoMonth): Promise<ProgramMonthRead> {
  return readProgramMonth(shared, ctx.orgId, programId, month);
});

/** Live output of builds in a date range (builds billed on their own, outside a program). Strict. */
export const buildOutput = scoped(async function buildOutput(ctx: DomainContext, buildIds: readonly string[], range: { from: IsoDate; to: IsoDate }): Promise<OutputRow[]> {
  return readBuildOutput(shared, ctx.orgId, buildIds, range);
});

/** Labor minutes and people per build per day in `timezone`. Strict. */
export const buildHours = scoped(async function buildHours(ctx: DomainContext, input: { buildIds: readonly string[]; timezone: string; from: IsoDate; to: IsoDate }) {
  return loadBuildHoursByDay(shared, ctx.orgId, input);
});

/** Prep task labor per day, per task for `perTaskIds`, folded per program for the rest. Strict. */
export const prepHours = scoped(async function prepHours(ctx: DomainContext, input: { programId: string; timezone: string; from: IsoDate; to: IsoDate; perTaskIds: readonly string[] }) {
  return loadPrepTimeByDay(shared, ctx.orgId, input);
});

/* ------------------------------------------------------------------ picker */

export interface ProgramPick {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly status: string;
  readonly unitPlural: string;
  readonly coreCustomerId: string | null;
  readonly customerName: string | null;
  /** The Pulse job this program already bills to, if any. */
  readonly billsToJobId: string | null;
  readonly path: string;
}

/**
 * Programs for Pulse's "Link a program" picker: live, not archived, in this org. A client hint
 * (`coreCustomerId`) sorts that customer's programs first. Fail soft: an empty list.
 */
export const listProgramsForPicker = scoped(async function listProgramsForPicker(ctx: DomainContext, input: { q?: string | null; coreCustomerId?: string | null } = {}): Promise<ProgramPick[]> {
  if (!(await programsReady(ctx))) return [];
  try {
    const text = (input.q ?? '').trim().slice(0, 80);
    const customer = input.coreCustomerId && UUID.test(input.coreCustomerId) ? input.coreCustomerId : null;
    const found = await rows<{ id: string; key: string; name: string; status: string; unit_plural: string | null; core_customer_id: string | null; customer_name: string | null; job_id: string | null }>(
      siblingDb,
      sql`select p.id::text as id, p.key, p.name, p.status, ps.unit_plural, p.crm_customer_id::text as core_customer_id, c.name as customer_name,
                 (select l.to_id from core.record_links l where l.org_id = p.org_id and l.relation = 'bills_to' and l.from_type = 'pm_program' and l.from_id = p.id::text limit 1) as job_id
            from pm.projects p
            left join pm.program_settings ps on ps.program_id = p.id
            left join core.customers c on c.id = p.crm_customer_id
           where p.org_id = ${ctx.orgId}::uuid and p.kind = 'program' and p.deleted_at is null and p.is_template = false
             and p.status not in ('archived', 'completed')
             and ${text ? sql`(p.name ilike ${`%${text}%`} or p.key ilike ${`${text}%`})` : sql`true`}
           order by ${customer ? sql`(p.crm_customer_id = ${customer}::uuid) desc nulls last,` : sql``} p.name
           limit 30`,
    );
    return found.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      status: row.status,
      unitPlural: row.unit_plural || 'units',
      coreCustomerId: row.core_customer_id,
      customerName: row.customer_name,
      billsToJobId: row.job_id,
      path: `/programs/${encodeURIComponent(row.key)}`,
    }));
  } catch (error) {
    logSoftFail(ctx.orgId, 'programs.listProgramsForPicker', error);
    return [];
  }
});

/**
 * True when the build, or its program, bills to this job (a `bills_to` edge). A typed Pulse line
 * may then be tagged to the build. Fail soft: false.
 */
export const buildBillsToJob = scoped(async function buildBillsToJob(ctx: DomainContext, build: { readonly id: string; readonly programId: string | null }, jobId: string): Promise<boolean> {
  if (!UUID.test(build.id) || !UUID.test(jobId)) return false;
  try {
    const [row] = await rows<{ ok: boolean }>(
      siblingDb,
      sql`select exists (select 1 from core.record_links l
                          where l.org_id = ${ctx.orgId}::uuid and l.relation = 'bills_to' and l.to_type = 'pulse_job' and l.to_id = ${jobId}
                            and ((l.from_type = 'pm_build' and l.from_id = ${build.id})
                              ${build.programId && UUID.test(build.programId) ? sql`or (l.from_type = 'pm_program' and l.from_id = ${build.programId})` : sql``})) as ok`,
    );
    return Boolean(row?.ok);
  } catch (error) {
    logSoftFail(ctx.orgId, 'programs.buildBillsToJob', error);
    return false;
  }
});

/** Live builds of the given programs (ids only), for labor on days with time and no output. Strict. */
export const programBuildIds = scoped(async function programBuildIds(ctx: DomainContext, programIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (programIds.filter((id) => UUID.test(id)).length === 0) return out;
  const found = await rows<{ program_id: string; build_id: string }>(
    siblingDb,
    sql`select b.program_id::text as program_id, b.task_id::text as build_id
          from pm.builds b
          join pm.tasks t on t.id = b.task_id and t.deleted_at is null
          join pm.projects p on p.id = t.project_id and p.deleted_at is null
         where b.org_id = ${ctx.orgId}::uuid and b.program_id in (${uuidList(programIds)})`,
  );
  for (const row of found) out.set(row.program_id, [...(out.get(row.program_id) ?? []), row.build_id]);
  return out;
});
