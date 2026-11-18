/**
 * Stamps and rollups (SPEC 4.3 to 4.9, 4.17, 4.18). Every stream write ends here, inside its own
 * transaction:
 *
 *   1. restamp the touched rows (rate, labor cost, overhead, gross pay, base revenue, material),
 *   2. spread time not on a job over the touched pools (largest remainder, one statement a pool),
 *   3. refresh `company_days`, `fact_days` and `job_stats` for what moved.
 *
 * All money products are computed by Postgres `numeric` math and `round()`, which rounds half
 * away from zero: the same answer as `divRound` in src/lib/money.ts, to the cent. Rates per hour
 * are cents already; per unit prices and costs are currency units, so those products take x 100.
 * Closed months are never touched: every statement filters them out first.
 */
import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import type { Executor } from '@/server/db';
import { poolPeriod } from '@/lib/profit/calendar';
import { monthClosedError, monthStart, rows, uuidArray, type DomainContext } from './_shared';
import { logActivity } from './activity';
import { recomputeJobs } from './job-stats';
import { loadSettings, type SettingsRow } from './settings';

/** What a write moved: jobs, clients with rows that have no job, and (site, day) pairs. */
export interface Touched {
  readonly jobIds: Set<string>;
  readonly clientIds: Set<string>;
  readonly days: Map<string, Set<string>>;
}

export function newTouched(): Touched {
  return { jobIds: new Set(), clientIds: new Set(), days: new Map() };
}

export function touchDay(touched: Touched, siteId: string | null | undefined, date: string | null | undefined): void {
  if (!siteId || !date) return;
  let set = touched.days.get(siteId);
  if (!set) touched.days.set(siteId, (set = new Set()));
  set.add(date);
}

export function touchJob(touched: Touched, jobId: string | null | undefined, clientId?: string | null): void {
  if (jobId) touched.jobIds.add(jobId);
  else if (clientId) touched.clientIds.add(clientId);
}

/** First days of the org's closed months. */
export async function closedMonths(executor: Executor, orgId: string): Promise<Set<string>> {
  const found = await rows<{ m: string }>(executor, sql`select to_char(period_month, 'YYYY-MM-DD') as m from pulse.periods where org_id = ${orgId} and status = 'closed'`);
  return new Set(found.map((row) => row.m));
}

/** Refuses a write dated in a closed month, in the words of SPEC 4.16. */
export async function assertOpen(executor: Executor, orgId: string, dates: readonly (string | null | undefined)[]): Promise<void> {
  const months = [...new Set(dates.filter((date): date is string => Boolean(date)).map(monthStart))];
  if (months.length === 0) return;
  const closed = await closedMonths(executor, orgId);
  const hit = months.filter((month) => closed.has(month)).sort()[0];
  if (hit) throw monthClosedError(hit);
}

/**
 * SQL: the line aliased `alias` belongs to a live job. A deleted job's lines keep their own
 * `deleted_at` empty (so restoring the job brings them back), and this guard keeps them out of
 * every rollup, the same way `v_facts` does. VAS lines with no job always count.
 */
function liveJob(alias: string, jobOptional = false): SQL {
  const live = `EXISTS (SELECT 1 FROM pulse.jobs lj WHERE lj.id = ${alias}.job_id AND lj.deleted_at IS NULL)`;
  return sql.raw(jobOptional ? `(${alias}.job_id IS NULL OR ${live})` : live);
}

/** SQL: the row aliased `alias` is dated in an open month. */
function openMonth(alias: string, dateColumn: string): SQL {
  return sql.raw(
    `NOT EXISTS (SELECT 1 FROM pulse.periods pp WHERE pp.org_id = ${alias}.org_id AND pp.status = 'closed' AND pp.period_month = date_trunc('month', ${alias}.${dateColumn})::date)`,
  );
}

/**
 * Restamps live production entries in open months that match `where` (written against alias `src`).
 * Fixed price jobs keep their base revenue here: `restampFixedJob` owns it.
 */
