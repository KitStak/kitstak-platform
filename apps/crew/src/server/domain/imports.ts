/**
 * The import center with the People stream (docs/crew/SPEC.md section 7, the Pulse engine rules):
 *
 *   1. `createImportBatch`  the browser parsed the file and mapped its headers; a batch is made.
 *   2. `addImportRows`      raw rows arrive in chunks (`POST /api/v1/import/[batchId]/rows`).
 *   3. `checkImport`        every row is read, matched and checked: create, update, unchanged,
 *                           looks the same, or an error with a plain message on the exact cell.
 *   4. `commitImport`       all or nothing, or skip bad rows. Runs the check again inside the
 *                           transaction, so what is written is what was checked against now.
 *   5. `undoImport`         for 7 days: made people are removed, changed people go back.
 *
 * Rows match by `employee_number`, else `(agency, agency_person_id)`, else the exact name with the
 * agency, which is only flagged "looks the same" and skipped. Pay columns need `pay:manage` and
 * emergency columns `person:private_read`, else those cells are refused. A file never sets a PIN.
 */
import 'server-only';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { user, vendors } from '@kitstak/db/schema';
import { db, type Executor, type Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { areas, importBatches, importRows, laborClasses, people, personPay, personPrivate, personWages, sites } from '@/server/db/schema';
import { conflict, invalid, notFound } from '@/server/errors';
import { canCrew } from '@/lib/permissions';
import { centsToDecimal } from '@/lib/money';
import { toCsv } from '@/lib/csv/write';
import { PEOPLE_COLUMN_KEYS, PEOPLE_COLUMNS, readPeopleRow, type CellIssue, type PeopleColumnKey, type PeopleRowValues, type PersonKind } from '@/lib/csv/people';
import { accessDenied, crewAccessFor, type CrewAccess } from './access';
import { inTx, isUuid, todayInZone, type DomainContext } from './_shared';
import { logActivity } from './activity';
import { hashBadge } from './pins';
import { loadPeopleFile, type PersonFileRow } from './people-file';
import { redactCells } from './people-dto';
import { siteInScope, sightOf, writePerson, type PersonInput } from './people';
import { upsertVendorKind } from './vendors';

export const IMPORT_STREAMS = ['people', 'certifications', 'skills', 'time_off_balances', 'plan_inputs'] as const;
export type ImportStream = (typeof IMPORT_STREAMS)[number];
/** Streams that work in this phase. The others arrive with their phases. */
export const LIVE_STREAMS: readonly ImportStream[] = ['people'];

export const MAX_IMPORT_ROWS = 5000;
export const MAX_CHUNK_ROWS = 1000;
export const UNDO_DAYS = 7;

export interface ImportOptions {
  /** `all`: nothing is written when any row has an error. `skip`: good rows are written. */
  readonly mode: 'all' | 'skip';
  /** Make numbers for temps with no employee number (SPEC 7). */
  readonly makeNumbers: boolean;
  /** Make an agency for a name Crew does not know yet. */
  readonly makeAgencies: boolean;
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = { mode: 'all', makeNumbers: true, makeAgencies: true };

function readOptions(raw: unknown): ImportOptions {
  const value = (raw ?? {}) as Partial<ImportOptions>;
  return {
    mode: value.mode === 'skip' ? 'skip' : 'all',
    makeNumbers: value.makeNumbers !== false,
    makeAgencies: value.makeAgencies !== false,
  };
}

async function requireImport(ctx: DomainContext): Promise<CrewAccess> {
  const access = await crewAccessFor(ctx);
  if (!canCrew(access.role, 'import:run')) throw accessDenied(access.role);
  return access;
}

/* 1 and 2: the batch and its raw rows ---------------------------------------------------------- */

export interface NewBatchInput {
  readonly stream: ImportStream;
  readonly fileName: string;
  readonly fileSize: number;
  readonly fileHash?: string | null;
  readonly delimiter?: string | null;
  readonly headers: readonly string[];
  /** For each header position, the column it feeds, or null to ignore it. */
  readonly columns: readonly (string | null)[];
  readonly options?: Partial<ImportOptions>;
}

export const createImportBatch = scoped(async function createImportBatch(ctx: DomainContext, input: NewBatchInput): Promise<{ readonly id: string }> {
  await requireImport(ctx);
  if (!LIVE_STREAMS.includes(input.stream)) throw invalid('That file type arrives in a later phase.');
  if (input.headers.length !== input.columns.length) throw invalid('The column mapping does not match the file.');
  const keys = new Set<string>(PEOPLE_COLUMN_KEYS);
  const used = new Set<string>();
  for (const column of input.columns) {
    if (column === null) continue;
    if (!keys.has(column)) throw invalid(`${column} is not a column of the People file.`);
    if (used.has(column)) throw invalid(`Two headers feed ${column}. Pick one.`);
    used.add(column);
  }
  for (const needed of PEOPLE_COLUMNS.filter((column) => column.required)) {
    if (!used.has(needed.key)) throw invalid(`The file needs a ${needed.label} column.`);
  }
  const [made] = await db
    .insert(importBatches)
    .values({
      orgId: ctx.orgId,
      stream: input.stream,
      fileName: input.fileName.slice(0, 200),
      fileSize: input.fileSize,
      fileHash: input.fileHash ?? null,
      delimiter: input.delimiter ?? null,
      header: [...input.headers],
      mapping: { columns: [...input.columns] },
      options: { ...DEFAULT_IMPORT_OPTIONS, ...input.options },
      createdBy: ctx.userId,
    })
    .returning({ id: importBatches.id });
  return { id: made!.id };
});

async function loadBatch(executor: Executor, ctx: DomainContext, batchId: string) {
  if (!isUuid(batchId)) throw notFound('That import');
  const [batch] = await executor.select().from(importBatches).where(and(eq(importBatches.orgId, ctx.orgId), eq(importBatches.id, batchId)));
  if (!batch) throw notFound('That import');
  return batch;
}

export interface RawRowInput {
  readonly rowNumber: number;
  readonly cells: readonly string[];
}

/** Stores one chunk of raw rows, keyed by column through the batch mapping. */
export const addImportRows = scoped(async function addImportRows(ctx: DomainContext, batchId: string, rows: readonly RawRowInput[]): Promise<{ readonly total: number }> {
  await requireImport(ctx);
  if (rows.length === 0) throw invalid('The chunk has no rows.');
  if (rows.length > MAX_CHUNK_ROWS) throw invalid(`Send up to ${MAX_CHUNK_ROWS} rows at a time.`);
  return inTx(async (tx) => {
    const batch = await loadBatch(tx, ctx, batchId);
    if (batch.status !== 'uploading') throw conflict('This import already has all its rows.');
    const columns = ((batch.mapping as { columns?: (string | null)[] } | null)?.columns ?? []) as (string | null)[];
    if (batch.totalRows + rows.length > MAX_IMPORT_ROWS) throw invalid(`A file can have up to ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows.`);
    await tx.insert(importRows).values(
      rows.map((row) => {
        const raw: Record<string, string> = {};
        columns.forEach((column, index) => {
          if (column) raw[column] = String(row.cells[index] ?? '').slice(0, 2000);
        });
        return { orgId: ctx.orgId, batchId, rowNumber: row.rowNumber, raw };
      }),
    );
    const [updated] = await tx
      .update(importBatches)
      .set({ totalRows: sql`${importBatches.totalRows} + ${rows.length}`, updatedAt: new Date() })
      .where(and(eq(importBatches.orgId, ctx.orgId), eq(importBatches.id, batchId)))
      .returning({ total: importBatches.totalRows });
    return { total: updated!.total };
  });
});

/* 3: the check ---------------------------------------------------------------------------------- */

export type RowAction = 'create' | 'update' | 'unchanged' | 'lookalike' | 'error';

interface Lookups {
  readonly defaultSiteId: string;
  readonly sites: Map<string, { id: string; timezone: string }>;
  readonly areas: Map<string, string>;
  readonly classes: Map<string, string>;
  readonly agencies: Map<string, string>;
  readonly vendorsAny: Map<string, string>;
  readonly file: PersonFileRow[];
  readonly byNumber: Map<string, PersonFileRow>;
  readonly byAgencyRef: Map<string, PersonFileRow>;
  readonly byName: Map<string, PersonFileRow>;
}

const lc = (text: string | null | undefined): string => (text ?? '').trim().toLowerCase();

async function loadLookups(executor: Executor, orgId: string): Promise<Lookups> {
  // One after another: the executor is often a transaction, and one connection runs one query at a time.
  const siteRows = await executor.select().from(sites).where(and(eq(sites.orgId, orgId), isNull(sites.deletedAt), isNull(sites.archivedAt)));
  const areaRows = await executor.select().from(areas).where(and(eq(areas.orgId, orgId), isNull(areas.deletedAt), isNull(areas.archivedAt)));
  const classRows = await executor.select().from(laborClasses).where(and(eq(laborClasses.orgId, orgId), isNull(laborClasses.deletedAt), isNull(laborClasses.archivedAt)));
  const vendorRows = await executor.select({ id: vendors.id, name: vendors.name, kinds: vendors.kinds }).from(vendors).where(and(eq(vendors.orgId, orgId), isNull(vendors.archivedAt), isNull(vendors.deletedAt)));
  const file = await loadPeopleFile(executor, orgId);
  const defaultSite = siteRows.find((site) => site.isDefault) ?? siteRows[0];
  if (!defaultSite) throw invalid('Crew has no site yet. Open Getting started first.');
  const classes = new Map<string, string>();
  for (const row of classRows) {
    classes.set(lc(row.code), row.id);
    if (!classes.has(lc(row.name))) classes.set(lc(row.name), row.id);
  }
  const byNumber = new Map<string, PersonFileRow>();
  const byAgencyRef = new Map<string, PersonFileRow>();
  const byName = new Map<string, PersonFileRow>();
  for (const row of file) {
    byNumber.set(lc(row.cells.employee_number), row);
    if (row.cells.agency_person_id && row.agencyVendorId) byAgencyRef.set(`${row.agencyVendorId}|${lc(row.cells.agency_person_id)}`, row);
    byName.set(`${lc(row.cells.first_name)} ${lc(row.cells.last_name)}|${row.agencyVendorId ?? ''}`, row);
  }
  return {
    defaultSiteId: defaultSite.id,
    sites: new Map(siteRows.map((site) => [lc(site.code), { id: site.id, timezone: site.timezone }])),
    areas: new Map(areaRows.map((area) => [`${area.siteId}|${lc(area.code)}`, area.id])),
    classes,
    agencies: new Map(vendorRows.filter((row) => row.kinds.includes('temp_agency')).map((row) => [lc(row.name), row.id])),
    vendorsAny: new Map(vendorRows.map((row) => [lc(row.name), row.id])),
    file,
    byNumber,
    byAgencyRef,
    byName,
  };
}

/** What the check decided for one row, stored in `import_rows.parsed`. */
export interface RowPlan {
  readonly action: RowAction;
  readonly issues: CellIssue[];
  readonly values: PeopleRowValues;
  readonly matchId: string | null;
  readonly siteId: string | null;
  readonly areaId: string | null;
  readonly classId: string | null;
  readonly agencyId: string | null;
  /** The agency is new to Crew, or a vendor that will get the temp_agency kind. */
  readonly agencyNew: boolean;
  readonly kind: PersonKind;
  /** Which columns would change, for an update. */
  readonly changes: PeopleColumnKey[];
}

const err = (column: PeopleColumnKey | null, message: string): CellIssue => ({ column, level: 'error', message });
const warn = (column: PeopleColumnKey | null, message: string): CellIssue => ({ column, level: 'warning', message });

/** Plans one row against the workspace (pure over the lookups, so the tests can call it). */
export function planRow(
  raw: Readonly<Partial<Record<PeopleColumnKey, string>>>,
  lookups: Lookups,
  context: { readonly access: CrewAccess; readonly options: ImportOptions; readonly numbersInFile: ReadonlySet<string>; readonly seenNumbers: Set<string>; readonly seenMatches: Set<string> },
): RowPlan {
  const { access, options } = context;
  const read = readPeopleRow(raw, { canManagePay: canCrew(access.role, 'pay:manage'), canSeePrivate: canCrew(access.role, 'person:private_read') });
  const issues = [...read.issues];
  const values = read.values;
  let agencyId: string | null = null;
  let agencyNew = false;
  if (values.agency) {
    agencyId = lookups.agencies.get(lc(values.agency)) ?? null;
    if (!agencyId) {
      if (options.makeAgencies) {
        agencyNew = true;
        issues.push(warn('agency', lookups.vendorsAny.has(lc(values.agency)) ? `${values.agency} is a vendor already. Crew will mark it as an agency too.` : `${values.agency} is a new agency. Crew will add it.`));
      } else issues.push(err('agency', `There is no agency named ${values.agency}. Add it under People, Agencies, or turn on "Make new agencies".`));
    }
  }
  const kind: PersonKind = values.kind ?? (values.agency ? 'temp' : 'employee');

  // Row match: number, else agency and agency id, else the exact name with the agency (flagged only).
  let match: PersonFileRow | null = null;
  let lookalike: PersonFileRow | null = null;
  if (values.employee_number) {
    const number = lc(values.employee_number);
    if (context.seenNumbers.has(number)) issues.push(err('employee_number', `${values.employee_number} is in the file twice. Each number goes on one row.`));
    context.seenNumbers.add(number);
    match = lookups.byNumber.get(number) ?? null;
  } else if (agencyId && values.agency_person_id) {
    match = lookups.byAgencyRef.get(`${agencyId}|${lc(values.agency_person_id)}`) ?? null;
  }
  if (!match && !values.employee_number && values.first_name && values.last_name) {
    lookalike = lookups.byName.get(`${lc(values.first_name)} ${lc(values.last_name)}|${agencyId ?? ''}`) ?? null;
  }
  if (match) {
    if (context.seenMatches.has(match.id)) issues.push(err(null, `Another row in this file is already for ${match.cells.first_name} ${match.cells.last_name}.`));
    context.seenMatches.add(match.id);
  }
  if (!match && !values.employee_number && !lookalike) {
    if (kind === 'employee') issues.push(err('employee_number', 'An employee needs an employee number. Crew makes numbers for temps only.'));
    else if (!options.makeNumbers) issues.push(err('employee_number', 'Give a number, or turn on "Make numbers for temps".'));
  }

  const site = values.site_code ? lookups.sites.get(lc(values.site_code)) : undefined;
  if (values.site_code && !site) issues.push(err('site_code', `There is no site with the code ${values.site_code}.`));
  const siteId = values.site_code ? (site?.id ?? null) : (match?.homeSiteId ?? lookups.defaultSiteId);
  if (siteId && !siteInScope(access, siteId)) issues.push(err('site_code', 'That site is not one of yours.'));
  if (match && !siteInScope(access, match.homeSiteId)) issues.push(err(null, 'This person is at a site that is not one of yours.'));

  let areaId: string | null = null;
  if (values.area_code && siteId) {
    areaId = lookups.areas.get(`${siteId}|${lc(values.area_code)}`) ?? null;
    if (!areaId) issues.push(err('area_code', `There is no area ${values.area_code} at that site.`));
  }
  let classId: string | null = null;
  if (values.labor_class) {
    classId = lookups.classes.get(lc(values.labor_class)) ?? null;
    if (!classId) issues.push(err('labor_class', `There is no labor class ${values.labor_class}. Add it in Settings first.`));
  }
  if (values.lead_employee_number) {
    const leadNumber = lc(values.lead_employee_number);
    if (leadNumber === lc(values.employee_number ?? match?.cells.employee_number)) issues.push(err('lead_employee_number', 'A person cannot lead themselves.'));
    else if (!lookups.byNumber.has(leadNumber) && !context.numbersInFile.has(leadNumber)) issues.push(err('lead_employee_number', `There is no person with the number ${values.lead_employee_number}.`));
  }

  const errors = issues.some((issue) => issue.level === 'error');
  if (errors) return { action: 'error', issues, values, matchId: match?.id ?? null, siteId, areaId, classId, agencyId, agencyNew, kind, changes: [] };
  if (lookalike) {
    issues.push(warn(null, `Looks the same as ${lookalike.cells.first_name} ${lookalike.cells.last_name} (${lookalike.cells.employee_number}). Add the employee number to change that person, or a new number to add someone new.`));
    return { action: 'lookalike', issues, values, matchId: lookalike.id, siteId, areaId, classId, agencyId, agencyNew, kind, changes: [] };
  }
  if (!match) return { action: 'create', issues, values, matchId: null, siteId, areaId, classId, agencyId, agencyNew, kind, changes: [] };
  const changes = changedColumns(values, match, { siteId, areaId, classId, agencyId, agencyNew });
  return { action: changes.length > 0 ? 'update' : 'unchanged', issues, values, matchId: match.id, siteId, areaId, classId, agencyId, agencyNew, kind, changes };
}

function valueText(key: PeopleColumnKey, values: PeopleRowValues): string {
  const value = values[key];
  if (value === undefined) return '';
  if (key === 'wage_per_hour') return centsToDecimal(value as number);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/** Columns whose value in the file differs from Crew. A blank cell keeps what Crew has. */
function changedColumns(values: PeopleRowValues, current: PersonFileRow, refs: { siteId: string | null; areaId: string | null; classId: string | null; agencyId: string | null; agencyNew: boolean }): PeopleColumnKey[] {
  const out: PeopleColumnKey[] = [];
  for (const key of PEOPLE_COLUMN_KEYS) {
    if (values[key] === undefined) continue;
    switch (key) {
      case 'site_code':
        if (refs.siteId !== current.homeSiteId) out.push(key);
        break;
      case 'area_code':
        if (refs.areaId !== current.usualAreaId) out.push(key);
        break;
      case 'labor_class':
        if (refs.classId !== current.laborClassId) out.push(key);
        break;
      case 'lead_employee_number':
        if (lc(values.lead_employee_number) !== lc(current.cells.lead_employee_number)) out.push(key);
        break;
      case 'agency':
        if (refs.agencyNew || refs.agencyId !== current.agencyVendorId) out.push(key);
        break;
      case 'badge':
        if (hashBadge(values.badge) !== current.badgeHash) out.push(key);
        break;
      case 'email':
        if (lc(values.email) !== lc(current.cells.email)) out.push(key);
        break;
      default:
        if (valueText(key, values) !== current.cells[key]) out.push(key);
    }
  }
  return out;
}

export interface CheckSummary {
  readonly total: number;
  readonly create: number;
  readonly update: number;
  readonly unchanged: number;
  readonly lookalike: number;
  readonly error: number;
  readonly warning: number;
}

function summarize(plans: readonly RowPlan[]): CheckSummary {
  const count = (action: RowAction) => plans.filter((plan) => plan.action === action).length;
  return {
    total: plans.length,
    create: count('create'),
    update: count('update'),
    unchanged: count('unchanged'),
    lookalike: count('lookalike'),
    error: count('error'),
    warning: plans.filter((plan) => plan.issues.some((issue) => issue.level === 'warning')).length,
  };
}

async function planBatch(executor: Executor, ctx: DomainContext, access: CrewAccess, batchId: string, options: ImportOptions) {
  const rows = await executor.select().from(importRows).where(and(eq(importRows.orgId, ctx.orgId), eq(importRows.batchId, batchId))).orderBy(asc(importRows.rowNumber));
  const lookups = await loadLookups(executor, ctx.orgId);
  const numbersInFile = new Set(rows.map((row) => lc((row.raw as Record<string, string> | null)?.employee_number)).filter((number) => number !== ''));
  const seenNumbers = new Set<string>();
  const seenMatches = new Set<string>();
  const plans = rows.map((row) => planRow((row.raw ?? {}) as Partial<Record<PeopleColumnKey, string>>, lookups, { access, options, numbersInFile, seenNumbers, seenMatches }));
  return { rows, plans, lookups };
}

async function storePlans(tx: Transaction, ctx: DomainContext, rows: readonly { id: string }[], plans: readonly RowPlan[]): Promise<void> {
  for (const [index, row] of rows.entries()) {
    const plan = plans[index]!;
    await tx
      .update(importRows)
      .set({ action: plan.action, messages: plan.issues, parsed: { ...plan, issues: undefined } as unknown as Record<string, unknown>, entityId: plan.matchId, updatedAt: new Date() })
      .where(and(eq(importRows.orgId, ctx.orgId), eq(importRows.id, row.id)));
  }
}

/** Checks every row and stores what would happen. Safe to run again after a change of options. */
export const checkImport = scoped(async function checkImport(ctx: DomainContext, batchId: string, options?: Partial<ImportOptions>): Promise<CheckSummary> {
  const access = await requireImport(ctx);
  return inTx(async (tx) => {
    const batch = await loadBatch(tx, ctx, batchId);
    if (batch.status !== 'uploading' && batch.status !== 'checked') throw conflict('This import was already brought in.');
    if (batch.totalRows === 0) throw invalid('The file has no rows to bring in.');
    const merged = readOptions({ ...(batch.options as object), ...options });
    const { rows, plans } = await planBatch(tx, ctx, access, batchId, merged);
    await storePlans(tx, ctx, rows, plans);
    const summary = summarize(plans);
    await tx
      .update(importBatches)
      .set({ status: 'checked', options: { ...merged }, createCount: summary.create, updateCount: summary.update, unchangedCount: summary.unchanged, skipCount: summary.lookalike, errorCount: summary.error, warningCount: summary.warning, updatedAt: new Date() })
      .where(and(eq(importBatches.orgId, ctx.orgId), eq(importBatches.id, batchId)));
    return summary;
  });
});

/* 4: commit ------------------------------------------------------------------------------------- */

interface RowBefore {
  readonly person: Record<string, unknown> | null;
  readonly private: Record<string, unknown> | null;
  readonly pay: Record<string, unknown> | null;
  readonly wageFrom: string | null;
  /** The wage that was on that date before the import, put back by undo. */
  readonly wagePrevCents: number | null;
  readonly vendorMade: string | null;
}

function inputFrom(plan: RowPlan, current: typeof people.$inferSelect | null, leadId: string | null | undefined, agencyId: string | null): PersonInput {
  const v = plan.values;
  const keep = <T>(value: T | undefined, existing: T): T => (value === undefined ? existing : value);
  return {
    number: v.employee_number ?? current?.number ?? null,
    firstName: keep(v.first_name, current?.firstName ?? ''),
    lastName: keep(v.last_name, current?.lastName ?? ''),
    preferredName: keep(v.preferred_name, current?.preferredName ?? null),
    kind: v.kind ?? (current ? (current.kind as PersonKind) : plan.kind),
    status: v.status ?? (current ? (current.status as 'active') : 'active'),
    homeSiteId: plan.siteId,
    usualAreaId: v.area_code !== undefined ? plan.areaId : current && plan.siteId === current.homeSiteId ? current.usualAreaId : null,
    laborClassId: v.labor_class !== undefined ? plan.classId : (current?.laborClassId ?? null),
    leadPersonId: leadId === undefined ? (current?.leadPersonId ?? null) : leadId,
    agencyVendorId: v.agency !== undefined ? agencyId : (current?.agencyVendorId ?? null),
    agencyRef: keep(v.agency_person_id, current?.agencyRef ?? null),
    startDate: keep(v.start_date, current?.startDate ?? null),
    endDate: keep(v.end_date, current?.endDate ?? null),
    language: v.language ?? (current ? (current.language as 'en') : 'en'),
    email: keep(v.email, current?.email ?? null),
    phone: keep(v.phone, current?.phone ?? null),
    notes: current?.notes ?? null,
    userId: current?.userId ?? null,
    notifyEmail: current?.notifyEmail ?? true,
    ...(v.badge !== undefined ? { badge: v.badge } : {}),
  };
}

export interface CommitResult extends CheckSummary {
  readonly written: number;
  readonly createdIds: readonly string[];
}

export const commitImport = scoped(async function commitImport(ctx: DomainContext, batchId: string): Promise<CommitResult> {
  const access = await requireImport(ctx);
  return inTx(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crew-import:${batchId}`}))`);
    const batch = await loadBatch(tx, ctx, batchId);
    if (batch.status !== 'checked') throw conflict(batch.status === 'committed' ? 'This import was already brought in.' : 'Check the file before you bring it in.');
    const options = readOptions(batch.options);
    const { rows, plans, lookups } = await planBatch(tx, ctx, access, batchId, options);
    await storePlans(tx, ctx, rows, plans);
    const summary = summarize(plans);
    if (summary.error > 0 && options.mode === 'all') throw invalid(`${summary.error} ${summary.error === 1 ? 'row has' : 'rows have'} an error. Fix the file, or choose to skip bad rows.`);
    const numberToId = new Map<string, string>([...lookups.byNumber.entries()].map(([number, row]) => [number, row.id]));
    const agencyByName = new Map(lookups.agencies);
    const createdIds: string[] = [];
    let written = 0;
    const leadLater: { personId: string; leadNumber: string }[] = [];
    for (const [index, row] of rows.entries()) {
      const plan = plans[index]!;
      if (plan.action !== 'create' && plan.action !== 'update') continue;
      const v = plan.values;
      let agencyId = plan.agencyId;
      let vendorMade: string | null = null;
      if (v.agency && !agencyId) {
        const known = agencyByName.get(lc(v.agency));
        if (known) agencyId = known;
        else {
          const made = await upsertVendorKind(tx, ctx, { name: v.agency, kind: 'temp_agency' });
          agencyId = made.vendor.id;
          agencyByName.set(lc(v.agency), agencyId);
          if (made.created) vendorMade = agencyId;
        }
      }
      const [current] = plan.matchId ? await tx.select().from(people).where(and(eq(people.orgId, ctx.orgId), eq(people.id, plan.matchId))) : [];
      let leadId: string | null | undefined;
      if (v.lead_employee_number) leadId = numberToId.get(lc(v.lead_employee_number)) ?? null;
      const wageChanged = v.wage_per_hour !== undefined && (!current || plan.changes.includes('wage_per_hour'));
      const wageFrom = wageChanged ? todayInZone([...lookups.sites.values()].find((entry) => entry.id === plan.siteId)?.timezone ?? 'UTC') : null;
      const before: RowBefore = {
        person: current ? { ...current, createdAt: undefined, updatedAt: undefined } : null,
        private: current ? ((await tx.select().from(personPrivate).where(and(eq(personPrivate.orgId, ctx.orgId), eq(personPrivate.personId, current.id))))[0] ?? null) : null,
        pay: current ? ((await tx.select().from(personPay).where(and(eq(personPay.orgId, ctx.orgId), eq(personPay.personId, current.id))))[0] ?? null) : null,
        wageFrom,
        wagePrevCents: wageFrom && current ? ((await tx.select({ cents: personWages.wageCents }).from(personWages).where(and(eq(personWages.orgId, ctx.orgId), eq(personWages.personId, current.id), eq(personWages.effectiveFrom, wageFrom))))[0]?.cents ?? null) : null,
        vendorMade,
      };
      const privateInput = v.emergency_name !== undefined || v.emergency_phone !== undefined ? { ...(v.emergency_name !== undefined ? { emergencyName: v.emergency_name } : {}), ...(v.emergency_phone !== undefined ? { emergencyPhone: v.emergency_phone } : {}) } : undefined;
      const payInput =
        v.pay_type !== undefined || v.overtime_exempt !== undefined || wageChanged
          ? { ...(v.pay_type !== undefined ? { payType: v.pay_type } : {}), ...(v.overtime_exempt !== undefined ? { overtimeExempt: v.overtime_exempt } : {}), ...(wageChanged ? { wageCents: v.wage_per_hour } : {}) }
          : undefined;
      const result = await writePerson(tx, ctx, current ? { id: current.id, version: current.version } : null, inputFrom(plan, current ?? null, leadId === null ? undefined : leadId, agencyId), {
        private: privateInput,
        pay: payInput,
        options: { source: 'csv', importBatchId: batchId },
      });
      if (v.lead_employee_number && leadId === null) leadLater.push({ personId: result.id, leadNumber: lc(v.lead_employee_number) });
      numberToId.set(lc(result.number), result.id);
      if (result.created) createdIds.push(result.id);
      written += 1;
      await tx.update(importRows).set({ entityId: result.id, before: before as unknown as Record<string, unknown>, updatedAt: new Date() }).where(and(eq(importRows.orgId, ctx.orgId), eq(importRows.id, row.id)));
    }
    // Leads that were made by a later row of the same file.
    for (const later of leadLater) {
      const leadId = numberToId.get(later.leadNumber);
      if (leadId && leadId !== later.personId) await tx.update(people).set({ leadPersonId: leadId }).where(and(eq(people.orgId, ctx.orgId), eq(people.id, later.personId)));
    }
    const undoUntil = new Date(Date.now() + UNDO_DAYS * 86_400_000);
    await tx
      .update(importBatches)
      .set({ status: 'committed', committedAt: new Date(), undoUntil, createCount: summary.create, updateCount: summary.update, unchangedCount: summary.unchanged, skipCount: summary.lookalike, errorCount: summary.error, warningCount: summary.warning, updatedAt: new Date() })
      .where(and(eq(importBatches.orgId, ctx.orgId), eq(importBatches.id, batchId)));
    await logActivity(tx, ctx, { verb: 'import.committed', entityType: 'import_batch', entityId: batchId, after: { stream: batch.stream, created: summary.create, updated: summary.update, skipped: summary.lookalike + summary.error } });
    return { ...summary, written, createdIds };
  });
});

/* 5: undo --------------------------------------------------------------------------------------- */

const PERSON_RESTORE_KEYS = ['number', 'firstName', 'lastName', 'preferredName', 'kind', 'status', 'homeSiteId', 'usualAreaId', 'laborClassId', 'leadPersonId', 'agencyVendorId', 'agencyRef', 'startDate', 'endDate', 'email', 'phone', 'language', 'badgeHash'] as const;

export const undoImport = scoped(async function undoImport(ctx: DomainContext, batchId: string): Promise<{ readonly removed: number; readonly restored: number }> {
  await requireImport(ctx);
  return inTx(async (tx) => {
    const batch = await loadBatch(tx, ctx, batchId);
    if (batch.status !== 'committed') throw conflict('Only an import that was brought in can be undone.');
    if (!batch.undoUntil || batch.undoUntil < new Date()) throw conflict(`Undo lasts ${UNDO_DAYS} days. This import is older than that.`);
    const rows = await tx.select().from(importRows).where(and(eq(importRows.orgId, ctx.orgId), eq(importRows.batchId, batchId), inArray(importRows.action, ['create', 'update']))).orderBy(desc(importRows.rowNumber));
    let removed = 0;
    let restored = 0;
    for (const row of rows) {
      if (!row.entityId) continue;
      const before = row.before as unknown as RowBefore | null;
      if (row.action === 'create') {
        await tx.update(people).set({ leadPersonId: null }).where(and(eq(people.orgId, ctx.orgId), eq(people.leadPersonId, row.entityId)));
        await tx.update(people).set({ deletedAt: new Date(), badgeHash: null, userId: null, updatedAt: new Date(), version: sql`${people.version} + 1` }).where(and(eq(people.orgId, ctx.orgId), eq(people.id, row.entityId)));
        removed += 1;
      } else if (before?.person) {
        const set: Record<string, unknown> = {};
        for (const key of PERSON_RESTORE_KEYS) set[key] = before.person[key] ?? null;
        await tx.update(people).set({ ...set, updatedAt: new Date(), version: sql`${people.version} + 1` }).where(and(eq(people.orgId, ctx.orgId), eq(people.id, row.entityId)));
        if (before.private) {
          const p = before.private as Record<string, string | null>;
          await tx.update(personPrivate).set({ emergencyName: p.emergencyName ?? null, emergencyPhone: p.emergencyPhone ?? null }).where(and(eq(personPrivate.orgId, ctx.orgId), eq(personPrivate.personId, row.entityId)));
        }
        if (before.pay) {
          const p = before.pay as { payType?: string; overtimeExempt?: boolean };
          await tx.update(personPay).set({ payType: p.payType ?? 'hourly', overtimeExempt: p.overtimeExempt ?? false }).where(and(eq(personPay.orgId, ctx.orgId), eq(personPay.personId, row.entityId)));
        }
        if (before.wageFrom) {
          const at = and(eq(personWages.orgId, ctx.orgId), eq(personWages.personId, row.entityId), eq(personWages.effectiveFrom, before.wageFrom));
          if (before.wagePrevCents === null || before.wagePrevCents === undefined) await tx.delete(personWages).where(at);
          else await tx.update(personWages).set({ wageCents: before.wagePrevCents, updatedAt: new Date() }).where(at);
        }
        restored += 1;
      }
    }
    await tx.update(importBatches).set({ status: 'undone', undoneAt: new Date(), updatedAt: new Date() }).where(and(eq(importBatches.orgId, ctx.orgId), eq(importBatches.id, batchId)));
    await logActivity(tx, ctx, { verb: 'import.undone', entityType: 'import_batch', entityId: batchId, after: { removed, restored } });
    return { removed, restored };
  });
});

/* Reading --------------------------------------------------------------------------------------- */

export interface ImportBatchSummary {
  readonly id: string;
  readonly stream: string;
  readonly fileName: string | null;
  readonly status: string;
  readonly totalRows: number;
  readonly counts: { readonly create: number; readonly update: number; readonly unchanged: number; readonly skip: number; readonly error: number; readonly warning: number };
  readonly createdAt: string;
  readonly committedAt: string | null;
  readonly undoUntil: string | null;
  readonly createdByName: string | null;
}

function toSummary(batch: typeof importBatches.$inferSelect, createdByName: string | null): ImportBatchSummary {
  return {
    id: batch.id,
    stream: batch.stream,
    fileName: batch.fileName,
    status: batch.status,
    totalRows: batch.totalRows,
    counts: { create: batch.createCount, update: batch.updateCount, unchanged: batch.unchangedCount, skip: batch.skipCount, error: batch.errorCount, warning: batch.warningCount },
    createdAt: batch.createdAt.toISOString(),
    committedAt: batch.committedAt?.toISOString() ?? null,
    undoUntil: batch.undoUntil?.toISOString() ?? null,
    createdByName,
  };
}

export const listImportBatches = scoped(async function listImportBatches(ctx: DomainContext): Promise<ImportBatchSummary[]> {
  await requireImport(ctx);
  const rows = await db.select({ batch: importBatches, name: user.name }).from(importBatches).leftJoin(user, eq(user.id, importBatches.createdBy)).where(eq(importBatches.orgId, ctx.orgId)).orderBy(desc(importBatches.createdAt)).limit(50);
  return rows.map((row) => toSummary(row.batch, row.name));
});

export interface ImportRowDto {
  readonly rowNumber: number;
  readonly action: RowAction | null;
  readonly cells: Record<string, string>;
  readonly messages: readonly CellIssue[];
  readonly changes: readonly string[];
  readonly personId: string | null;
}

export interface ImportBatchDetail {
  readonly batch: ImportBatchSummary;
  readonly options: ImportOptions;
  readonly headers: readonly string[];
  readonly columns: readonly (string | null)[];
  readonly rows: readonly ImportRowDto[];
  /** People this import made, for PIN slips (only after it was brought in). */
  readonly createdPersonIds: readonly string[];
}

export const getImportBatch = scoped(async function getImportBatch(ctx: DomainContext, batchId: string): Promise<ImportBatchDetail> {
  const access = await requireImport(ctx);
  if (!isUuid(batchId)) throw notFound('That import');
  const [found] = await db.select({ batch: importBatches, name: user.name }).from(importBatches).leftJoin(user, eq(user.id, importBatches.createdBy)).where(and(eq(importBatches.orgId, ctx.orgId), eq(importBatches.id, batchId)));
  if (!found) throw notFound('That import');
  const rows = await db.select().from(importRows).where(and(eq(importRows.orgId, ctx.orgId), eq(importRows.batchId, batchId))).orderBy(asc(importRows.rowNumber)).limit(MAX_IMPORT_ROWS);
  const sight = sightOf(access);
  const created = found.batch.status === 'committed' ? rows.filter((row) => row.action === 'create' && row.entityId).map((row) => row.entityId!) : [];
  const live = created.length > 0 ? await db.select({ id: people.id }).from(people).where(and(eq(people.orgId, ctx.orgId), inArray(people.id, created), isNull(people.deletedAt))) : [];
  return {
    batch: toSummary(found.batch, found.name),
    options: readOptions(found.batch.options),
    headers: found.batch.header ?? [],
    columns: ((found.batch.mapping as { columns?: (string | null)[] } | null)?.columns ?? []) as (string | null)[],
    rows: rows.map((row) => ({
      rowNumber: row.rowNumber,
      action: (row.action as RowAction | null) ?? null,
      cells: redactCells((row.raw ?? {}) as Record<string, string>, sight),
      // A message on a column the reader may not see could quote its value: it becomes the plain refusal.
      messages: (row.messages as CellIssue[]).map((issue) =>
        issue.column === null || redactCells({ [issue.column]: 'x' }, sight)[issue.column] !== undefined ? issue : { ...issue, message: `Your role cannot bring in ${issue.column}. Leave the column empty, or ask someone with the right to import it.` },
      ),
      changes: (((row.parsed as { changes?: string[] } | null)?.changes ?? []) as string[]).filter((key) => redactCells({ [key]: 'x' }, sight)[key] !== undefined),
      personId: row.entityId,
    })),
    createdPersonIds: live.map((row) => row.id),
  };
});

/** The rows with errors as a CSV, with an `errors` column first (SPEC 7: the error report). */
export const importErrorReport = scoped(async function importErrorReport(ctx: DomainContext, batchId: string): Promise<{ readonly fileName: string; readonly csv: string }> {
  const detail = await getImportBatch(ctx, batchId);
  const keys = detail.columns.filter((column): column is string => column !== null);
  const bad = detail.rows.filter((row) => row.action === 'error' || row.action === 'lookalike');
  const csv = toCsv(
    ['row', 'errors', ...keys],
    bad.map((row) => [row.rowNumber, row.messages.map((issue) => (issue.column ? `${issue.column}: ${issue.message}` : issue.message)).join(' | '), ...keys.map((key) => row.cells[key] ?? '')]),
  );
  return { fileName: `crew-people-errors-${batchId.slice(0, 8)}.csv`, csv };
});
