/**
 * CSV out for every stream (SPEC section 7). One statement per stream reads the live rows in the
 * exact columns of the stream's template, with codes instead of ids, so a file you export can be
 * imported back and changes nothing. The import engine reads existing rows through the same
 * function, which is why the round trip is lossless by construction.
 *
 * Money columns are dropped for readers without `money:read` and wage columns for readers
 * without `wage:read`. Every export writes an `export.run` activity row.
 */
import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { forbidden, invalid } from '@/server/errors';
import { type ColumnDef, type LooseRecord, type PlanLayout, anyStreamDef, recordKey } from '@/lib/csv/streams';
import { streamToCsv } from '@/lib/csv/template';
import { exportFileName } from '@/lib/csv/write';
import { STREAMS, STREAM_IDS, isStreamId, streamInfo, type StreamId } from '@/lib/streams';
import { rows, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { logActivity } from './activity';

/** Which rows of a stream to read. Filters that do not apply to a stream are ignored. */
export interface StreamScope {
  readonly from?: string | null;
  readonly to?: string | null;
  readonly clientId?: string | null;
  readonly jobTypeId?: string | null;
  readonly siteId?: string | null;
  /** Job status, for the jobs stream and streams that hang off a job. */
  readonly status?: string | null;
  /** Only these row ids, or rows that came from a file row with one of these ids. */
  readonly ids?: readonly string[];
  /** For quotes and budgets: one row per plan (`totals`) or one row per line (`lines`). */
  readonly layout?: PlanLayout;
  readonly limit?: number;
}

/** One live row of a stream in the shape of its CSV record. */
export interface StreamRow {
  readonly id: string;
  /** Changes when the row is edited (the version, or the last update time). */
  readonly stamp: string;
  /** The id this row had in the file it came from, when it was imported. */
  readonly ref: string | null;
  readonly record: LooseRecord;
}

/** At most this many rows in one exported file (SPEC section 6, "Download everything"). */
export const EXPORT_ROW_CAP = 200_000;

const and = (cond: SQL | null | undefined | false): SQL => (cond ? sql` AND ${cond}` : sql``);

function textArray(values: readonly string[]): SQL {
  if (values.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

const day = (column: string): SQL => sql.raw(`to_char(${column}, 'YYYY-MM-DD')`);

/** The statement that reads one stream. Column aliases are the CSV column keys. */
function streamQuery(stream: StreamId, orgId: string, scope: StreamScope): SQL {
  const limit = sql.raw(String(Math.min(Math.max(scope.limit ?? EXPORT_ROW_CAP, 1), EXPORT_ROW_CAP)));
  const range = (column: string): SQL => sql`${and(scope.from ? sql`${sql.raw(column)} >= ${scope.from}::date` : null)}${and(scope.to ? sql`${sql.raw(column)} <= ${scope.to}::date` : null)}`;
  const only = (alias: string, hasSource = true): SQL =>
    scope.ids
      ? hasSource
        ? sql` AND (${sql.raw(alias)}.id::text = ANY(${textArray(scope.ids)}) OR (${sql.raw(alias)}.source = 'csv' AND ${sql.raw(alias)}.source_ref = ANY(${textArray(scope.ids)})))`
        : sql` AND ${sql.raw(alias)}.id::text = ANY(${textArray(scope.ids)})`
      : sql``;
  const head = (alias: string, hasSource = true): SQL =>
    hasSource
      ? sql.raw(`${alias}.id AS _id, ${alias}.version::text AS _stamp, CASE WHEN ${alias}.source = 'csv' THEN ${alias}.source_ref END AS _ref`)
      : sql.raw(`${alias}.id AS _id, ${alias}.updated_at::text AS _stamp, NULL::text AS _ref`);
  const jobFilters = sql`${and(scope.clientId ? sql`j.client_id = ${scope.clientId}` : null)}${and(scope.jobTypeId ? sql`j.job_type_id = ${scope.jobTypeId}` : null)}${and(scope.status ? sql`j.status = ${scope.status}` : null)}`;
  const siteFilter = (alias: string): SQL => and(scope.siteId ? sql`${sql.raw(alias)}.site_id = ${scope.siteId}` : null);

  switch (stream) {
    case 'clients':
      return sql`
        SELECT ${head('c')}, c.code AS client_code, c.name, c.status, c.contact_name, c.contact_email, c.phone,
               c.target_margin_bp AS target_margin_pct, c.payment_terms_days, c.parts_owner, c.notes
          FROM pulse.clients c
         WHERE c.org_id = ${orgId} AND c.deleted_at IS NULL${and(scope.clientId ? sql`c.id = ${scope.clientId}` : null)}${only('c')}
         ORDER BY lower(c.code) LIMIT ${limit}`;
    case 'job_types':
      return sql`
        SELECT ${head('t', false)}, t.code AS job_type_code, t.name, t.unit_label, t.default_pricing_model, lc.code AS default_labor_class,
               t.default_standard_uph AS default_units_per_labor_hour, t.target_margin_bp AS target_margin_pct
          FROM pulse.job_types t
          LEFT JOIN pulse.labor_classes lc ON lc.id = t.default_labor_class_id
         WHERE t.org_id = ${orgId} AND t.deleted_at IS NULL${and(scope.jobTypeId ? sql`t.id = ${scope.jobTypeId}` : null)}${only('t', false)}
         ORDER BY t.position, lower(t.code) LIMIT ${limit}`;
    case 'jobs':
      return sql`
        SELECT ${head('j')}, j.number AS job_number, j.name, c.code AS client_code, t.code AS job_type_code, s.code AS site_code, j.kind, j.status,
               j.pricing_model, j.unit_label, j.planned_units, j.unit_price, j.fixed_price_cents AS fixed_price, j.bill_rate_cents AS bill_rate_per_hour,
               j.material_method, j.material_cost_per_unit, j.parts_owner, lc.code AS labor_class, j.standard_uph AS units_per_labor_hour_standard,
               j.target_margin_bp AS target_margin_pct, ${day('j.start_date')} AS start_date, ${day('j.due_date')} AS due_date,
               ${day('j.completed_date')} AS completed_date, j.po_number, u.email AS owner_email, j.kit_sku, j.description AS notes,
               (SELECT l.target_id FROM pulse.job_links l WHERE l.job_id = j.id AND l.target_type = 'wms_work_order' ORDER BY l.created_at LIMIT 1) AS wms_work_order,
               (SELECT l.target_id FROM pulse.job_links l WHERE l.job_id = j.id AND l.target_type = 'crm_deal' ORDER BY l.created_at LIMIT 1) AS crm_deal_id,
               (SELECT l.target_id FROM pulse.job_links l WHERE l.job_id = j.id AND l.target_type = 'pm_project' ORDER BY l.created_at LIMIT 1) AS project_key,
               q.units AS quote_units, q.revenue_cents AS quote_revenue, q.labor_hours AS quote_labor_hours, q.labor_cents AS quote_labor_cost,
               q.material_cents AS quote_material_cost, q.other_cents AS quote_other_cost
          FROM pulse.jobs j
          JOIN pulse.clients c ON c.id = j.client_id
          JOIN pulse.job_types t ON t.id = j.job_type_id
          JOIN pulse.sites s ON s.id = j.site_id
          LEFT JOIN pulse.labor_classes lc ON lc.id = j.default_labor_class_id
          LEFT JOIN core."user" u ON u.id = j.owner_id
          LEFT JOIN pulse.job_plans q ON q.job_id = j.id AND q.plan = 'quote'
         WHERE j.org_id = ${orgId} AND j.deleted_at IS NULL${jobFilters}${siteFilter('j')}${only('j')}
               ${and(scope.from ? sql`COALESCE(j.due_date, j.start_date, j.created_at::date) >= ${scope.from}::date` : null)}
               ${and(scope.to ? sql`COALESCE(j.start_date, j.created_at::date) <= ${scope.to}::date` : null)}
         ORDER BY j.number LIMIT ${limit}`;
    case 'job_plans':
      if (scope.layout === 'lines') {
        return sql`
          SELECT l.id AS _id, p.version::text AS _stamp, NULL::text AS _ref, j.number AS job_number, p.plan, l.category, l.description, l.quantity, l.unit,
                 l.unit_amount, l.amount_cents AS amount, lc.code AS labor_class, vs.code AS service_code, i.sku AS item_sku
            FROM pulse.job_plan_lines l
            JOIN pulse.job_plans p ON p.id = l.plan_id
            JOIN pulse.jobs j ON j.id = p.job_id
            LEFT JOIN pulse.labor_classes lc ON lc.id = l.labor_class_id
            LEFT JOIN pulse.vas_services vs ON vs.id = l.vas_service_id
            LEFT JOIN pulse.items i ON i.id = l.item_id
           WHERE l.org_id = ${orgId} AND j.deleted_at IS NULL${jobFilters}${siteFilter('j')}
           ORDER BY j.number, p.plan DESC, l.position, l.created_at LIMIT ${limit}`;
      }
      return sql`
        SELECT p.id AS _id, p.version::text AS _stamp, NULL::text AS _ref, j.number AS job_number, p.plan, p.units, p.revenue_cents AS revenue,
               p.labor_hours, p.labor_cents AS labor_cost, p.setup_hours, p.setup_cents AS setup_cost, p.material_cents AS material_cost, p.other_cents AS other_cost
          FROM pulse.job_plans p
          JOIN pulse.jobs j ON j.id = p.job_id
         WHERE p.org_id = ${orgId} AND j.deleted_at IS NULL${jobFilters}${siteFilter('j')}
         ORDER BY j.number, p.plan DESC LIMIT ${limit}`;
    case 'production':
      return sql`
        SELECT ${head('p')}, p.id::text AS entry_id, ${day('p.work_date')} AS work_date, j.number AS job_number, p.shift, lc.code AS labor_class,
               p.units_good, p.units_scrap, p.units_rework, p.headcount AS people, NULL::text AS hours_each, p.hours AS labor_hours,
               p.overtime_hours, p.setup_hours, p.note
          FROM pulse.production_entries p
          JOIN pulse.jobs j ON j.id = p.job_id
          LEFT JOIN pulse.labor_classes lc ON lc.id = p.labor_class_id
         WHERE p.org_id = ${orgId} AND p.deleted_at IS NULL${range('p.work_date')}${jobFilters}${siteFilter('p')}${only('p')}
         ORDER BY p.work_date, j.number, p.shift, lc.code NULLS FIRST, p.id LIMIT ${limit}`;
    case 'labor_rates':
      return sql`
        SELECT ${head('r')}, lc.code AS labor_class_code, lc.name AS labor_class_name, lc.kind, s.code AS site_code, ${day('r.effective_from')} AS effective_from,
               r.wage_cents AS wage_per_hour, r.payroll_tax_bp AS payroll_tax_pct, r.benefits_bp AS benefits_pct, r.other_burden_bp AS other_burden_pct,
               r.overhead_per_hour_cents AS overhead_per_hour, r.overtime_multiplier, r.bill_rate_cents AS bill_rate_per_hour, r.note
          FROM pulse.labor_rates r
          JOIN pulse.labor_classes lc ON lc.id = r.labor_class_id
          LEFT JOIN pulse.sites s ON s.id = r.site_id
         WHERE r.org_id = ${orgId} AND r.deleted_at IS NULL${and(scope.siteId ? sql`(r.site_id = ${scope.siteId} OR r.site_id IS NULL)` : null)}${only('r')}
         ORDER BY lower(lc.code), s.code NULLS FIRST, r.effective_from LIMIT ${limit}`;
    case 'indirect_time':
      return sql`
        SELECT ${head('e')}, e.id::text AS entry_id, ${day('e.work_date')} AS work_date, s.code AS site_code, lc.code AS labor_class, e.reason,
               e.headcount AS people, e.hours AS labor_hours, e.overtime_hours, e.note
          FROM pulse.indirect_entries e
          JOIN pulse.sites s ON s.id = e.site_id
          LEFT JOIN pulse.labor_classes lc ON lc.id = e.labor_class_id
         WHERE e.org_id = ${orgId} AND e.deleted_at IS NULL${range('e.work_date')}${siteFilter('e')}${only('e')}
         ORDER BY e.work_date, s.code, e.created_at, e.id LIMIT ${limit}`;
    case 'paid_hours':
      return sql`
        SELECT ${head('h')}, ${day('h.work_date')} AS work_date, s.code AS site_code, lc.code AS labor_class, h.paid_hours, h.paid_cents AS paid_amount
          FROM pulse.paid_hours h
          JOIN pulse.sites s ON s.id = h.site_id
          LEFT JOIN pulse.labor_classes lc ON lc.id = h.labor_class_id
         WHERE h.org_id = ${orgId} AND h.deleted_at IS NULL${range('h.work_date')}${siteFilter('h')}${only('h')}
         ORDER BY h.work_date, s.code, lc.code NULLS FIRST LIMIT ${limit}`;
    case 'time_punches':
      return sql`
        SELECT ${head('t')}, t.id::text AS entry_id, t.employee_code AS employee_id, t.employee_name, ${day('t.work_date')} AS work_date, s.code AS site_code,
               j.number AS job_number, t.reason, lc.code AS labor_class, t.hours, t.overtime_hours, t.pay_cents AS pay_amount
          FROM pulse.time_punches t
          JOIN pulse.sites s ON s.id = t.site_id
          LEFT JOIN pulse.jobs j ON j.id = t.job_id
          LEFT JOIN pulse.labor_classes lc ON lc.id = t.labor_class_id
         WHERE t.org_id = ${orgId} AND t.deleted_at IS NULL${range('t.work_date')}${siteFilter('t')}${only('t')}
               ${and(scope.clientId ? sql`j.client_id = ${scope.clientId}` : null)}
         ORDER BY t.work_date, t.employee_code, j.number NULLS LAST, t.id LIMIT ${limit}`;
    case 'materials':
      return sql`
        SELECT ${head('m')}, m.id::text AS entry_id, ${day('m.usage_date')} AS usage_date, j.number AS job_number, m.item_sku, m.item_name, m.quantity_used,
               m.quantity_scrapped, m.quantity_planned, m.unit_cost, m.uom, m.lot, m.supplied_by, m.note
          FROM pulse.material_usage m
          JOIN pulse.jobs j ON j.id = m.job_id
         WHERE m.org_id = ${orgId} AND m.deleted_at IS NULL${range('m.usage_date')}${jobFilters}${siteFilter('m')}${only('m')}
         ORDER BY m.usage_date, j.number, m.item_sku, m.id LIMIT ${limit}`;
    case 'items':
      return sql`
        SELECT ${head('i')}, i.sku AS item_sku, i.name, i.uom, i.unit_cost, i.supplied_by, c.code AS client_code
          FROM pulse.items i
          LEFT JOIN pulse.clients c ON c.id = i.client_id
         WHERE i.org_id = ${orgId} AND i.deleted_at IS NULL${and(scope.clientId ? sql`i.client_id = ${scope.clientId}` : null)}${only('i')}
         ORDER BY lower(i.sku) LIMIT ${limit}`;
    case 'costs':
      return sql`
        SELECT ${head('e')}, e.id::text AS entry_id, ${day('e.cost_date')} AS cost_date, j.number AS job_number,
               CASE WHEN e.scope = 'client' THEN c.code END AS client_code, CASE WHEN e.scope = 'company' THEN s.code END AS site_code,
               e.category, e.amount_cents AS amount, e.vendor, e.reference, e.note
          FROM pulse.cost_entries e
          LEFT JOIN pulse.jobs j ON j.id = e.job_id
          LEFT JOIN pulse.clients c ON c.id = e.client_id
          LEFT JOIN pulse.sites s ON s.id = e.site_id
         WHERE e.org_id = ${orgId} AND e.deleted_at IS NULL${range('e.cost_date')}${only('e')}
               ${and(scope.clientId ? sql`e.client_id = ${scope.clientId}` : null)}${and(scope.jobTypeId ? sql`j.job_type_id = ${scope.jobTypeId}` : null)}
               ${and(scope.status ? sql`j.status = ${scope.status}` : null)}${and(scope.siteId ? sql`e.site_id = ${scope.siteId}` : null)}
         ORDER BY e.cost_date, e.created_at, e.id LIMIT ${limit}`;
    case 'revenue':
      return sql`
        SELECT ${head('e')}, e.id::text AS entry_id, ${day('e.revenue_date')} AS revenue_date, j.number AS job_number,
               CASE WHEN e.job_id IS NULL THEN c.code END AS client_code, e.kind, e.description, e.quantity, e.unit_price, e.amount_cents AS amount,
               e.invoice_number, vs.code AS service_code, e.note
          FROM pulse.revenue_entries e
          JOIN pulse.clients c ON c.id = e.client_id
          LEFT JOIN pulse.jobs j ON j.id = e.job_id
          LEFT JOIN pulse.vas_services vs ON vs.id = e.vas_service_id
         WHERE e.org_id = ${orgId} AND e.deleted_at IS NULL AND e.kind <> 'fixed_true_up'${range('e.revenue_date')}${only('e')}
               ${and(scope.clientId ? sql`e.client_id = ${scope.clientId}` : null)}${and(scope.jobTypeId ? sql`j.job_type_id = ${scope.jobTypeId}` : null)}
               ${and(scope.status ? sql`j.status = ${scope.status}` : null)}${siteFilter('e')}
         ORDER BY e.revenue_date, e.created_at, e.id LIMIT ${limit}`;
    case 'services':
      return sql`
        SELECT ${head('v')}, v.code AS service_code, v.name, v.unit_label, v.billing, v.default_price, v.default_cost_per_unit,
               v.standard_uph AS units_per_labor_hour_standard, lc.code AS labor_class, v.active
          FROM pulse.vas_services v
          LEFT JOIN pulse.labor_classes lc ON lc.id = v.default_labor_class_id
         WHERE v.org_id = ${orgId} AND v.deleted_at IS NULL${only('v')}
         ORDER BY lower(v.code) LIMIT ${limit}`;
    case 'services_done':
      return sql`
        SELECT ${head('e')}, e.id::text AS entry_id, ${day('e.work_date')} AS work_date, c.code AS client_code, j.number AS job_number, vs.code AS service_code,
               e.quantity, e.unit_price, e.amount_cents AS amount, lc.code AS labor_class, e.headcount AS people, e.hours AS labor_hours, e.overtime_hours,
               e.material_cents AS material_cost, e.note
          FROM pulse.vas_entries e
          JOIN pulse.clients c ON c.id = e.client_id
          JOIN pulse.vas_services vs ON vs.id = e.vas_service_id
          LEFT JOIN pulse.jobs j ON j.id = e.job_id
          LEFT JOIN pulse.labor_classes lc ON lc.id = e.labor_class_id
         WHERE e.org_id = ${orgId} AND e.deleted_at IS NULL${range('e.work_date')}${only('e')}
               ${and(scope.clientId ? sql`e.client_id = ${scope.clientId}` : null)}${and(scope.jobTypeId ? sql`j.job_type_id = ${scope.jobTypeId}` : null)}${siteFilter('e')}
         ORDER BY e.work_date, c.code, vs.code, e.id LIMIT ${limit}`;
    case 'target_pace':
      return sql`
        SELECT ${head('t')}, jt.code AS job_type_code, vs.code AS service_code, c.code AS client_code, lc.code AS labor_class, t.units_per_labor_hour,
               ${day('t.effective_from')} AS effective_from, t.note
          FROM pulse.standards t
          LEFT JOIN pulse.job_types jt ON jt.id = t.job_type_id
          LEFT JOIN pulse.vas_services vs ON vs.id = t.vas_service_id
          LEFT JOIN pulse.clients c ON c.id = t.client_id
          LEFT JOIN pulse.labor_classes lc ON lc.id = t.labor_class_id
         WHERE t.org_id = ${orgId} AND t.deleted_at IS NULL${only('t')}
               ${and(scope.clientId ? sql`t.client_id = ${scope.clientId}` : null)}${and(scope.jobTypeId ? sql`t.job_type_id = ${scope.jobTypeId}` : null)}
         ORDER BY jt.code NULLS LAST, vs.code NULLS LAST, c.code NULLS FIRST, lc.code NULLS FIRST, t.effective_from LIMIT ${limit}`;
    case 'goals':
      return sql`
        SELECT ${head('g')}, CASE WHEN g.scope = 'vas_service' THEN 'service' ELSE g.scope END AS scope,
               COALESCE(s.code, c.code, jt.code, vs.code) AS scope_code, g.metric, to_char(g.period_month, 'YYYY-MM') AS month, g.value
          FROM pulse.targets g
          LEFT JOIN pulse.sites s ON g.scope = 'site' AND s.id = g.scope_id
          LEFT JOIN pulse.clients c ON g.scope = 'client' AND c.id = g.scope_id
          LEFT JOIN pulse.job_types jt ON g.scope = 'job_type' AND jt.id = g.scope_id
          LEFT JOIN pulse.vas_services vs ON g.scope = 'vas_service' AND vs.id = g.scope_id
         WHERE g.org_id = ${orgId} AND g.deleted_at IS NULL${only('g')}
               ${and(scope.from ? sql`(g.period_month IS NULL OR g.period_month >= date_trunc('month', ${scope.from}::date))` : null)}
               ${and(scope.to ? sql`(g.period_month IS NULL OR g.period_month <= ${scope.to}::date)` : null)}
         ORDER BY g.scope, scope_code NULLS FIRST, g.metric, g.period_month NULLS FIRST LIMIT ${limit}`;
  }
}

/** Turns one database value into the typed value of its CSV column. */
function typed(column: ColumnDef, value: unknown): LooseRecord[string] {
  if (value === null || value === undefined) return null;
  switch (column.type) {
    case 'money':
      return BigInt(String(value));
    case 'percent':
    case 'integer':
      return Number(value);
    case 'boolean':
      return value === true || value === 't' || value === 'true';
    default:
      return String(value);
  }
}

/** The live rows of a stream as CSV shaped records. Runs inside `executor` (a transaction or the pool). */
export async function loadStreamRows(executor: Executor, orgId: string, stream: StreamId, scope: StreamScope = {}): Promise<StreamRow[]> {
  const def = anyStreamDef(stream);
  const found = await rows<Record<string, unknown>>(executor, streamQuery(stream, orgId, scope));
  return found.map((row) => {
    const record: LooseRecord = {};
    for (const column of def.columns) record[recordKey(column.key)] = column.key in row ? typed(column, row[column.key]) : null;
    return { id: String(row._id), stamp: String(row._stamp ?? ''), ref: row._ref === null || row._ref === undefined ? null : String(row._ref), record };
  });
}

export interface ExportFilters extends StreamScope {
  /** Leave money columns out even for a reader who may see them. */
  readonly hideMoney?: boolean;
}

export interface ExportFile {
  readonly stream: StreamId;
  readonly fileName: string;
  readonly csv: string;
  readonly rowCount: number;
  /** True when the file was cut at the row cap. */
  readonly cut: boolean;
  readonly withMoney: boolean;
}

async function buildExport(ctx: DomainContext, stream: StreamId, filters: ExportFilters, access: { seesMoney: boolean; seesWages: boolean }): Promise<ExportFile> {
  const info = streamInfo(stream)!;
  const canSeeMoney = access.seesMoney && !filters.hideMoney;
  const canSeeWages = access.seesWages && !filters.hideMoney;
  if (stream === 'labor_rates' && !canSeeMoney) throw forbidden('Labor rates are money. Ask an admin to let you see money, then export again.');
  const found = await loadStreamRows(db, ctx.orgId, stream, { ...filters, limit: EXPORT_ROW_CAP });
  const layout = stream === 'job_plans' ? (filters.layout ?? 'totals') : undefined;
  const csv = streamToCsv(
    stream,
    found.map((row) => row.record),
    { canSeeMoney, canSeeWages, layout },
  );
  const base = exportFileName(info.file.replace(/\.csv$/, ''), ctx.orgSlug, filters.from, filters.to);
  return { stream, fileName: layout === 'lines' ? base.replace(/\.csv$/, '-lines.csv') : base, csv, rowCount: found.length, cut: found.length >= EXPORT_ROW_CAP, withMoney: canSeeMoney };
}

/** One stream as a CSV file in the columns of its template. */
export async function exportStream(ctx: DomainContext, stream: string, filters: ExportFilters = {}): Promise<ExportFile> {
  const access = await requirePulse(ctx, 'export:run');
  if (!isStreamId(stream)) throw invalid(`There is no kind of data called ${stream}. Pick one of: ${STREAM_IDS.join(', ')}.`);
  if (filters.from && filters.to && filters.to < filters.from) throw invalid('The end date is before the start date.');
  const file = await buildExport(ctx, stream, filters, access);
  await logActivity(db, ctx, { verb: 'export.run', entityType: 'export', meta: { stream, rows: file.rowCount, withMoney: file.withMoney, from: filters.from ?? null, to: filters.to ?? null, fileName: file.fileName } });
  return file;
}

/** Every stream the reader may export, for the "Download everything" zip. Streams with no rows are left out. */
export async function exportEverything(ctx: DomainContext, filters: ExportFilters = {}): Promise<ExportFile[]> {
  const access = await requirePulse(ctx, 'export:run');
  if (filters.from && filters.to && filters.to < filters.from) throw invalid('The end date is before the start date.');
  const files: ExportFile[] = [];
  for (const info of STREAMS) {
    if (info.id === 'labor_rates' && !(access.seesMoney && !filters.hideMoney)) continue;
    const file = await buildExport(ctx, info.id, filters, access);
    if (file.rowCount > 0) files.push(file);
  }
  await logActivity(db, ctx, { verb: 'export.run', entityType: 'export', meta: { stream: 'everything', files: files.length, rows: files.reduce((sum, file) => sum + file.rowCount, 0), withMoney: access.seesMoney && !filters.hideMoney, from: filters.from ?? null, to: filters.to ?? null } });
  return files;
}

export interface StreamCountDTO {
  readonly stream: StreamId;
  readonly rows: number;
}

const COUNT_TABLES: Readonly<Record<StreamId, string>> = {
  clients: 'clients',
  job_types: 'job_types',
  jobs: 'jobs',
  job_plans: 'job_plans',
  production: 'production_entries',
  labor_rates: 'labor_rates',
  indirect_time: 'indirect_entries',
  paid_hours: 'paid_hours',
  time_punches: 'time_punches',
  materials: 'material_usage',
  items: 'items',
  costs: 'cost_entries',
  revenue: 'revenue_entries',
  services: 'vas_services',
  services_done: 'vas_entries',
  target_pace: 'standards',
  goals: 'targets',
};

/** How many live rows each stream holds, for the export page and the import cards. */
export async function countStreamRows(ctx: DomainContext): Promise<StreamCountDTO[]> {
  await requirePulse(ctx, 'pulse:read');
  const parts = STREAM_IDS.map((id) => {
    const table = COUNT_TABLES[id];
    const live = id === 'job_plans' ? '' : ' AND deleted_at IS NULL';
    const extra = id === 'revenue' ? " AND kind <> 'fixed_true_up'" : '';
    return sql`SELECT ${id}::text AS stream, count(*)::int AS n FROM pulse.${sql.raw(table)} WHERE org_id = ${ctx.orgId}${sql.raw(live)}${sql.raw(extra)}`;
  });
  const found = await rows<{ stream: StreamId; n: number }>(db, sql.join(parts, sql` UNION ALL `));
  const byId = new Map(found.map((row) => [row.stream, row.n]));
  return STREAM_IDS.map((stream) => ({ stream, rows: byId.get(stream) ?? 0 }));
}