export async function restampProduction(executor: Executor, orgId: string, where: SQL): Promise<number> {
  const result = await executor.execute(sql`
    UPDATE pulse.production_entries p SET
      rate_cents = c.rate_cents, overtime_rate_cents = c.overtime_rate_cents, labor_cost_cents = c.labor,
      overhead_cents = c.overhead, gross_pay_cents = CASE WHEN c.source = 'default' THEN c.labor ELSE c.gross END,
      needs_rate = c.needs_rate, base_revenue_cents = c.base_rev, std_material_cents = c.std_mat, std_scrap_cents = c.std_scrap
    FROM (
      SELECT src.id, r.rate_cents, r.overtime_rate_cents, r.source,
        (round((src.hours - src.overtime_hours) * r.rate_cents) + round(src.overtime_hours * r.overtime_rate_cents))::bigint AS labor,
        round(src.hours * r.overhead_cents)::bigint AS overhead,
        (round((src.hours - src.overtime_hours) * r.wage_cents) + round(src.overtime_hours * r.wage_cents * r.mult))::bigint AS gross,
        (NOT r.found AND src.hours > 0) AS needs_rate,
        CASE j.pricing_model
          WHEN 'per_unit' THEN round(src.units_good * COALESCE(pr.unit_price, 0) * 100)::bigint
          WHEN 'hourly' THEN round(src.hours * COALESCE(pr.bill_rate_cents, r.bill_rate_cents, 0))::bigint
          ELSE src.base_revenue_cents END AS base_rev,
        CASE WHEN j.material_method = 'standard' THEN round((src.units_good + src.units_scrap) * COALESCE(pr.material_cost_per_unit, 0) * 100)::bigint ELSE 0 END AS std_mat,
        CASE WHEN j.material_method = 'standard' THEN round(src.units_scrap * COALESCE(pr.material_cost_per_unit, 0) * 100)::bigint ELSE 0 END AS std_scrap
      FROM pulse.production_entries src
      JOIN pulse.jobs j ON j.id = src.job_id
      CROSS JOIN LATERAL pulse.rate_for(src.org_id, src.labor_class_id, src.site_id, src.work_date) r
      LEFT JOIN LATERAL (
        SELECT jp.unit_price, jp.bill_rate_cents, jp.material_cost_per_unit FROM pulse.job_prices jp
         WHERE jp.job_id = j.id AND jp.effective_from <= src.work_date ORDER BY jp.effective_from DESC LIMIT 1
      ) pr ON true
      WHERE src.org_id = ${orgId} AND src.deleted_at IS NULL AND (${where}) AND ${openMonth('src', 'work_date')}
    ) c
    WHERE p.id = c.id`);
  return result.rowCount ?? 0;
}

export async function restampIndirect(executor: Executor, orgId: string, where: SQL): Promise<number> {
  const result = await executor.execute(sql`
    UPDATE pulse.indirect_entries p SET
      rate_cents = c.rate_cents, overtime_rate_cents = c.overtime_rate_cents, cost_cents = c.labor,
      overhead_cents = c.overhead, gross_pay_cents = CASE WHEN c.source = 'default' THEN c.labor ELSE c.gross END, needs_rate = c.needs_rate
    FROM (
      SELECT src.id, r.rate_cents, r.overtime_rate_cents, r.source,
        (round((src.hours - src.overtime_hours) * r.rate_cents) + round(src.overtime_hours * r.overtime_rate_cents))::bigint AS labor,
        round(src.hours * r.overhead_cents)::bigint AS overhead,
        (round((src.hours - src.overtime_hours) * r.wage_cents) + round(src.overtime_hours * r.wage_cents * r.mult))::bigint AS gross,
        (NOT r.found AND src.hours > 0) AS needs_rate
      FROM pulse.indirect_entries src
      CROSS JOIN LATERAL pulse.rate_for(src.org_id, src.labor_class_id, src.site_id, src.work_date) r
      WHERE src.org_id = ${orgId} AND src.deleted_at IS NULL AND (${where}) AND ${openMonth('src', 'work_date')}
    ) c
    WHERE p.id = c.id`);
  return result.rowCount ?? 0;
}

export async function restampVas(executor: Executor, orgId: string, where: SQL): Promise<number> {
  const result = await executor.execute(sql`
    UPDATE pulse.vas_entries p SET
      rate_cents = c.rate_cents, overtime_rate_cents = c.overtime_rate_cents, labor_cost_cents = c.labor,
      overhead_cents = c.overhead, gross_pay_cents = CASE WHEN c.source = 'default' THEN c.labor ELSE c.gross END, needs_rate = c.needs_rate
    FROM (
      SELECT src.id, r.rate_cents, r.overtime_rate_cents, r.source,
        (round((src.hours - src.overtime_hours) * r.rate_cents) + round(src.overtime_hours * r.overtime_rate_cents))::bigint AS labor,
        round(src.hours * r.overhead_cents)::bigint AS overhead,
        (round((src.hours - src.overtime_hours) * r.wage_cents) + round(src.overtime_hours * r.wage_cents * r.mult))::bigint AS gross,
        (NOT r.found AND src.hours > 0) AS needs_rate
      FROM pulse.vas_entries src
      CROSS JOIN LATERAL pulse.rate_for(src.org_id, src.labor_class_id, src.site_id, src.work_date) r
      WHERE src.org_id = ${orgId} AND src.deleted_at IS NULL AND (${where}) AND ${openMonth('src', 'work_date')}
    ) c
    WHERE p.id = c.id`);
  return result.rowCount ?? 0;
}

/** Who buys the parts, then the cost of what we buy (SPEC 4.6). */
export async function restampUsage(executor: Executor, orgId: string, where: SQL): Promise<number> {
  const result = await executor.execute(sql`
    UPDATE pulse.material_usage p SET
      resolved_supplied_by = c.owner,
      cost_cents = CASE WHEN c.owner = 'us' THEN round((c.quantity_used + c.quantity_scrapped) * c.unit_cost * 100)::bigint ELSE 0 END,
      scrap_cents = CASE WHEN c.owner = 'us' THEN round(c.quantity_scrapped * c.unit_cost * 100)::bigint ELSE 0 END
    FROM (
      SELECT src.id, src.quantity_used, src.quantity_scrapped, src.unit_cost,
        COALESCE(src.supplied_by, i.supplied_by, j.parts_owner, cl.parts_owner, s.default_parts_owner, 'us') AS owner
      FROM pulse.material_usage src
      JOIN pulse.jobs j ON j.id = src.job_id
      JOIN pulse.clients cl ON cl.id = j.client_id
      LEFT JOIN pulse.items i ON i.id = src.item_id
      LEFT JOIN pulse.settings s ON s.org_id = src.org_id
      WHERE src.org_id = ${orgId} AND src.deleted_at IS NULL AND (${where}) AND ${openMonth('src', 'usage_date')}
    ) c
    WHERE p.id = c.id`);
  return result.rowCount ?? 0;
}

/**
 * Fixed price jobs earn by progress (SPEC 4.8). Restamps every open month entry of the job so
 * the running total of stamps follows `FP x min(units so far, planned) / planned`; stamps in
 * closed months are frozen and count as earlier stamps. Then rebuilds the true up of a completed job.
 * Does nothing for other pricing models.
 */
export async function restampFixedJob(executor: Executor, ctx: DomainContext, jobId: string): Promise<void> {
  const [job] = await rows<{ pricing_model: string; status: string; completed_date: string | null; fixed_price_cents: string | null; client_id: string; site_id: string }>(
    executor,
    sql`select pricing_model, status, to_char(completed_date, 'YYYY-MM-DD') as completed_date, fixed_price_cents, client_id, site_id
          from pulse.jobs where org_id = ${ctx.orgId} and id = ${jobId}`,
  );
  if (!job) return;
  const trueUpRef = `fixed_true_up:${jobId}`;
  if (job.pricing_model !== 'fixed') {
    await executor.execute(sql`
      DELETE FROM pulse.revenue_entries r WHERE r.org_id = ${ctx.orgId} AND r.source = 'system' AND r.source_ref = ${trueUpRef} AND ${openMonth('r', 'revenue_date')}`);
    return;
  }
  await executor.execute(sql`
    WITH e AS (
      SELECT p.id, p.base_revenue_cents AS old,
        EXISTS (SELECT 1 FROM pulse.periods pp WHERE pp.org_id = p.org_id AND pp.status = 'closed' AND pp.period_month = date_trunc('month', p.work_date)::date) AS frozen,
        row_number() OVER w AS k,
        CASE WHEN j.planned_units > 0 AND j.fixed_price_cents IS NOT NULL
             THEN round(j.fixed_price_cents::numeric * LEAST(sum(p.units_good) OVER w, j.planned_units) / j.planned_units)
             ELSE 0 END AS target
      FROM pulse.production_entries p
      JOIN pulse.jobs j ON j.id = p.job_id
      LEFT JOIN pulse.labor_classes lc ON lc.id = p.labor_class_id
      WHERE p.org_id = ${ctx.orgId} AND p.job_id = ${jobId} AND p.deleted_at IS NULL
      WINDOW w AS (ORDER BY p.work_date, p.shift, lc.code NULLS FIRST, p.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    ), f AS (
      SELECT e.*, COALESCE(sum(CASE WHEN e.frozen THEN e.old ELSE 0 END) OVER (ORDER BY e.k ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS frozen_before
      FROM e
    ), o AS (
      SELECT f.id, f.old, f.target, f.frozen_before,
        COALESCE(lag(f.target) OVER (ORDER BY f.k), 0) AS prev_target,
        COALESCE(lag(f.frozen_before) OVER (ORDER BY f.k), 0) AS prev_frozen_before
      FROM f WHERE NOT f.frozen
    )
    UPDATE pulse.production_entries p
       SET base_revenue_cents = (o.target - (o.prev_target + o.frozen_before - o.prev_frozen_before))::bigint
      FROM o
     WHERE p.id = o.id AND p.base_revenue_cents IS DISTINCT FROM (o.target - (o.prev_target + o.frozen_before - o.prev_frozen_before))::bigint`);
  // True up: one system revenue row while the job is completed (never for a cancelled job).
  await executor.execute(sql`
    DELETE FROM pulse.revenue_entries r WHERE r.org_id = ${ctx.orgId} AND r.source = 'system' AND r.source_ref = ${trueUpRef} AND ${openMonth('r', 'revenue_date')}`);
  if (job.status === 'completed' && job.completed_date && job.fixed_price_cents !== null) {
    await assertOpen(executor, ctx.orgId, [job.completed_date]);
    await executor.execute(sql`
      INSERT INTO pulse.revenue_entries (org_id, site_id, job_id, client_id, revenue_date, kind, description, amount_cents, source, source_ref, created_by)
      SELECT ${ctx.orgId}, ${job.site_id}, ${jobId}, ${job.client_id}, ${job.completed_date}::date, 'fixed_true_up', 'Fixed price true up',
             ${job.fixed_price_cents}::bigint - COALESCE((SELECT sum(p.base_revenue_cents) FROM pulse.production_entries p WHERE p.org_id = ${ctx.orgId} AND p.job_id = ${jobId} AND p.deleted_at IS NULL), 0),
             'system', ${trueUpRef}, NULL
       WHERE NOT EXISTS (SELECT 1 FROM pulse.revenue_entries r WHERE r.org_id = ${ctx.orgId} AND r.source = 'system' AND r.source_ref = ${trueUpRef} AND r.deleted_at IS NULL)`);
  }
}

/** Rebuilds `company_days` for one site and a day range from the stream tables (SPEC 4.5, 4.9). */
export async function refreshCompanyDays(executor: Executor, orgId: string, siteId: string, from: string, to: string): Promise<void> {
  await executor.execute(sql`DELETE FROM pulse.company_days WHERE org_id = ${orgId} AND site_id = ${siteId} AND work_date BETWEEN ${from}::date AND ${to}::date`);
  await executor.execute(sql`
    WITH direct AS (
      SELECT work_date, sum(hours) AS h, sum(gross_pay_cents) AS g, sum(overhead_cents) AS o, sum(shared_cents) AS s
        FROM (
          SELECT pe.work_date, pe.hours, pe.gross_pay_cents, pe.overhead_cents, pe.shared_cents FROM pulse.production_entries pe
           WHERE pe.org_id = ${orgId} AND pe.site_id = ${siteId} AND pe.deleted_at IS NULL AND pe.work_date BETWEEN ${from}::date AND ${to}::date AND ${liveJob('pe')}
          UNION ALL
          SELECT ve.work_date, ve.hours, ve.gross_pay_cents, ve.overhead_cents, ve.shared_cents FROM pulse.vas_entries ve
           WHERE ve.org_id = ${orgId} AND ve.site_id = ${siteId} AND ve.deleted_at IS NULL AND ve.work_date BETWEEN ${from}::date AND ${to}::date AND ${liveJob('ve', true)}
        ) u GROUP BY work_date
    ), ind AS (
      SELECT work_date, sum(hours) AS h, sum(cost_cents) AS c, sum(gross_pay_cents) AS g, sum(overhead_cents) AS o
        FROM pulse.indirect_entries
       WHERE org_id = ${orgId} AND site_id = ${siteId} AND deleted_at IS NULL AND work_date BETWEEN ${from}::date AND ${to}::date
       GROUP BY work_date
    ), paid AS (
      SELECT ph.work_date, sum(ph.paid_hours) AS h,
             CASE WHEN bool_and(ph.paid_cents IS NOT NULL) THEN sum(ph.paid_cents) END AS c,
             sum(ph.paid_hours * (r.rate_cents - r.overhead_cents)) AS weighted
        FROM pulse.paid_hours ph
        CROSS JOIN LATERAL pulse.rate_for(ph.org_id, ph.labor_class_id, ph.site_id, ph.work_date) r
       WHERE ph.org_id = ${orgId} AND ph.site_id = ${siteId} AND ph.deleted_at IS NULL AND ph.work_date BETWEEN ${from}::date AND ${to}::date
       GROUP BY ph.work_date
    ), cc AS (
      SELECT c.cost_date AS work_date, sum(c.amount_cents) AS c
        FROM pulse.cost_entries c
       WHERE c.org_id = ${orgId} AND c.scope = 'company' AND c.deleted_at IS NULL AND c.cost_date BETWEEN ${from}::date AND ${to}::date
         AND COALESCE(c.site_id, (SELECT s.id FROM pulse.sites s WHERE s.org_id = ${orgId} AND s.is_default AND s.deleted_at IS NULL LIMIT 1)) = ${siteId}
       GROUP BY c.cost_date
    ), days AS (
      SELECT work_date FROM direct UNION SELECT work_date FROM ind UNION SELECT work_date FROM paid UNION SELECT work_date FROM cc
    ), calc AS (
      SELECT d.work_date,
             COALESCE(direct.h, 0) AS direct_hours, COALESCE(ind.h, 0) AS indirect_hours, COALESCE(paid.h, 0) AS paid_hours,
             GREATEST(0, COALESCE(paid.h, 0) - COALESCE(direct.h, 0) - COALESCE(ind.h, 0)) AS missing_hours,
             COALESCE(ind.c, 0) AS indirect_cents, COALESCE(direct.s, 0) AS shared_applied, paid.c AS paid_cents, paid.weighted,
             COALESCE(direct.g, 0) + COALESCE(ind.g, 0) AS gross, COALESCE(cc.c, 0) AS company_cost,
             COALESCE(direct.o, 0) + COALESCE(ind.o, 0) AS overhead,
             (COALESCE(paid.h, 0) > 0 AND COALESCE(direct.h, 0) + COALESCE(ind.h, 0) > paid.h) AS over_logged
        FROM days d
        LEFT JOIN direct ON direct.work_date = d.work_date
        LEFT JOIN ind ON ind.work_date = d.work_date
        LEFT JOIN paid ON paid.work_date = d.work_date
        LEFT JOIN cc ON cc.work_date = d.work_date
    )
    INSERT INTO pulse.company_days (org_id, site_id, work_date, direct_hours, indirect_hours, paid_hours, missing_hours, indirect_cents,
                                    shared_applied_cents, missing_cents, paid_cents, gross_pay_cents, company_cost_cents, overhead_absorbed_cents, over_logged)
    SELECT ${orgId}, ${siteId}, work_date, direct_hours, indirect_hours, paid_hours, missing_hours, indirect_cents, shared_applied,
           CASE WHEN paid_hours <= 0 OR missing_hours <= 0 THEN 0
                WHEN paid_cents IS NOT NULL THEN round(paid_cents::numeric * missing_hours / paid_hours)::bigint
                ELSE round(missing_hours * weighted / paid_hours)::bigint END,
           paid_cents, gross, company_cost, overhead, over_logged
      FROM calc`);
}

interface PoolMove {
  job_id: string | null;
  client_id: string | null;
  old: string;
  shared: string;
}

/**
 * Spreads one pool (one site, one period inside one month) over its takers and stamps
 * `shared_cents` (SPEC 4.5). Returns the rows whose share moved. Closed pools are skipped.
 */
async function allocatePool(executor: Executor, orgId: string, siteId: string, start: string, end: string, settings: SettingsRow, closed: Set<string>): Promise<PoolMove[]> {
  if (closed.has(monthStart(start))) return [];
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${orgId}:${siteId}:${start}`}))`);
  const range = sql`org_id = ${orgId} AND site_id = ${siteId} AND work_date BETWEEN ${start}::date AND ${end}::date`;
  const rule = settings.sharedCostRule;
  if (rule === 'none' || rule === 'percent_of_labor') {
    const value = rule === 'none' ? sql`0::bigint` : sql`round(labor_cost_cents::numeric * ${settings.sharedPctBp} / 10000)::bigint`;
    const takes = (alias: string, jobOptional: boolean) => sql`${sql.raw(alias)}.deleted_at IS NULL AND ${sql.raw(alias)}.hours > 0 AND ${liveJob(alias, jobOptional)}`;
    const live = (alias: string, jobOptional: boolean) => (rule === 'none' ? sql`0::bigint` : sql`CASE WHEN ${takes(alias, jobOptional)} THEN ${value} ELSE 0::bigint END`);
    const moved: PoolMove[] = [];
    moved.push(
      ...(await rows<PoolMove>(
        executor,
        sql`WITH prev AS (SELECT id, shared_cents AS old FROM pulse.production_entries WHERE ${range})
            UPDATE pulse.production_entries p SET shared_cents = ${live('p', false)} FROM prev
             WHERE p.id = prev.id AND p.shared_cents IS DISTINCT FROM ${live('p', false)}
            RETURNING p.job_id, NULL::uuid AS client_id, prev.old::text AS old, p.shared_cents::text AS shared`,
      )),
    );
    moved.push(
      ...(await rows<PoolMove>(
        executor,
        sql`WITH prev AS (SELECT id, shared_cents AS old FROM pulse.vas_entries WHERE ${range})
            UPDATE pulse.vas_entries p SET shared_cents = ${live('p', true)} FROM prev
             WHERE p.id = prev.id AND p.shared_cents IS DISTINCT FROM ${live('p', true)}
            RETURNING p.job_id, p.client_id, prev.old::text AS old, p.shared_cents::text AS shared`,
      )),
    );
    return moved;
  }
  const [pool] = await rows<{ amt: string }>(
    executor,
    rule === 'full'
      ? sql`SELECT (COALESCE((SELECT sum(cost_cents) FROM pulse.indirect_entries WHERE ${range} AND deleted_at IS NULL), 0)
                  + COALESCE((SELECT sum(missing_cents) FROM pulse.company_days WHERE ${range}), 0))::text AS amt`
      : sql`SELECT COALESCE((SELECT sum(cost_cents) FROM pulse.indirect_entries WHERE ${range} AND deleted_at IS NULL), 0)::text AS amt`,
  );
  const amount = pool?.amt ?? '0';
  return rows<PoolMove>(
    executor,
    sql`
    WITH takers AS (
      SELECT 'p'::text AS t, id, job_id, NULL::uuid AS client_id, work_date, (hours * 100)::numeric AS w, shared_cents AS old,
             (e.deleted_at IS NULL AND e.hours > 0 AND ${liveJob('e')}) AS takes,
             -- What the row is, in words that are the same in every workspace: a file exported from one
             -- workspace and imported into another then spreads the odd cents the same way.
             (COALESCE((SELECT j.number FROM pulse.jobs j WHERE j.id = e.job_id), '') || '|' || e.shift || '|' ||
              COALESCE((SELECT c.code FROM pulse.labor_classes c WHERE c.id = e.labor_class_id), '')) COLLATE "C" AS skey
        FROM pulse.production_entries e WHERE ${range}
      UNION ALL
      SELECT 'v', id, job_id, client_id, work_date, (hours * 100)::numeric, shared_cents, (e.deleted_at IS NULL AND e.hours > 0 AND ${liveJob('e', true)}),
             (COALESCE((SELECT c.code FROM pulse.clients c WHERE c.id = e.client_id), '') || '|' ||
              COALESCE((SELECT s.code FROM pulse.vas_services s WHERE s.id = e.vas_service_id), '') || '|' ||
              COALESCE((SELECT j.number FROM pulse.jobs j WHERE j.id = e.job_id), '') || '|' || e.quantity::text) COLLATE "C"
        FROM pulse.vas_entries e WHERE ${range}
    ), tot AS (
      SELECT COALESCE(sum(w) FILTER (WHERE takes), 0) AS w FROM takers
    ), calc AS (
      SELECT k.*, CASE WHEN k.takes AND tot.w > 0 THEN floor(${amount}::numeric * k.w / tot.w) ELSE 0 END AS base,
             CASE WHEN k.takes AND tot.w > 0 THEN mod(${amount}::numeric * k.w, tot.w) ELSE -1 END AS rem,
             tot.w AS total_w
        FROM takers k CROSS JOIN tot
    ), ranked AS (
      SELECT c.*, row_number() OVER (ORDER BY c.rem DESC, c.work_date, c.t, c.skey, c.id) AS rn,
             CASE WHEN c.total_w > 0 THEN ${amount}::numeric - sum(c.base) OVER () ELSE 0 END AS leftover
        FROM calc c
    ), final AS (
      SELECT t, id, job_id, client_id, old, (base + CASE WHEN takes AND rn <= leftover THEN 1 ELSE 0 END)::bigint AS shared FROM ranked
    ), up_p AS (
      UPDATE pulse.production_entries p SET shared_cents = f.shared FROM final f
       WHERE f.t = 'p' AND p.id = f.id AND p.shared_cents <> f.shared
      RETURNING p.job_id, NULL::uuid AS client_id, f.old::text AS old, f.shared::text AS shared
    ), up_v AS (
      UPDATE pulse.vas_entries v SET shared_cents = f.shared FROM final f
       WHERE f.t = 'v' AND v.id = f.id AND v.shared_cents <> f.shared
      RETURNING v.job_id, v.client_id, f.old::text AS old, f.shared::text AS shared
    )
    SELECT * FROM up_p UNION ALL SELECT * FROM up_v`,
  );
}

/** Rebuilds `fact_days` for the given jobs, and for rows with no job of the given clients. */
export async function refreshFacts(executor: Executor, orgId: string, jobIds: readonly string[], clientIds: readonly string[]): Promise<void> {
  const insert = (where: SQL) => sql`
    INSERT INTO pulse.fact_days (org_id, work_date, site_id, client_id, job_id, job_type_id, vas_service_id, kind, amount_cents, units_good, units_scrap, hours)
    SELECT f.org_id, f.work_date, f.site_id, f.client_id, f.job_id, max(f.job_type_id::text)::uuid, f.vas_service_id, f.kind,
           sum(f.amount_cents), sum(f.units_good), sum(f.units_scrap), sum(f.hours)
      FROM pulse.v_facts f
     WHERE f.org_id = ${orgId} AND ${where}
     GROUP BY f.org_id, f.work_date, f.site_id, f.client_id, f.job_id, f.vas_service_id, f.kind`;
  if (jobIds.length > 0) {
    const ids = uuidArray(jobIds);
    await executor.execute(sql`DELETE FROM pulse.fact_days WHERE org_id = ${orgId} AND job_id = ANY(${ids})`);
    await executor.execute(insert(sql`f.job_id = ANY(${ids})`));
  }
  if (clientIds.length > 0) {
    const ids = uuidArray(clientIds);
    await executor.execute(sql`DELETE FROM pulse.fact_days WHERE org_id = ${orgId} AND job_id IS NULL AND client_id = ANY(${ids})`);
    await executor.execute(insert(sql`f.job_id IS NULL AND f.client_id = ANY(${ids})`));
  }
}

/**
 * The tail of every stream write: shared allocation for the touched pools, then `company_days`,
 * `fact_days` and `job_stats` for everything that moved. When a save on one job moves another
 * job's share by $1.00 or more, that other job gets a `shared.moved` activity row.
 */
export async function finishWrite(executor: Executor, ctx: DomainContext, touched: Touched, options: { settings?: SettingsRow } = {}): Promise<void> {
  const settings = options.settings ?? (await loadSettings(ctx.orgId, executor));
  const closed = await closedMonths(executor, ctx.orgId);
  const direct = new Set(touched.jobIds);
  const pools = new Map<string, { siteId: string; start: string; end: string }>();
  for (const [siteId, dates] of touched.days) {
    for (const date of dates) {
      const period = poolPeriod(date, settings.sharedSpread as 'day' | 'week' | 'month', settings.weekStart);
      pools.set(`${siteId}:${period.start}`, { siteId, start: period.start, end: period.end });
    }
  }
  const movedByJob = new Map<string, { before: bigint; after: bigint }>();
  const ordered = [...pools.values()].sort((a, b) => (a.siteId + a.start).localeCompare(b.siteId + b.start));
  for (const pool of ordered) {
    if (settings.sharedCostRule === 'full') await refreshCompanyDays(executor, ctx.orgId, pool.siteId, pool.start, pool.end);
    const moves = await allocatePool(executor, ctx.orgId, pool.siteId, pool.start, pool.end, settings, closed);
    for (const move of moves) {
      touchJob(touched, move.job_id, move.client_id);
      if (!move.job_id) continue;
      const entry = movedByJob.get(move.job_id) ?? { before: BigInt(0), after: BigInt(0) };
      entry.before += BigInt(move.old);
      entry.after += BigInt(move.shared);
      movedByJob.set(move.job_id, entry);
    }
    await refreshCompanyDays(executor, ctx.orgId, pool.siteId, pool.start, pool.end);
  }
  const jobIds = [...touched.jobIds];
  await refreshFacts(executor, ctx.orgId, jobIds, [...touched.clientIds]);
  if (jobIds.length > 0) await recomputeJobs(executor, ctx, jobIds, { settings });
  const notes = [...movedByJob.entries()]
    .filter(([jobId, move]) => direct.size > 0 && !direct.has(jobId) && (move.after - move.before >= BigInt(100) || move.before - move.after >= BigInt(100)))
    .map(([jobId, move]) => ({ verb: 'shared.moved', entityType: 'job', entityId: jobId, jobId, before: { sharedCents: move.before }, after: { sharedCents: move.after } }));
  if (notes.length > 0) await logActivity(executor, { ...ctx, actorKind: 'system' }, notes);
}

/** Every (site, day) pool of the org that holds live direct or indirect rows in an open month. */
async function allPoolDays(executor: Executor, orgId: string): Promise<{ site_id: string; work_date: string }[]> {
  return rows<{ site_id: string; work_date: string }>(
    executor,
    sql`SELECT DISTINCT site_id, to_char(work_date, 'YYYY-MM-DD') AS work_date FROM (
          SELECT site_id, work_date FROM pulse.production_entries WHERE org_id = ${orgId} AND deleted_at IS NULL
          UNION SELECT site_id, work_date FROM pulse.vas_entries WHERE org_id = ${orgId} AND deleted_at IS NULL
          UNION SELECT site_id, work_date FROM pulse.indirect_entries WHERE org_id = ${orgId} AND deleted_at IS NULL
          UNION SELECT site_id, work_date FROM pulse.paid_hours WHERE org_id = ${orgId} AND deleted_at IS NULL
        ) u`,
  );
}

/**
 * Restamps every open month row of the org and rebuilds every rollup. Used when a setting that
 * feeds the math changes (default rate, shared cost rule, thresholds), by the seed and by tests.
 */
export async function recalcOrg(executor: Executor, ctx: DomainContext, options: { restamp?: boolean } = {}): Promise<{ jobs: number }> {
  const settings = await loadSettings(ctx.orgId, executor);
  if (options.restamp !== false) {
    await restampProduction(executor, ctx.orgId, sql`true`);
    await restampIndirect(executor, ctx.orgId, sql`true`);
    await restampVas(executor, ctx.orgId, sql`true`);
    await restampUsage(executor, ctx.orgId, sql`true`);
    const fixed = await rows<{ id: string }>(executor, sql`select id from pulse.jobs where org_id = ${ctx.orgId} and pricing_model = 'fixed' and deleted_at is null`);
    for (const job of fixed) await restampFixedJob(executor, ctx, job.id);
  }
  const touched = newTouched();
  for (const day of await allPoolDays(executor, ctx.orgId)) touchDay(touched, day.site_id, day.work_date);
  const jobs = await rows<{ id: string }>(executor, sql`select id from pulse.jobs where org_id = ${ctx.orgId}`);
  for (const job of jobs) touched.jobIds.add(job.id);
  const clients = await rows<{ id: string }>(executor, sql`select id from pulse.clients where org_id = ${ctx.orgId}`);
  for (const client of clients) touched.clientIds.add(client.id);
  await executor.execute(sql`DELETE FROM pulse.fact_days WHERE org_id = ${ctx.orgId}`);
  await finishWrite(executor, ctx, touched, { settings });
  return { jobs: jobs.length };
}
