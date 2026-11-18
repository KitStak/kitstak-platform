/**
 * CSV in for every stream (SPEC section 7). One engine, the same code for all 17 streams:
 *
 *   1. `createImportBatch` opens a batch. The browser parses the file and sends its raw rows in
 *      chunks (`appendImportRows`). Nothing the browser parsed is trusted: only raw strings are kept.
 *   2. `checkImportBatch` is the dry run. It reads every raw row with the chosen column mapping,
 *      looks up clients, jobs and the rest by code or name, finds the row each file row matches
 *      and gives it an action: new, changed (with a field by field diff), no change, looks the
 *      same, skipped or problem. Nothing is saved.
 *   3. `commitImportBatch` plans again inside one transaction, writes the rows, restamps and
 *      rebuilds the rollups, and keeps a snapshot of every row it changed.
 *   4. `undoImportBatch` puts the snapshots back and removes the rows the batch made, for 7 days,
 *      leaving alone any row somebody changed after the import.
 *
 * Existing rows are read through `loadStreamRows` (exports.ts), the same statement the export
 * uses, and compared in CSV terms. That is why a file you export and import back reads
 * "no change" for every row.
 */
import 'server-only';
import { and, desc, eq, getTableColumns, getTableName, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db, type Executor } from '@/server/db';
import {
  clients,
  costEntries,
  importBatches,
  importPresets,
  importRows,
  indirectEntries,
  items,
  jobLinks,
  jobPlans,
  jobPrices,
  jobTypes,
  jobs,
  laborRates,
  materialUsage,
  paidHours,
  productionEntries,
  revenueEntries,
  standards,
  targets,
  timePunches,
  vasEntries,
  vasServices,
} from '@/server/db/schema';
import { conflict, forbidden, invalid, notFound } from '@/server/errors';
import { DEFAULT_IMPORT_OPTIONS, EMPTY_IMPORT_COUNTS, IMPORT_LIMITS, type ImportAction, type ImportBatchDTO, type ImportChange, type ImportCounts, type ImportMessage, type ImportOptions, type ImportPresetDTO, type ImportProgressDTO, type ImportRowDTO, type ImportRowsPage, type ImportStartDTO, type ImportStatus, type ImportStreamSummaryDTO, type ImportWillCreate } from '@/features/imports/types';
import { cleanCell } from '@/lib/csv/coerce';
import { headerSignature, mapHeaders, mappingToPreset } from '@/lib/csv/headers';
import { readStreamRows } from '@/lib/csv/read';
import { type ColumnDef, type LooseRecord, type RowIssue, anyStreamDef, planLayout, recordKey } from '@/lib/csv/streams';
import { formatCell } from '@/lib/csv/template';
import { toCsv } from '@/lib/csv/write';
import { mulQuantityPrice } from '@/lib/money';
import { canImportStream, canPulse } from '@/lib/permissions';
import { loadedRate } from '@/lib/profit/rates';
import { shortDate } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import { STREAM_IDS, isStreamId, streamInfo, type StreamId } from '@/lib/streams';
import { cleanText, inTx, iso, isoRequired, isUuid, monthName, monthStart, rows, todayInZone, uuidArray, type DomainContext } from './_shared';
import { pulseAccessFor, type PulseAccess } from './access';
import { logActivity } from './activity';
import { insertClient, insertItem, insertJobType } from './catalog';
import { countStreamRows, loadStreamRows, type StreamRow } from './exports';
import { insertJob, type JobInput } from './jobs';
import { recomputeJobs } from './job-stats';
import { insertLaborClass } from './labor';
import { getPeople } from './people';
import { upsertPlan, type PlanInput, type PlanLineInput } from './plans';
import { dayLockReason } from './production';
import { rollupPunches } from './punches';
import { closedMonths, finishWrite, newTouched, recalcOrg, restampFixedJob, restampIndirect, restampProduction, restampUsage, restampVas, touchDay, touchJob } from './recalc';
import { loadSettings, type SettingsRow } from './settings';

type BatchRow = typeof importBatches.$inferSelect;
type Rec = LooseRecord;

/* ------------------------------------------------------------------------------------------ */
/* Lookups                                                                                     */
/* ------------------------------------------------------------------------------------------ */

type RefKind = 'client' | 'job_type' | 'labor_class' | 'item' | 'site' | 'service' | 'job';

const KIND_WORDS: Readonly<Record<RefKind, string>> = { client: 'client', job_type: 'job type', labor_class: 'labor class', item: 'item', site: 'site', service: 'service', job: 'job' };
const CREATABLE: ReadonlySet<RefKind> = new Set<RefKind>(['client', 'job_type', 'labor_class', 'item']);

/** One record a file row can point at. `id` is null until a missing record is created at commit. */
interface Ent {
  id: string | null;
  code: string;
  name: string;
  data: Record<string, unknown>;
  pending?: boolean;
}

class Lookup {
  private readonly byCode = new Map<string, Ent>();
  private readonly byName = new Map<string, Ent>();
  private readonly byId = new Map<string, Ent>();
  add(ent: Ent): void {
    this.byCode.set(ent.code.trim().toLowerCase(), ent);
    const name = ent.name.trim().toLowerCase();
    if (name && !this.byName.has(name)) this.byName.set(name, ent);
    if (ent.id) this.byId.set(ent.id, ent);
  }
  /** By code first, then by exact name, ignoring case. */
  find(text: string): Ent | null {
    const key = text.trim().toLowerCase();
    return this.byCode.get(key) ?? this.byName.get(key) ?? null;
  }
  id(id: string | null | undefined): Ent | null {
    return id ? (this.byId.get(id) ?? null) : null;
  }
}

interface Env {
  readonly ctx: DomainContext;
  readonly access: PulseAccess;
  readonly settings: SettingsRow;
  readonly options: ImportOptions;
  readonly lookups: Readonly<Record<RefKind, Lookup>>;
  readonly defaultSite: Ent;
  readonly members: ReadonlyMap<string, string>;
  readonly closed: ReadonlySet<string>;
  readonly pending: { kind: RefKind; ent: Ent }[];
  readonly batchId: string;
}

async function loadEnv(executor: Executor, ctx: DomainContext, access: PulseAccess, options: ImportOptions, batchId: string): Promise<Env> {
  const settings = await loadSettings(ctx.orgId, executor);
  const lookups: Record<RefKind, Lookup> = { client: new Lookup(), job_type: new Lookup(), labor_class: new Lookup(), item: new Lookup(), site: new Lookup(), service: new Lookup(), job: new Lookup() };
  const org = ctx.orgId;
  const simple = async (kind: RefKind, query: SQL): Promise<void> => {
    for (const row of await rows<{ id: string; code: string; name: string } & Record<string, unknown>>(executor, query)) {
      const { id, code, name, ...data } = row;
      lookups[kind].add({ id, code, name: name ?? '', data });
    }
  };
  await simple('site', sql`SELECT id, code, name, timezone, is_default FROM pulse.sites WHERE org_id = ${org} AND deleted_at IS NULL ORDER BY is_default DESC`);
  await simple('client', sql`SELECT id, code, name FROM pulse.clients WHERE org_id = ${org} AND deleted_at IS NULL`);
  await simple('job_type', sql`SELECT id, code, name FROM pulse.job_types WHERE org_id = ${org} AND deleted_at IS NULL`);
  await simple('labor_class', sql`SELECT id, code, name FROM pulse.labor_classes WHERE org_id = ${org} AND deleted_at IS NULL`);
  await simple('service', sql`SELECT id, code, name, default_price, billing FROM pulse.vas_services WHERE org_id = ${org} AND deleted_at IS NULL`);
  await simple('item', sql`SELECT id, sku AS code, name, uom, unit_cost FROM pulse.items WHERE org_id = ${org} AND deleted_at IS NULL`);
  // Jobs are found by number only: a job name is not a safe key.
  for (const row of await rows<{ id: string; number: string; client_id: string; site_id: string; pricing_model: string; entries: number }>(
    executor,
    sql`SELECT j.id, j.number, j.client_id, j.site_id, j.pricing_model,
               (SELECT count(*)::int FROM pulse.production_entries p WHERE p.job_id = j.id AND p.deleted_at IS NULL) AS entries
          FROM pulse.jobs j WHERE j.org_id = ${org} AND j.deleted_at IS NULL`,
  )) {
    lookups.job.add({ id: row.id, code: row.number, name: '', data: { clientId: row.client_id, siteId: row.site_id, pricingModel: row.pricing_model, entries: row.entries } });
  }
  const sites = await rows<{ id: string }>(executor, sql`SELECT id FROM pulse.sites WHERE org_id = ${org} AND deleted_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1`);
  const defaultSite = lookups.site.id(sites[0]?.id);
  if (!defaultSite) throw invalid('This workspace has no site yet. Add one in Settings, then import again.');
  const members = new Map(
    (await rows<{ id: string; email: string }>(executor, sql`SELECT u.id, lower(u.email) AS email FROM core.member m JOIN core."user" u ON u.id = m.user_id WHERE m.organization_id = ${org}`)).map((row) => [row.email, row.id]),
  );
  return { ctx, access, settings, options, lookups, defaultSite, members, closed: await closedMonths(executor, org), pending: [], batchId };
}

/** Finds a record by code or name. A missing one is queued for creation, or reported in plain words. */
function ref(env: Env, kind: RefKind, text: unknown, column: string, issues: RowIssue[], data: Record<string, unknown> = {}): Ent | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const found = env.lookups[kind].find(text);
  if (found) return found;
  const word = KIND_WORDS[kind];
  if (CREATABLE.has(kind) && env.options.createMissing) {
    const code = text.trim();
    const ent: Ent = { id: null, code, name: typeof data.name === 'string' && data.name.trim() !== '' ? data.name.trim() : code, data, pending: true };
    env.lookups[kind].add(ent);
    env.pending.push({ kind, ent });
    return ent;
  }
  issues.push({
    level: 'error',
    column,
    message: CREATABLE.has(kind) ? `There is no ${word} ${text.trim()}. Add it first or turn on Create missing.` : kind === 'job' ? `There is no job ${text.trim()}. Add it first, or import your jobs before this file.` : `There is no ${word} ${text.trim()}. Add it first.`,
  });
  return null;
}

/** Creates the records the file mentions and Pulse did not have. Fills in their ids. */
async function ensurePending(tx: Executor, env: Env): Promise<{ kind: RefKind; id: string; code: string }[]> {
  const made: { kind: RefKind; id: string; code: string }[] = [];
  const looksLikeCode = (text: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/.test(text);
  for (const { kind, ent } of env.pending) {
    if (ent.id) continue;
    if (kind === 'client') {
      const row = await insertClient(tx, env.ctx, { code: looksLikeCode(ent.code) ? ent.code : null, name: ent.name, source: 'csv' });
      ent.id = row.id;
      ent.code = row.code;
    } else if (kind === 'job_type') {
      const row = await insertJobType(tx, env.ctx, { code: looksLikeCode(ent.code) ? ent.code : null, name: ent.name });
      ent.id = row.id;
      ent.code = row.code;
    } else if (kind === 'labor_class') {
      const row = await insertLaborClass(tx, env.ctx, { code: looksLikeCode(ent.code) ? ent.code : null, name: ent.name, kind: ent.data.kind === 'temp_agency' ? 'temp_agency' : 'employee' });
      ent.id = row.id;
      ent.code = row.code;
    } else if (kind === 'item') {
      const row = await insertItem(tx, env.ctx, { sku: ent.code, name: ent.name, uom: typeof ent.data.uom === 'string' ? ent.data.uom : undefined, unitCost: env.access.seesMoney && typeof ent.data.unitCost === 'string' ? ent.data.unitCost : '0' });
      ent.id = row.id;
      ent.code = row.sku;
      ent.data = { ...ent.data, uom: row.uom, unit_cost: row.unitCost };
    } else continue;
    ent.pending = false;
    made.push({ kind, id: ent.id, code: ent.code });
  }
  return made;
}

/* ------------------------------------------------------------------------------------------ */
/* Stream handlers                                                                             */
/* ------------------------------------------------------------------------------------------ */

type Refs = Record<string, Ent | null>;

interface Planned {
  readonly rec: Rec;
  readonly refs: Refs;
}

interface Keying {
  /** Natural key columns. */
  readonly cols: readonly string[];
  /** The key only counts when this column has a value. */
  readonly needs?: string;
  /** A second key tried when the first finds nothing. */
  readonly alt?: readonly string[];
}

interface Handler {
  readonly table: PgTable;
  /** How to tell that a row was edited after the import. */
  readonly stamp: 'version' | 'updated_at';
  readonly hasSource: boolean;
  readonly softDelete: boolean;
  /** Record field of the date that must be in an open month. */
  readonly dateKey?: string;
  /** Supervisors may only change the last few days of these streams. */
  readonly floor?: boolean;
  /** Columns that are read but never compared (they only feed other columns). */
  readonly virtual?: readonly string[];
  /** Columns compared even when the file cell is blank. */
  readonly strict?: readonly string[];
  readonly keying: Keying;
  readonly recalc: 'days' | 'org' | 'jobs' | 'none';
  /** Turns the file record into its canonical form (codes as stored, defaults for key columns). */
  readonly canon: (rec: Rec, env: Env, issues: RowIssue[]) => Refs;
  /** Database values for the generic insert and update. `existing` is the matched row, for merges. */
  readonly values?: (planned: Planned, env: Env, existing: Rec | null) => Record<string, unknown>;
  /** Extra values for a new row only. */
  readonly defaults?: (planned: Planned, env: Env) => Record<string, unknown>;
  readonly createOne?: (tx: Executor, env: Env, planned: Planned) => Promise<string>;
  readonly updateOne?: (tx: Executor, env: Env, planned: Planned, existing: StreamRow, changed: ReadonlySet<string>) => Promise<void>;
}

/** Drops blank values, so a blank cell leaves what is already there. */
function drop(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined) out[key] = value;
  return out;
}

const cents = (value: unknown): number | null => (typeof value === 'bigint' ? Number(value) : null);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function siteOrDefault(env: Env, rec: Rec, issues: RowIssue[]): Ent {
  const site = rec.siteCode === null ? env.defaultSite : (ref(env, 'site', rec.siteCode, 'site_code', issues) ?? env.defaultSite);
  rec.siteCode = site.code;
  return site;
}

function codeRef(env: Env, kind: RefKind, rec: Rec, field: string, column: string, issues: RowIssue[], data: Record<string, unknown> = {}): Ent | null {
  const ent = ref(env, kind, rec[field], column, issues, data);
  if (ent) rec[field] = ent.code;
  return ent;
}

function jobSite(env: Env, job: Ent | null): Ent | null {
  return job ? env.lookups.site.id(job.data.siteId as string) : null;
}

const HANDLERS: Readonly<Record<StreamId, Handler>> = {
  clients: {
    table: clients,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    keying: { cols: ['client_code'], alt: ['name'] },
    recalc: 'org',
    canon: () => ({}),
    values: ({ rec }) => drop({ code: rec.clientCode, name: rec.name, status: rec.status, contactName: rec.contactName, contactEmail: rec.contactEmail, phone: rec.phone, targetMarginBp: rec.targetMarginPct, paymentTermsDays: rec.paymentTermsDays, partsOwner: rec.partsOwner, notes: rec.notes }),
  },
  job_types: {
    table: jobTypes,
    stamp: 'updated_at',
    hasSource: false,
    softDelete: true,
    keying: { cols: ['job_type_code'] },
    recalc: 'org',
    canon: (rec, env, issues) => ({ laborClass: codeRef(env, 'labor_class', rec, 'defaultLaborClass', 'default_labor_class', issues) }),
    values: ({ rec, refs }) => drop({ code: rec.jobTypeCode, name: rec.name, unitLabel: rec.unitLabel, defaultPricingModel: rec.defaultPricingModel, defaultLaborClassId: refs.laborClass?.id, defaultStandardUph: rec.defaultUnitsPerLaborHour, targetMarginBp: rec.targetMarginPct }),
  },
  jobs: {
    table: jobs,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    keying: { cols: ['job_number'] },
    recalc: 'org',
    canon: (rec, env, issues) => {
      const refs: Refs = {
        client: codeRef(env, 'client', rec, 'clientCode', 'client_code', issues),
        jobType: codeRef(env, 'job_type', rec, 'jobTypeCode', 'job_type_code', issues),
        site: codeRef(env, 'site', rec, 'siteCode', 'site_code', issues),
        laborClass: codeRef(env, 'labor_class', rec, 'laborClass', 'labor_class', issues),
      };
      if (typeof rec.startDate === 'string' && typeof rec.dueDate === 'string' && rec.dueDate < rec.startDate) issues.push({ level: 'error', column: 'due_date', message: 'The due date is before the start date.' });
      if (typeof rec.ownerEmail === 'string') {
        const email = rec.ownerEmail.toLowerCase();
        if (env.members.has(email)) rec.ownerEmail = email;
        else {
          issues.push({ level: 'warning', column: 'owner_email', message: `Nobody in this workspace uses the email ${rec.ownerEmail}, so the job has no owner.` });
          rec.ownerEmail = null;
        }
      }
      return refs;
    },
    createOne: async (tx, env, { rec, refs }) => {
      const hasQuote = ['quoteUnits', 'quoteRevenue', 'quoteLaborHours', 'quoteLaborCost', 'quoteMaterialCost', 'quoteOtherCost'].some((key) => rec[key] !== null);
      const quote: PlanInput | null = hasQuote
        ? { units: text(rec.quoteUnits) ?? undefined, revenueCents: cents(rec.quoteRevenue) ?? undefined, laborHours: text(rec.quoteLaborHours) ?? undefined, laborCents: cents(rec.quoteLaborCost) ?? undefined, materialCents: cents(rec.quoteMaterialCost) ?? undefined, otherCents: cents(rec.quoteOtherCost) ?? undefined, origin: 'csv' }
        : null;
      const links: NonNullable<JobInput['links']> = [];
      if (typeof rec.wmsWorkOrder === 'string') links.push({ targetType: 'wms_work_order', targetId: rec.wmsWorkOrder });
      if (typeof rec.crmDealId === 'string') links.push({ targetType: 'crm_deal', targetId: rec.crmDealId });
      if (typeof rec.projectKey === 'string') links.push({ targetType: 'pm_project', targetId: rec.projectKey });
      const job = await insertJob(tx, env.ctx, {
        number: text(rec.jobNumber),
        name: String(rec.name),
        clientId: refs.client?.id,
        jobTypeId: refs.jobType?.id ?? null,
        siteId: refs.site?.id ?? null,
        kind: (rec.kind as JobInput['kind']) ?? undefined,
        status: (rec.status as JobInput['status']) ?? undefined,
        pricingModel: (rec.pricingModel as JobInput['pricingModel']) ?? undefined,
        unitLabel: text(rec.unitLabel),
        plannedUnits: text(rec.plannedUnits) ?? undefined,
        unitPrice: text(rec.unitPrice),
        fixedPriceCents: cents(rec.fixedPrice),
        billRateCents: cents(rec.billRatePerHour),
        materialMethod: (rec.materialMethod as JobInput['materialMethod']) ?? undefined,
        materialCostPerUnit: text(rec.materialCostPerUnit) ?? undefined,
        partsOwner: (rec.partsOwner as JobInput['partsOwner']) ?? null,
        defaultLaborClassId: refs.laborClass?.id ?? undefined,
        standardUph: text(rec.unitsPerLaborHourStandard),
        targetMarginBp: typeof rec.targetMarginPct === 'number' ? rec.targetMarginPct : null,
        startDate: text(rec.startDate),
        dueDate: text(rec.dueDate),
        completedDate: text(rec.completedDate),
        poNumber: text(rec.poNumber),
        ownerId: typeof rec.ownerEmail === 'string' ? (env.members.get(rec.ownerEmail) ?? null) : null,
        description: text(rec.notes),
        kitSku: text(rec.kitSku),
        quote,
        links,
        source: 'csv',
      });
      await tx.update(jobs).set({ importBatchId: env.batchId }).where(eq(jobs.id, job.id));
      return job.id;
    },
    updateOne: async (tx, env, { rec, refs }, existing, changed) => {
      const has = (column: string): boolean => changed.has(column);
      const patch: Record<string, unknown> = {};
      if (has('job_number')) patch.number = rec.jobNumber;
      if (has('name')) patch.name = rec.name;
      if (has('client_code')) patch.clientId = refs.client?.id;
      if (has('job_type_code')) patch.jobTypeId = refs.jobType?.id;
      if (has('site_code')) patch.siteId = refs.site?.id;
      if (has('kind')) patch.kind = rec.kind;
      if (has('pricing_model')) patch.pricingModel = rec.pricingModel;
      if (has('unit_label')) patch.unitLabel = rec.unitLabel;
      if (has('planned_units')) patch.plannedUnits = rec.plannedUnits;
      if (has('unit_price')) patch.unitPrice = rec.unitPrice;
      if (has('fixed_price')) patch.fixedPriceCents = rec.fixedPrice;
      if (has('bill_rate_per_hour')) patch.billRateCents = cents(rec.billRatePerHour);
      if (has('material_method')) patch.materialMethod = rec.materialMethod;
      if (has('material_cost_per_unit')) patch.materialCostPerUnit = rec.materialCostPerUnit;
      if (has('parts_owner')) patch.partsOwner = rec.partsOwner;
      if (has('labor_class')) patch.defaultLaborClassId = refs.laborClass?.id;
      if (has('units_per_labor_hour_standard')) patch.standardUph = rec.unitsPerLaborHourStandard;
      if (has('target_margin_pct')) patch.targetMarginBp = rec.targetMarginPct;
      if (has('start_date')) patch.startDate = rec.startDate;
      if (has('due_date')) patch.dueDate = rec.dueDate;
      if (has('po_number')) patch.poNumber = rec.poNumber;
      if (has('owner_email')) patch.ownerId = typeof rec.ownerEmail === 'string' ? (env.members.get(rec.ownerEmail) ?? null) : null;
      if (has('kit_sku')) patch.kitSku = rec.kitSku;
      if (has('notes')) patch.description = rec.notes;
      const status = has('status') ? String(rec.status) : String(existing.record.status);
      if (has('status')) {
        patch.status = status;
        if (status === 'active' || status === 'completed') patch.activatedAt = sql`COALESCE(activated_at, now())`;
      }
      if (status === 'completed') {
        if (has('completed_date')) patch.completedDate = rec.completedDate;
        else if (existing.record.completedDate === null) patch.completedDate = todayInZone(String((refs.site ?? env.defaultSite).data.timezone ?? env.settings.timezone));
      } else if (has('status')) patch.completedDate = null;
      if (Object.keys(patch).length > 0) await tx.update(jobs).set({ ...patch, version: sql`version + 1`, updatedBy: env.ctx.userId, updatedAt: new Date() }).where(eq(jobs.id, existing.id));
      // The newest price row mirrors the job row.
      if (has('unit_price') || has('bill_rate_per_hour') || has('material_cost_per_unit')) {
        const price: Record<string, unknown> = {};
        if (has('unit_price')) price.unitPrice = rec.unitPrice;
        if (has('bill_rate_per_hour')) price.billRateCents = cents(rec.billRatePerHour);
        if (has('material_cost_per_unit')) price.materialCostPerUnit = rec.materialCostPerUnit;
        await tx
          .update(jobPrices)
          .set({ ...price, updatedAt: new Date() })
          .where(and(eq(jobPrices.jobId, existing.id), sql`${jobPrices.effectiveFrom} = (SELECT max(effective_from) FROM pulse.job_prices WHERE job_id = ${existing.id})`));
      }
      if (['quote_units', 'quote_revenue', 'quote_labor_hours', 'quote_labor_cost', 'quote_material_cost', 'quote_other_cost'].some(has)) {
        await upsertPlan(tx, env.ctx, existing.id, 'quote', {
          units: has('quote_units') ? (text(rec.quoteUnits) ?? undefined) : undefined,
          revenueCents: has('quote_revenue') ? (cents(rec.quoteRevenue) ?? undefined) : undefined,
          laborHours: has('quote_labor_hours') ? (text(rec.quoteLaborHours) ?? undefined) : undefined,
          laborCents: has('quote_labor_cost') ? (cents(rec.quoteLaborCost) ?? undefined) : undefined,
          materialCents: has('quote_material_cost') ? (cents(rec.quoteMaterialCost) ?? undefined) : undefined,
          otherCents: has('quote_other_cost') ? (cents(rec.quoteOtherCost) ?? undefined) : undefined,
        });
      }
      const links: [string, string, unknown][] = [
        ['wms_work_order', 'wms_work_order', rec.wmsWorkOrder],
        ['crm_deal_id', 'crm_deal', rec.crmDealId],
        ['project_key', 'pm_project', rec.projectKey],
      ];
      for (const [column, targetType, value] of links) {
        if (!has(column) || typeof value !== 'string') continue;
        await tx.delete(jobLinks).where(and(eq(jobLinks.orgId, env.ctx.orgId), eq(jobLinks.jobId, existing.id), eq(jobLinks.targetType, targetType)));
        await tx.insert(jobLinks).values({ orgId: env.ctx.orgId, jobId: existing.id, targetType, targetId: value, cachedAt: new Date(), createdBy: env.ctx.userId });
      }
    },
  },
  job_plans: {
    table: jobPlans,
    stamp: 'version',
    hasSource: false,
    softDelete: false,
    keying: { cols: ['job_number', 'plan'] },
    recalc: 'jobs',
    canon: (rec, env, issues) => {
      if (typeof rec.setupHours === 'string' && typeof rec.laborHours === 'string' && Number(rec.setupHours) > Number(rec.laborHours)) issues.push({ level: 'error', column: 'setup_hours', message: 'Setup hours are part of labor hours, so they cannot be more than the labor hours.' });
      if (typeof rec.setupCost === 'bigint' && typeof rec.laborCost === 'bigint' && rec.setupCost > rec.laborCost) issues.push({ level: 'error', column: 'setup_cost', message: 'Setup cost is part of labor cost, so it cannot be more than the labor cost.' });
      return {
        job: codeRef(env, 'job', rec, 'jobNumber', 'job_number', issues),
        laborClass: codeRef(env, 'labor_class', rec, 'laborClass', 'labor_class', issues),
        service: codeRef(env, 'service', rec, 'serviceCode', 'service_code', issues),
        item: codeRef(env, 'item', rec, 'itemSku', 'item_sku', issues),
      };
    },
    createOne: async (tx, env, planned) => (await savePlanTotals(tx, env, planned)).id,
    updateOne: async (tx, env, planned) => {
      await savePlanTotals(tx, env, planned);
    },
  },
  production: {
    table: productionEntries,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    dateKey: 'workDate',
    floor: true,
    virtual: ['hours_each'],
    keying: { cols: ['job_number', 'work_date', 'shift', 'labor_class'] },
    recalc: 'days',
    canon: (rec, env, issues) => {
      const job = codeRef(env, 'job', rec, 'jobNumber', 'job_number', issues);
      if (rec.shift === null) rec.shift = 'day';
      else rec.shift = String(rec.shift).toLowerCase();
      return { job, site: jobSite(env, job), laborClass: codeRef(env, 'labor_class', rec, 'laborClass', 'labor_class', issues) };
    },
    values: ({ rec, refs }) =>
      drop({ jobId: refs.job?.id, siteId: refs.job?.data.siteId, workDate: rec.workDate, shift: rec.shift, laborClassId: refs.laborClass?.id, unitsGood: rec.unitsGood, unitsScrap: rec.unitsScrap, unitsRework: rec.unitsRework, headcount: rec.people, hours: rec.laborHours, overtimeHours: rec.overtimeHours, setupHours: rec.setupHours, note: rec.note }),
    defaults: (_planned, env) => ({ enteredBy: env.ctx.userId }),
  },
  labor_rates: {
    table: laborRates,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    dateKey: 'effectiveFrom',
    virtual: ['labor_class_name', 'kind'],
    keying: { cols: ['labor_class_code', 'site_code', 'effective_from'] },
    recalc: 'org',
    canon: (rec, env, issues) => ({
      laborClass: codeRef(env, 'labor_class', rec, 'laborClassCode', 'labor_class_code', issues, { name: rec.laborClassName, kind: rec.kind }),
      site: codeRef(env, 'site', rec, 'siteCode', 'site_code', issues),
    }),
    values: ({ rec, refs }, env, existing) => {
      const pick = <T>(file: unknown, old: unknown, fallback: T): T => (file !== null && file !== undefined ? (file as T) : old !== null && old !== undefined ? (old as T) : fallback);
      const fields = {
        wageCents: Number(pick<bigint | number>(rec.wagePerHour, existing?.wagePerHour, 0)),
        payrollTaxBp: Number(pick(rec.payrollTaxPct, existing?.payrollTaxPct, env.settings.defaultPayrollTaxBp)),
        benefitsBp: Number(pick(rec.benefitsPct, existing?.benefitsPct, env.settings.defaultBenefitsBp)),
        otherBurdenBp: Number(pick(rec.otherBurdenPct, existing?.otherBurdenPct, env.settings.defaultOtherBurdenBp)),
        overheadPerHourCents: Number(pick<bigint | number>(rec.overheadPerHour, existing?.overheadPerHour, env.settings.defaultOverheadPerHourCents)),
        overtimeMultiplier: String(pick(rec.overtimeMultiplier, existing?.overtimeMultiplier, env.settings.defaultOvertimeMultiplier)),
      };
      const rate = loadedRate(fields);
      return {
        ...drop({ laborClassId: refs.laborClass?.id, effectiveFrom: rec.effectiveFrom, billRateCents: cents(rec.billRatePerHour), note: rec.note }),
        siteId: refs.site?.id ?? null,
        ...fields,
        loadedRateCents: Number(rate.loadedRateCents),
        overtimeRateCents: Number(rate.overtimeRateCents),
      };
    },
  },
  indirect_time: {
    table: indirectEntries,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    dateKey: 'workDate',
    floor: true,
    keying: { cols: [] },
    recalc: 'days',
    canon: (rec, env, issues) => ({ site: siteOrDefault(env, rec, issues), laborClass: codeRef(env, 'labor_class', rec, 'laborClass', 'labor_class', issues) }),
    values: ({ rec, refs }) => drop({ siteId: refs.site?.id, workDate: rec.workDate, laborClassId: refs.laborClass?.id, reason: rec.reason, headcount: rec.people, hours: rec.laborHours, overtimeHours: rec.overtimeHours, note: rec.note }),
  },
  paid_hours: {
    table: paidHours,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    dateKey: 'workDate',
    keying: { cols: ['work_date', 'site_code', 'labor_class'] },
    recalc: 'days',
    canon: (rec, env, issues) => ({ site: siteOrDefault(env, rec, issues), laborClass: codeRef(env, 'labor_class', rec, 'laborClass', 'labor_class', issues) }),
    values: ({ rec, refs }) => drop({ siteId: refs.site?.id, workDate: rec.workDate, laborClassId: refs.laborClass?.id, paidHours: rec.paidHours, paidCents: rec.paidAmount }),
  },
  time_punches: {
    table: timePunches,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    dateKey: 'workDate',
    floor: true,
    keying: { cols: ['employee_id', 'work_date', 'job_number', 'reason', 'labor_class'] },
    recalc: 'days',
    canon: (rec, env, issues) => {
      const job = codeRef(env, 'job', rec, 'jobNumber', 'job_number', issues);
      if (job && rec.reason !== null) {
        issues.push({ level: 'warning', column: 'reason', message: 'This row has a job, so the reason was left out.' });
        rec.reason = null;
      }
      const site = rec.siteCode !== null ? (codeRef(env, 'site', rec, 'siteCode', 'site_code', issues) ?? env.defaultSite) : (jobSite(env, job) ?? env.defaultSite);
      rec.siteCode = site.code;
      return { job, site, laborClass: codeRef(env, 'labor_class', rec, 'laborClass', 'labor_class', issues) };
    },
    values: ({ rec, refs }) => ({
      ...drop({ siteId: refs.site?.id, workDate: rec.workDate, employeeCode: rec.employeeId, employeeName: rec.employeeName, laborClassId: refs.laborClass?.id, hours: rec.hours, overtimeHours: rec.overtimeHours, payCents: rec.payAmount }),
      jobId: refs.job?.id ?? null,
      reason: refs.job ? null : (rec.reason ?? null),
    }),
    strict: ['job_number', 'reason'],
  },
  materials: {
    table: materialUsage,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    dateKey: 'usageDate',
    floor: true,
    keying: { cols: ['job_number', 'usage_date', 'item_sku', 'lot'], needs: 'lot' },
    recalc: 'days',
    canon: (rec, env, issues) => {
      const job = codeRef(env, 'job', rec, 'jobNumber', 'job_number', issues);
      return { job, site: jobSite(env, job), item: codeRef(env, 'item', rec, 'itemSku', 'item_sku', issues, { name: rec.itemName, uom: rec.uom, unitCost: rec.unitCost }) };
    },
    values: ({ rec, refs }) =>
      drop({ jobId: refs.job?.id, siteId: refs.job?.data.siteId, usageDate: rec.usageDate, itemId: refs.item?.id, itemSku: refs.item?.code ?? rec.itemSku, itemName: rec.itemName, quantityUsed: rec.quantityUsed, quantityScrapped: rec.quantityScrapped, quantityPlanned: rec.quantityPlanned, unitCost: rec.unitCost, uom: rec.uom, lot: rec.lot, suppliedBy: rec.suppliedBy, note: rec.note }),
    defaults: ({ rec, refs }) => drop({ itemName: rec.itemName ?? refs.item?.name, uom: rec.uom ?? refs.item?.data.uom, unitCost: rec.unitCost ?? refs.item?.data.unit_cost ?? '0' }),
  },
  items: {
    table: items,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    keying: { cols: ['item_sku'] },
    recalc: 'org',
    canon: (rec, env, issues) => ({ client: codeRef(env, 'client', rec, 'clientCode', 'client_code', issues) }),
    values: ({ rec, refs }) => drop({ sku: rec.itemSku, name: rec.name, uom: rec.uom, unitCost: rec.unitCost, costUpdatedAt: rec.unitCost !== null ? new Date() : null, suppliedBy: rec.suppliedBy, clientId: refs.client?.id }),
  },
  costs: {
    table: costEntries,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    dateKey: 'costDate',
    keying: { cols: ['job_number', 'client_code', 'cost_date', 'category', 'reference'], needs: 'reference' },
    strict: ['job_number', 'client_code'],
    recalc: 'days',
    canon: (rec, env, issues) => {
      const job = codeRef(env, 'job', rec, 'jobNumber', 'job_number', issues);
      if (job) {
        rec.clientCode = null;
        rec.siteCode = null;
        return { job, client: null, site: null };
      }
      const client = codeRef(env, 'client', rec, 'clientCode', 'client_code', issues);
      if (client) {
        rec.siteCode = null;
        return { job: null, client, site: null };
      }
      return { job: null, client: null, site: codeRef(env, 'site', rec, 'siteCode', 'site_code', issues) };
    },
    values: ({ rec, refs }, env) => ({
      ...drop({ costDate: rec.costDate, category: rec.category, amountCents: rec.amount, vendor: rec.vendor, reference: rec.reference, note: rec.note }),
      scope: refs.job ? 'job' : refs.client ? 'client' : 'company',
      jobId: refs.job?.id ?? null,
      clientId: refs.job ? (refs.job.data.clientId as string) : (refs.client?.id ?? null),
      ...(refs.job ? { siteId: refs.job.data.siteId } : refs.client ? { siteId: env.defaultSite.id } : refs.site ? { siteId: refs.site.id } : {}),
    }),
  },
  revenue: {
    table: revenueEntries,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    dateKey: 'revenueDate',
    keying: { cols: ['job_number', 'client_code', 'invoice_number', 'description'], needs: 'invoice_number' },
    strict: ['job_number', 'client_code'],
    recalc: 'days',
    canon: (rec, env, issues) => {
      const job = codeRef(env, 'job', rec, 'jobNumber', 'job_number', issues);
      const service = codeRef(env, 'service', rec, 'serviceCode', 'service_code', issues);
      if (job) {
        rec.clientCode = null;
        return { job, client: null, service };
      }
      return { job: null, client: codeRef(env, 'client', rec, 'clientCode', 'client_code', issues), service };
    },
    values: ({ rec, refs }, env) => ({
      ...drop({ revenueDate: rec.revenueDate, kind: rec.kind, description: rec.description, quantity: rec.quantity, unitPrice: rec.unitPrice, amountCents: rec.amount, invoiceNumber: rec.invoiceNumber, vasServiceId: refs.service?.id, note: rec.note }),
      jobId: refs.job?.id ?? null,
      clientId: refs.job ? (refs.job.data.clientId as string) : refs.client?.id,
      siteId: refs.job ? (refs.job.data.siteId as string) : env.defaultSite.id,
    }),
  },
  services: {
    table: vasServices,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    keying: { cols: ['service_code'] },
    recalc: 'org',
    canon: (rec, env, issues) => ({ laborClass: codeRef(env, 'labor_class', rec, 'laborClass', 'labor_class', issues) }),
    values: ({ rec, refs }) => drop({ code: rec.serviceCode, name: rec.name, unitLabel: rec.unitLabel, billing: rec.billing, defaultPrice: rec.defaultPrice, defaultCostPerUnit: rec.defaultCostPerUnit, standardUph: rec.unitsPerLaborHourStandard, defaultLaborClassId: refs.laborClass?.id, active: rec.active }),
  },
  services_done: {
    table: vasEntries,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    dateKey: 'workDate',
    keying: { cols: [] },
    strict: ['job_number'],
    recalc: 'days',
    canon: (rec, env, issues) => {
      const client = codeRef(env, 'client', rec, 'clientCode', 'client_code', issues);
      const job = codeRef(env, 'job', rec, 'jobNumber', 'job_number', issues);
      if (job && client?.id && job.data.clientId !== client.id) issues.push({ level: 'error', column: 'job_number', message: `Job ${job.code} belongs to another client. Fix the job number or the client code.` });
      return { client, job, service: codeRef(env, 'service', rec, 'serviceCode', 'service_code', issues), laborClass: codeRef(env, 'labor_class', rec, 'laborClass', 'labor_class', issues) };
    },
    values: ({ rec, refs }, env) => ({
      ...drop({ vasServiceId: refs.service?.id, clientId: refs.client?.id, workDate: rec.workDate, quantity: rec.quantity, unitPrice: rec.unitPrice, amountCents: rec.amount, laborClassId: refs.laborClass?.id, headcount: rec.people, hours: rec.laborHours, overtimeHours: rec.overtimeHours, materialCents: rec.materialCost, note: rec.note }),
      jobId: refs.job?.id ?? null,
      siteId: refs.job ? (refs.job.data.siteId as string) : env.defaultSite.id,
    }),
    defaults: ({ rec, refs }) => {
      const price = text(rec.unitPrice) ?? (typeof refs.service?.data.default_price === 'string' ? refs.service.data.default_price : null);
      if (rec.amount !== null || price === null) return drop({ unitPrice: price });
      const billing = refs.service?.data.billing;
      const amount = billing === 'flat' ? mulQuantityPrice('1', price) : mulQuantityPrice(billing === 'per_hour' ? (text(rec.laborHours) ?? '0') : String(rec.quantity), price);
      return { unitPrice: price, amountCents: amount };
    },
  },
  target_pace: {
    table: standards,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    keying: { cols: ['job_type_code', 'service_code', 'client_code', 'labor_class', 'effective_from'] },
    recalc: 'org',
    canon: (rec, env, issues) => ({
      jobType: codeRef(env, 'job_type', rec, 'jobTypeCode', 'job_type_code', issues),
      service: codeRef(env, 'service', rec, 'serviceCode', 'service_code', issues),
      client: codeRef(env, 'client', rec, 'clientCode', 'client_code', issues),
      laborClass: codeRef(env, 'labor_class', rec, 'laborClass', 'labor_class', issues),
    }),
    values: ({ rec, refs }) => ({
      ...drop({ unitsPerLaborHour: rec.unitsPerLaborHour, effectiveFrom: rec.effectiveFrom, note: rec.note }),
      jobTypeId: refs.jobType?.id ?? null,
      vasServiceId: refs.service?.id ?? null,
      clientId: refs.client?.id ?? null,
      laborClassId: refs.laborClass?.id ?? null,
    }),
  },
  goals: {
    table: targets,
    stamp: 'version',
    hasSource: true,
    softDelete: true,
    keying: { cols: ['scope', 'scope_code', 'metric', 'month'] },
    recalc: 'none',
    canon: (rec, env, issues) => {
      const kind: RefKind | null = rec.scope === 'site' ? 'site' : rec.scope === 'client' ? 'client' : rec.scope === 'job_type' ? 'job_type' : rec.scope === 'service' ? 'service' : null;
      if (kind === null) {
        rec.scopeCode = null;
        return { target: null };
      }
      const found = typeof rec.scopeCode === 'string' ? env.lookups[kind].find(rec.scopeCode) : null;
      if (!found && typeof rec.scopeCode === 'string') issues.push({ level: 'error', column: 'scope_code', message: `There is no ${KIND_WORDS[kind]} ${rec.scopeCode}. Add it first.` });
      if (found) rec.scopeCode = found.code;
      return { target: found };
    },
    values: ({ rec, refs }) => ({ scope: rec.scope === 'service' ? 'vas_service' : rec.scope, scopeId: refs.target?.id ?? null, metric: rec.metric, periodMonth: typeof rec.month === 'string' ? `${rec.month}-01` : null, value: rec.value }),
  },
};

/** Saves the totals of one plan row through `upsertPlan`, so shared cost and the checks stay in one place. */
async function savePlanTotals(tx: Executor, env: Env, { rec, refs }: Planned): Promise<{ id: string }> {
  const jobId = refs.job?.id;
  if (!jobId) throw invalid('That job does not exist.');
  const input: PlanInput = {
    units: text(rec.units) ?? undefined,
    revenueCents: cents(rec.revenue) ?? undefined,
    laborHours: text(rec.laborHours) ?? undefined,
    laborCents: cents(rec.laborCost) ?? undefined,
    setupHours: text(rec.setupHours) ?? undefined,
    setupCents: cents(rec.setupCost) ?? undefined,
    materialCents: cents(rec.materialCost) ?? undefined,
    otherCents: cents(rec.otherCost) ?? undefined,
  };
  const [before] = await tx.select({ id: jobPlans.id }).from(jobPlans).where(and(eq(jobPlans.orgId, env.ctx.orgId), eq(jobPlans.jobId, jobId), eq(jobPlans.plan, String(rec.plan))));
  const row = await upsertPlan(tx, env.ctx, jobId, rec.plan as 'quote' | 'budget', before ? input : { ...input, origin: 'csv' });
  return { id: row.id };
}

/* ------------------------------------------------------------------------------------------ */
/* Planning (the dry run)                                                                      */
/* ------------------------------------------------------------------------------------------ */

const SEP = '\u001f';

function cellText(column: ColumnDef, value: unknown): string {
  const cell = formatCell(column, value);
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'object') return cell.raw;
  return String(cell);
}

function sameCell(column: ColumnDef, a: unknown, b: unknown): boolean {
  const left = cellText(column, a);
  const right = cellText(column, b);
  return column.type === 'code' || column.type === 'email' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function keyOf(columns: ReadonlyMap<string, ColumnDef>, rec: Rec, cols: readonly string[]): string {
  return cols.map((key) => cellText(columns.get(key) as ColumnDef, rec[recordKey(key)]).toLowerCase()).join(SEP);
}

interface RowPlan {
  readonly n: number;
  action: ImportAction;
  readonly messages: ImportMessage[];
  changes: ImportChange[];
  entityId: string | null;
  planned: Planned | null;
  existing: StreamRow | null;
  /** Group key for line by line plans. */
  group?: string;
}

interface Plan {
  readonly rows: RowPlan[];
  readonly problems: string[];
  readonly willCreate: ImportWillCreate[];
  readonly dateOrderNote: string | null;
  readonly layout: 'totals' | 'lines' | null;
  readonly env: Env;
}

interface RawRow {
  readonly n: number;
  readonly cells: readonly string[];
  readonly skip: boolean;
}

function toMessages(issues: readonly RowIssue[]): ImportMessage[] {
  return issues.map((issue) => ({ level: issue.level, column: issue.column, text: issue.message }));
}

function closedMessage(month: string): string {
  return `${monthName(month)} is closed. Ask the owner to reopen it.`;
}

async function planBatch(executor: Executor, ctx: DomainContext, access: PulseAccess, batch: BatchRow, raw: readonly RawRow[], mapping: readonly (string | null)[], options: ImportOptions): Promise<Plan> {
  const stream = batch.stream as StreamId;
  const def = anyStreamDef(stream);
  const handler = HANDLERS[stream];
  const headers = batch.header ?? [];
  const columns = new Map(def.columns.map((column) => [column.key, column]));
  const env = await loadEnv(executor, ctx, access, { ...options, createMissing: options.createMissing && canPulse(access.role, 'job:manage') }, batch.id);
  const problems: string[] = [];

  // File level checks: needed columns, one header per column.
  const mapped = mapping.filter((key): key is string => key !== null);
  const layout = stream === 'job_plans' ? planLayout(mapped) : null;
  const seenColumns = new Set<string>();
  for (const key of mapped) {
    if (!columns.has(key)) problems.push(`Pulse has no column called ${key} for this kind of file.`);
    else if (seenColumns.has(key)) problems.push(`Two of your columns are matched to ${key}. Match only one.`);
    seenColumns.add(key);
  }
  for (const column of def.columns) {
    if (column.required && !seenColumns.has(column.key)) problems.push(`None of your columns is matched to ${column.key}, and it is needed. Match one of your columns to it.`);
  }
  if (raw.length === 0) problems.push('This file has no rows under the header row.');
  if (problems.length > 0) {
    return { rows: raw.map((row) => ({ n: row.n, action: 'error' as const, messages: [], changes: [], entityId: null, planned: null, existing: null })), problems, willCreate: [], dateOrderNote: null, layout, env };
  }

  const input = { headers, rows: raw.map((row) => row.cells), rowNumbers: raw.map((row) => row.n), columns: mapping };
  let read = readStreamRows(stream, input, options.dateOrder ? { dateOrder: options.dateOrder } : {});
  // No proof in the file: fall back to the date order of the workspace.
  if (read.dateOrderSource === 'default' && env.settings.dateOrder === 'DMY') read = { ...readStreamRows(stream, input, { dateOrder: 'DMY' }), dateOrderSource: 'default' };
  const hasDates = def.columns.some((column) => column.type === 'date' && seenColumns.has(column.key));
  const dateOrderNote = !hasDates
    ? null
    : read.dateOrderSource === 'option'
      ? null
      : read.dateOrderSource === 'detected'
        ? `Dates like 3/4/2026 were read ${read.dateOrder === 'MDY' ? 'month first' : 'day first'}, because that is the only way every date in this file works.`
        : null;

  const plans: RowPlan[] = [];
  const moneyHidden = !access.seesMoney;
  const wagesHidden = !access.seesWages;

  // 1. Canonical records and lookups.
  read.rows.forEach((row, index) => {
    const source = raw[index] as RawRow;
    const plan: RowPlan = { n: source.n, action: 'create', messages: toMessages(row.issues), changes: [], entityId: null, planned: null, existing: null };
    plans.push(plan);
    if (source.skip) {
      plan.action = 'skip';
      plan.messages.length = 0;
      plan.messages.push({ level: 'info', column: null, text: 'You chose to leave this row out.' });
      return;
    }
    if (!row.ok || row.record === null) {
      plan.action = 'error';
      return;
    }
    const rec = { ...(row.record as unknown as Rec) };
    for (const column of def.columns) {
      const field = recordKey(column.key);
      if (rec[field] === null || rec[field] === undefined) continue;
      if ((column.wage && wagesHidden) || (column.money && moneyHidden)) {
        rec[field] = null;
        plan.messages.push({ level: 'warning', column: column.key, text: 'Your role cannot set money, so this cell was left out.' });
      }
    }
    const issues: RowIssue[] = [];
    const refs = handler.canon(rec, env, issues);
    plan.messages.push(...toMessages(issues));
    if (issues.some((issue) => issue.level === 'error')) {
      plan.action = 'error';
      return;
    }
    plan.planned = { rec, refs };
  });

  // 2. Existing rows, read the way the export reads them.
  const live = plans.filter((plan) => plan.planned !== null);
  const dateField = handler.dateKey;
  let from: string | null = null;
  let to: string | null = null;
  if (dateField && stream !== 'labor_rates') {
    for (const plan of live) {
      const date = plan.planned?.rec[dateField];
      if (typeof date !== 'string') continue;
      if (from === null || date < from) from = date;
      if (to === null || date > to) to = date;
    }
  }
  const hasEntryId = columns.has('entry_id');
  const entryIds = hasEntryId ? [...new Set(live.map((plan) => plan.planned?.rec.entryId).filter((value): value is string => typeof value === 'string'))] : [];
  const existing = new Map<string, StreamRow>();
  if (live.length > 0) {
    const windowed = dateField && stream !== 'labor_rates' && from !== null && to !== null;
    for (const row of await loadStreamRows(executor, ctx.orgId, stream, windowed ? { from, to, layout: 'totals' } : { layout: 'totals' })) existing.set(row.id, row);
    for (let offset = 0; offset < entryIds.length; offset += 5000) {
      for (const row of await loadStreamRows(executor, ctx.orgId, stream, { ids: entryIds.slice(offset, offset + 5000) })) existing.set(row.id, row);
    }
  }
  const byRef = new Map<string, StreamRow>();
  const byKey = new Map<string, StreamRow>();
  const byAlt = new Map<string, StreamRow>();
  const byLook = new Set<string>();
  const keying = handler.keying;
  const needsField = keying.needs ? recordKey(keying.needs) : null;
  const naturalKey = (rec: Rec): string | null => (keying.cols.length === 0 || (needsField !== null && rec[needsField] === null) ? null : keyOf(columns, rec, keying.cols));
  const lookKey = (rec: Rec): string | null => (def.lookAlikeColumns.length === 0 ? null : keyOf(columns, rec, def.lookAlikeColumns));
  for (const row of existing.values()) {
    if (row.ref) byRef.set(row.ref.toLowerCase(), row);
    const key = naturalKey(row.record);
    if (key !== null) byKey.set(key, row);
    if (keying.alt) byAlt.set(keyOf(columns, row.record, keying.alt), row);
    const look = lookKey(row.record);
    if (look !== null) byLook.add(look);
  }

  if (layout === 'lines') {
    await planPlanLines(executor, ctx, plans, columns, existing);
  } else {
    // 3. Match each file row and give it an action.
    const seenKeys = new Map<string, number>();
    const seenIds = new Map<string, number>();
    const comparable = def.columns.filter((column) => column.key !== 'entry_id' && !(handler.virtual ?? []).includes(column.key) && (column.layout === undefined || column.layout === 'totals'));
    const strict = new Set(handler.strict ?? []);
    for (const plan of live) {
      const rec = (plan.planned as Planned).rec;
      const entryId = hasEntryId && typeof rec.entryId === 'string' ? rec.entryId.toLowerCase() : null;
      const key = naturalKey(rec);
      let match: StreamRow | null = null;
      let viaEntry = false;
      if (entryId !== null) {
        match = existing.get(entryId) ?? byRef.get(entryId) ?? null;
        viaEntry = match !== null;
      }
      if (!match && key !== null) match = byKey.get(key) ?? null;
      if (!match && keying.alt) match = byAlt.get(keyOf(columns, rec, keying.alt)) ?? null;

      const fileKey = entryId !== null ? `id:${entryId}` : key !== null ? `key:${key}` : null;
      if (fileKey !== null) {
        const first = seenKeys.get(fileKey);
        if (first !== undefined) {
          plan.action = 'error';
          plan.messages.push({ level: 'error', column: null, text: `This row is for the same record as row ${first}. Keep one of them.` });
          continue;
        }
        seenKeys.set(fileKey, plan.n);
      }
      if (match) {
        const first = seenIds.get(match.id);
        if (first !== undefined) {
          plan.action = 'error';
          plan.messages.push({ level: 'error', column: null, text: `This row is for the same record as row ${first}. Keep one of them.` });
          continue;
        }
        seenIds.set(match.id, plan.n);
        if (viaEntry && key !== null) {
          const other = byKey.get(key);
          if (other && other.id !== match.id) {
            plan.action = 'error';
            plan.messages.push({ level: 'error', column: null, text: 'Another row already here has the same key. Change that row instead, or remove the entry_id.' });
            continue;
          }
        }
      }

      if (!match) {
        const look = entryId === null && key === null ? lookKey(rec) : null;
        if (look !== null && byLook.has(look) && options.lookalikes === 'skip') {
          plan.action = 'lookalike';
          plan.messages.push({ level: 'info', column: null, text: 'This looks the same as a row already here, so it is left out. Pick "Add them anyway" if it really is a second one.' });
        } else plan.action = 'create';
      } else {
        plan.existing = match;
        plan.entityId = match.id;
        const changes: ImportChange[] = [];
        for (const column of comparable) {
          const field = recordKey(column.key);
          const value = rec[field];
          if ((value === null || value === undefined) && !strict.has(column.key)) continue;
          if (!sameCell(column, value, match.record[field])) changes.push({ column: column.key, from: cellText(column, match.record[field]), to: cellText(column, value) });
        }
        plan.changes = changes;
        plan.action = changes.length > 0 ? 'update' : 'unchanged';
        if (stream === 'jobs' && changes.some((change) => change.column === 'site_code')) {
          const job = env.lookups.job.id(match.id);
          if (job && Number(job.data.entries ?? 0) > 0) {
            plan.action = 'error';
            plan.messages.push({ level: 'error', column: 'site_code', text: 'This job already has work logged at its site. Copy the job to run it at another site.' });
          }
        }
      }
    }
  }

  // 4. Closed months and day locks for the rows that would be written.
  const lockCache = new Map<string, string | null>();
  for (const plan of plans) {
    if (plan.action !== 'create' && plan.action !== 'update') continue;
    const rec = (plan.planned as Planned).rec;
    if (dateField) {
      const dates = [rec[dateField], plan.existing?.record[dateField]].filter((value): value is string => typeof value === 'string');
      const hit = dates.map(monthStart).find((month) => env.closed.has(month));
      if (hit) {
        plan.action = 'error';
        plan.messages.push({ level: 'error', column: null, text: closedMessage(hit) });
        continue;
      }
    }
    if (handler.floor && !canPulse(access.role, 'production:edit_any') && dateField && typeof rec[dateField] === 'string') {
      const site = (plan.planned as Planned).refs.site ?? env.defaultSite;
      const cacheKey = `${site.id}:${String(rec[dateField])}`;
      if (!lockCache.has(cacheKey)) lockCache.set(cacheKey, site.id ? await dayLockReason(executor, ctx, access, site.id, String(site.data.timezone ?? env.settings.timezone), String(rec[dateField])) : null);
      const reason = lockCache.get(cacheKey);
      if (reason) {
        plan.action = 'error';
        plan.messages.push({ level: 'error', column: null, text: reason });
      }
    }
  }

  // 5. Say which missing records would be added, on the rows that use them.
  const used = new Set<Ent>();
  for (const plan of plans) {
    if (plan.action !== 'create' && plan.action !== 'update') continue;
    for (const ent of Object.values((plan.planned as Planned).refs)) {
      if (ent?.pending) {
        used.add(ent);
        const kind = env.pending.find((item) => item.ent === ent)?.kind;
        if (kind) plan.messages.push({ level: 'info', column: null, text: `The ${KIND_WORDS[kind]} ${ent.code} is new and will be added.` });
      }
    }
  }
  const willCreate = env.pending.filter((item) => used.has(item.ent)).map((item) => ({ kind: item.kind as ImportWillCreate['kind'], code: item.ent.code }));
  // Only create what a row that is saved really uses.
  for (let index = env.pending.length - 1; index >= 0; index -= 1) if (!used.has((env.pending[index] as { ent: Ent }).ent)) env.pending.splice(index, 1);
  return { rows: plans, problems, willCreate, dateOrderNote, layout, env };
}

/** Line by line plans: all lines of a job and plan in the file replace the lines of that plan. */
async function planPlanLines(executor: Executor, ctx: DomainContext, plans: RowPlan[], columns: ReadonlyMap<string, ColumnDef>, totals: ReadonlyMap<string, StreamRow>): Promise<void> {
  const lineColumns = ['category', 'description', 'quantity', 'unit', 'unit_amount', 'amount', 'labor_class', 'service_code', 'item_sku'];
  const signature = (rec: Rec): string => keyOf(columns, rec, lineColumns);
  const groupOf = (rec: Rec): string => keyOf(columns, rec, ['job_number', 'plan']);
  const planIds = new Map<string, StreamRow>();
  for (const row of totals.values()) planIds.set(groupOf(row.record), row);
  const existingLines = new Map<string, string[]>();
  for (const row of await loadStreamRows(executor, ctx.orgId, 'job_plans', { layout: 'lines' })) {
    const group = groupOf(row.record);
    const list = existingLines.get(group) ?? [];
    list.push(signature(row.record));
    existingLines.set(group, list);
  }
  const groups = new Map<string, RowPlan[]>();
  for (const plan of plans) {
    if (plan.planned === null) continue;
    const group = groupOf(plan.planned.rec);
    plan.group = group;
    const list = groups.get(group) ?? [];
    list.push(plan);
    groups.set(group, list);
  }
  for (const [group, list] of groups) {
    const before = existingLines.get(group) ?? [];
    const after = list.map((plan) => signature((plan.planned as Planned).rec));
    const same = before.length === after.length && before.every((line, index) => line === after[index]);
    const row = planIds.get(group) ?? null;
    for (const plan of list) {
      plan.existing = row;
      plan.entityId = row?.id ?? null;
      plan.action = same ? 'unchanged' : row ? 'update' : 'create';
      if (!same && row && before.length > 0 && plan === list[0]) plan.messages.push({ level: 'info', column: null, text: `The ${before.length} lines this plan has now will be replaced by the ${after.length} lines in this file.` });
    }
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Batches                                                                                     */
/* ------------------------------------------------------------------------------------------ */

function optionsOf(batch: BatchRow): ImportOptions {
  const stored = (batch.options ?? {}) as Partial<ImportOptions>;
  return {
    mode: stored.mode === 'skip_bad_rows' ? 'skip_bad_rows' : DEFAULT_IMPORT_OPTIONS.mode,
    dateOrder: stored.dateOrder === 'MDY' || stored.dateOrder === 'DMY' ? stored.dateOrder : null,
    createMissing: stored.createMissing === undefined ? DEFAULT_IMPORT_OPTIONS.createMissing : Boolean(stored.createMissing),
    lookalikes: stored.lookalikes === 'add' ? 'add' : 'skip',
  };
}

function mappingOf(batch: BatchRow): (string | null)[] {
  const headers = batch.header ?? [];
  const stored = (batch.mapping ?? {}) as { columns?: unknown };
  const list = Array.isArray(stored.columns) ? stored.columns : [];
  return headers.map((_, index) => (typeof list[index] === 'string' ? (list[index] as string) : null));
}

const RESULT_URLS: Partial<Record<StreamId, () => string>> = {
  jobs: () => routes.jobs(),
  clients: () => routes.profit({ by: 'client' }),
  production: () => routes.logEntries(),
  labor_rates: () => routes.labor('rates'),
  indirect_time: () => routes.labor('time'),
  paid_hours: () => routes.labor('time'),
  time_punches: () => routes.labor('time'),
  services: () => routes.services(),
  services_done: () => routes.services(),
  target_pace: () => routes.targetPace(),
  goals: () => routes.goals(),
  job_plans: () => routes.jobs(),
  costs: () => routes.profit(),
  revenue: () => routes.profit(),
  materials: () => routes.jobs(),
};

async function toBatchDTO(executor: Executor, batch: BatchRow, names?: ReadonlyMap<string, { name: string }>): Promise<ImportBatchDTO> {
  const stream = batch.stream as StreamId;
  const extra = (batch.options ?? {}) as Record<string, unknown>;
  const found = await rows<{ action: string | null; n: number; warned: number }>(
    executor,
    sql`SELECT action, count(*)::int AS n, count(*) FILTER (WHERE messages @> '[{"level":"warning"}]'::jsonb)::int AS warned FROM pulse.import_rows WHERE batch_id = ${batch.id} GROUP BY action`,
  );
  const counts: Record<string, number> = { ...EMPTY_IMPORT_COUNTS };
  for (const row of found) {
    if (row.action && row.action in counts) counts[row.action] = row.n;
    counts.warning = (counts.warning ?? 0) + row.warned;
  }
  const people = names ?? (batch.createdBy ? await getPeople([batch.createdBy], executor) : new Map<string, { name: string }>());
  const status = batch.status as ImportStatus;
  const canUndo = status === 'committed' && batch.undoUntil !== null && batch.undoUntil.getTime() > Date.now();
  let resultUrl: string | null = null;
  try {
    resultUrl = status === 'committed' ? (RESULT_URLS[stream]?.() ?? null) : null;
  } catch {
    resultUrl = null;
  }
  return {
    id: batch.id,
    stream,
    streamName: streamInfo(stream)?.name ?? stream,
    fileName: batch.fileName,
    fileSize: batch.fileSize,
    status,
    headers: batch.header ?? [],
    mapping: mappingOf(batch),
    options: optionsOf(batch),
    totalRows: batch.totalRows,
    counts: counts as unknown as ImportCounts,
    willCreate: Array.isArray(extra.willCreate) ? (extra.willCreate as ImportWillCreate[]) : [],
    problems: Array.isArray(extra.problems) ? (extra.problems as string[]) : [],
    sameFileNote: typeof extra.sameFileNote === 'string' ? extra.sameFileNote : null,
    dateOrderNote: typeof extra.dateOrderNote === 'string' ? extra.dateOrderNote : null,
    createdAt: isoRequired(batch.createdAt),
    createdBy: batch.createdBy,
    createdByName: batch.createdBy ? (people.get(batch.createdBy)?.name ?? null) : null,
    committedAt: iso(batch.committedAt),
    undoneAt: iso(batch.undoneAt),
    undoUntil: iso(batch.undoUntil),
    canUndo,
    undoLeft: typeof extra.undoLeft === 'number' ? extra.undoLeft : 0,
    resultUrl,
  };
}

async function accessFor(ctx: DomainContext, stream: string): Promise<PulseAccess> {
  const access = await pulseAccessFor(ctx);
  if (!isStreamId(stream)) throw invalid(`There is no kind of data called ${stream}. Pick one of: ${STREAM_IDS.join(', ')}.`);
  if (!canImportStream(access.role, stream)) throw forbidden('Your Pulse role cannot import this kind of file. Ask a manager to do it.');
  if (stream === 'labor_rates' && !canPulse(access.role, 'rate:manage')) throw forbidden('Only an admin can import labor rates, because they hold wages.');
  return access;
}

async function getBatchRow(executor: Executor, ctx: DomainContext, batchId: string, lock = false): Promise<BatchRow> {
  if (!isUuid(batchId)) throw notFound('That import');
  const query = executor.select().from(importBatches).where(and(eq(importBatches.orgId, ctx.orgId), eq(importBatches.id, batchId)));
  const [batch] = lock ? await query.for('update') : await query;
  if (!batch) throw notFound('That import');
  return batch;
}

export interface CreateImportInput {
  readonly stream: string;
  readonly fileName?: string | null;
  readonly fileSize?: number | null;
  readonly fileHash?: string | null;
  readonly delimiter?: string | null;
  readonly headers: readonly string[];
}

function presetDTO(row: typeof importPresets.$inferSelect, signature?: string): ImportPresetDTO {
  return { id: row.id, stream: row.stream as StreamId, name: row.name, mapping: (row.mapping ?? {}) as Record<string, string | null>, options: (row.options ?? {}) as Partial<ImportOptions>, lastUsedAt: iso(row.lastUsedAt), matchesFile: signature ? row.headerSignature === signature : undefined };
}

/** Opens a batch for a file. Returns the first column mapping (a saved preset when the headers are known). */
export async function createImportBatch(ctx: DomainContext, input: CreateImportInput): Promise<ImportStartDTO> {
  const access = await accessFor(ctx, input.stream);
  void access;
  const stream = input.stream as StreamId;
  const headers = input.headers.map((header) => String(header ?? '').slice(0, 200));
  if (headers.length === 0 || headers.every((header) => header.trim() === '')) throw invalid('This file has no header row. The first row must name the columns.');
  if (headers.length > IMPORT_LIMITS.maxColumns) throw invalid(`This file has ${headers.length} columns. The most Pulse can read is ${IMPORT_LIMITS.maxColumns}.`);
  if ((input.fileSize ?? 0) > IMPORT_LIMITS.maxBytes) throw invalid('This file is bigger than 10 MB. Split it into smaller files and import them one at a time.');
  return inTx(async (tx) => {
    await loadSettings(ctx.orgId, tx);
    // Old unfinished batches are cleaned up, then the limits apply.
    await tx.execute(sql`DELETE FROM pulse.import_rows WHERE batch_id IN (SELECT id FROM pulse.import_batches WHERE org_id = ${ctx.orgId} AND status IN ('uploading', 'mapped', 'checked') AND created_at < now() - interval '1 day')`);
    await tx.execute(sql`DELETE FROM pulse.import_batches WHERE org_id = ${ctx.orgId} AND status IN ('uploading', 'mapped', 'checked') AND created_at < now() - interval '1 day'`);
    const [load] = await rows<{ open: number; recent: number }>(
      tx,
      sql`SELECT count(*) FILTER (WHERE status IN ('uploading', 'mapped', 'checked'))::int AS open,
                 count(*) FILTER (WHERE created_by = ${ctx.userId} AND created_at > now() - interval '1 hour')::int AS recent
            FROM pulse.import_batches WHERE org_id = ${ctx.orgId}`,
    );
    if ((load?.open ?? 0) >= IMPORT_LIMITS.unfinishedPerOrg) throw conflict(`Your workspace has ${IMPORT_LIMITS.unfinishedPerOrg} imports that are not finished. Finish or discard one on the Import page, then try again.`);
    if ((load?.recent ?? 0) >= uploadsPerHour()) throw conflict(`You have started ${load?.recent} imports in the last hour. Wait a little, then try again.`);

    const signature = headerSignature(headers);
    const presets = await tx.select().from(importPresets).where(and(eq(importPresets.orgId, ctx.orgId), eq(importPresets.stream, stream))).orderBy(sql`${importPresets.lastUsedAt} DESC NULLS LAST`);
    const applied = presets.find((preset) => preset.headerSignature === signature) ?? null;
    const def = anyStreamDef(stream);
    const auto = mapHeaders(headers, def.columns, applied ? { preset: applied.mapping as Record<string, string | null>, fuzzy: true } : { fuzzy: true });
    const options: Record<string, unknown> = { ...DEFAULT_IMPORT_OPTIONS, ...(applied ? (applied.options as Record<string, unknown>) : {}) };
    const settings = await loadSettings(ctx.orgId, tx);
    void settings;
    const hash = cleanText(input.fileHash);
    if (hash) {
      const [same] = await tx
        .select({ at: importBatches.committedAt })
        .from(importBatches)
        .where(and(eq(importBatches.orgId, ctx.orgId), eq(importBatches.stream, stream), eq(importBatches.fileHash, hash), eq(importBatches.status, 'committed')))
        .orderBy(desc(importBatches.committedAt))
        .limit(1);
      if (same?.at) options.sameFileNote = `You imported this same file on ${shortDate(same.at.toISOString().slice(0, 10))}. Rows that are already here will read "No change".`;
    }
    const [batch] = await tx
      .insert(importBatches)
      .values({ orgId: ctx.orgId, stream, fileName: cleanText(input.fileName)?.slice(0, 200) ?? null, fileSize: input.fileSize ?? null, fileHash: hash, delimiter: input.delimiter ?? ',', header: headers, mapping: { columns: auto.columns }, options, status: 'uploading', createdBy: ctx.userId })
      .returning();
    if (applied) await tx.update(importPresets).set({ lastUsedAt: new Date() }).where(eq(importPresets.id, applied.id));
    return { batch: await toBatchDTO(tx, batch as BatchRow), presets: presets.map((preset) => presetDTO(preset, signature)), appliedPresetId: applied?.id ?? null };
  });
}

function uploadsPerHour(): number {
  const override = Number(process.env.PULSE_IMPORT_UPLOADS_PER_HOUR);
  return Number.isInteger(override) && override > 0 ? override : IMPORT_LIMITS.uploadsPerHour;
}

export interface ImportRowInput {
  /** Spreadsheet row number (the header row is row 1). */
  readonly n: number;
  readonly cells: readonly string[];
}

/** Stores one chunk of raw rows. Only strings are kept: everything else happens on the server later. */
export async function appendImportRows(ctx: DomainContext, batchId: string, chunk: readonly ImportRowInput[], options: { done?: boolean } = {}): Promise<{ totalRows: number; status: ImportStatus }> {
  if (chunk.length === 0 && !options.done) throw invalid('There are no rows in this part of the file.');
  if (chunk.length > 1000) throw invalid('Send at most 1,000 rows at a time.');
  return inTx(async (tx) => {
    const batch = await getBatchRow(tx, ctx, batchId, true);
    await accessFor(ctx, batch.stream);
    if (batch.status !== 'uploading') throw conflict('This import already has its rows. Start a new import to send another file.');
    const width = (batch.header ?? []).length;
    if (batch.totalRows + chunk.length > IMPORT_LIMITS.maxRows) throw invalid(`This file has more than ${IMPORT_LIMITS.maxRows.toLocaleString('en-US')} rows. Split it into smaller files.`);
    let last = batch.totalRows === 0 ? 1 : ((await rows<{ n: number }>(tx, sql`SELECT max(row_number)::int AS n FROM pulse.import_rows WHERE batch_id = ${batch.id}`))[0]?.n ?? 1);
    let bytes = 0;
    const values = chunk.map((row) => {
      if (!Number.isInteger(row.n) || row.n <= last) throw invalid('The rows of this file arrived out of order. Start the import again.');
      last = row.n;
      if (!Array.isArray(row.cells) || row.cells.length > Math.max(width, 1) + 50 || row.cells.length > IMPORT_LIMITS.maxColumns) throw invalid(`Row ${row.n} has more cells than the header row has columns. Check for a stray separator.`);
      const cells = row.cells.slice(0, width).map((cell) => {
        const value = typeof cell === 'string' ? cell : cell === null || cell === undefined ? '' : String(cell);
        if (value.length > IMPORT_LIMITS.maxCellChars) throw invalid(`Row ${row.n} has a cell with more than ${IMPORT_LIMITS.maxCellChars.toLocaleString('en-US')} characters. Shorten it and try again.`);
        bytes += value.length;
        return value;
      });
      while (cells.length < width) cells.push('');
      return { orgId: ctx.orgId, batchId: batch.id, rowNumber: row.n, raw: { c: cells } };
    });
    const stored = Number(((batch.options ?? {}) as Record<string, unknown>).bytes ?? 0) + bytes;
    if (stored > IMPORT_LIMITS.maxBytes * 2) throw invalid('This file is bigger than 10 MB. Split it into smaller files and import them one at a time.');
    if (values.length > 0) await tx.insert(importRows).values(values);
    const totalRows = batch.totalRows + values.length;
    if (options.done && totalRows === 0) throw invalid('This file has no rows under the header row.');
    const status: ImportStatus = options.done ? 'mapped' : 'uploading';
    await tx.update(importBatches).set({ totalRows, status, options: { ...(batch.options ?? {}), bytes: stored }, updatedAt: new Date() }).where(eq(importBatches.id, batch.id));
    return { totalRows, status };
  });
}

async function loadRaw(executor: Executor, batchId: string): Promise<RawRow[]> {
  const found = await rows<{ n: number; raw: { c?: unknown; s?: unknown } | null }>(executor, sql`SELECT row_number AS n, raw FROM pulse.import_rows WHERE batch_id = ${batchId} ORDER BY row_number`);
  return found.map((row) => ({ n: row.n, cells: Array.isArray(row.raw?.c) ? (row.raw.c as string[]) : [], skip: row.raw?.s === true }));
}

async function writePlan(executor: Executor, batchId: string, plan: Plan): Promise<void> {
  for (let offset = 0; offset < plan.rows.length; offset += 2000) {
    const part = plan.rows.slice(offset, offset + 2000).map((row) => ({ n: row.n, action: row.action, messages: row.messages, parsed: { changes: row.changes }, entity_id: row.entityId }));
    await executor.execute(sql`
      UPDATE pulse.import_rows ir SET action = v.action, messages = COALESCE(v.messages, '[]'::jsonb), parsed = v.parsed, entity_id = v.entity_id, before = NULL, updated_at = now()
        FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb) AS v(n int, action text, messages jsonb, parsed jsonb, entity_id uuid)
       WHERE ir.batch_id = ${batchId} AND ir.row_number = v.n`);
  }
}

function countsOf(plan: Plan): ImportCounts {
  const counts = { ...EMPTY_IMPORT_COUNTS } as Record<keyof ImportCounts, number>;
  for (const row of plan.rows) {
    counts[row.action] += 1;
    if (row.messages.some((message) => message.level === 'warning')) counts.warning += 1;
  }
  return counts;
}

const PROGRESS: Map<string, ImportProgressDTO> = ((globalThis as unknown as { __pulseImportProgress?: Map<string, ImportProgressDTO> }).__pulseImportProgress ??= new Map());

/** Where a running check or save is. Kept in memory on the server that runs it. */
export async function getImportProgress(ctx: DomainContext, batchId: string): Promise<ImportProgressDTO> {
  await getBatchRow(db, ctx, batchId);
  return PROGRESS.get(batchId) ?? { phase: 'idle', done: 0, total: 0 };
}

export interface CheckImportInput {
  /** For each header of the file: the stream column it feeds, or null to ignore it. */
  readonly mapping?: readonly (string | null)[];
  readonly options?: Partial<ImportOptions>;
  /** Save this mapping under a name, so the next file with the same headers maps itself. */
  readonly savePresetAs?: string | null;
}

/** The dry run. Reads every row, gives it an action and saves nothing but the check results. */
export async function checkImportBatch(ctx: DomainContext, batchId: string, input: CheckImportInput = {}): Promise<ImportBatchDTO> {
  return inTx(async (tx) => {
    const batch = await getBatchRow(tx, ctx, batchId, true);
    const access = await accessFor(ctx, batch.stream);
    if (batch.status === 'committed' || batch.status === 'undone') throw conflict('This import is already finished. Start a new import to bring in another file.');
    if (batch.status === 'uploading') throw conflict('This file did not finish uploading. Discard this import and start again.');
    const headers = batch.header ?? [];
    const mapping = input.mapping ? headers.map((_, index) => (typeof input.mapping?.[index] === 'string' ? (input.mapping[index] as string) : null)) : mappingOf(batch);
    const options: ImportOptions = { ...optionsOf(batch), ...(input.options ?? {}) };
    PROGRESS.set(batch.id, { phase: 'checking', done: 0, total: batch.totalRows });
    try {
      const raw = await loadRaw(tx, batch.id);
      const plan = await planBatch(tx, ctx, access, batch, raw, mapping, options);
      await writePlan(tx, batch.id, plan);
      const counts = countsOf(plan);
      const stored = (batch.options ?? {}) as Record<string, unknown>;
      const [updated] = await tx
        .update(importBatches)
        .set({
          mapping: { columns: mapping },
          options: { ...options, bytes: stored.bytes ?? 0, sameFileNote: stored.sameFileNote ?? null, willCreate: plan.willCreate, problems: plan.problems, dateOrderNote: plan.dateOrderNote, layout: plan.layout },
          status: 'checked',
          createCount: counts.create,
          updateCount: counts.update,
          unchangedCount: counts.unchanged,
          skipCount: counts.skip + counts.lookalike,
          errorCount: counts.error,
          warningCount: counts.warning,
          updatedAt: new Date(),
        })
        .where(eq(importBatches.id, batch.id))
        .returning();
      const presetName = cleanText(input.savePresetAs);
      if (presetName) await upsertPreset(tx, ctx, batch.stream as StreamId, presetName.slice(0, 80), headers, mapping, options);
      return await toBatchDTO(tx, updated as BatchRow);
    } finally {
      PROGRESS.delete(batch.id);
    }
  });
}

async function upsertPreset(tx: Executor, ctx: DomainContext, stream: StreamId, name: string, headers: readonly string[], mapping: readonly (string | null)[], options: ImportOptions): Promise<void> {
  const values = { headerSignature: headerSignature(headers), mapping: mappingToPreset(headers, mapping), options: { mode: options.mode, dateOrder: options.dateOrder, createMissing: options.createMissing, lookalikes: options.lookalikes }, lastUsedAt: new Date(), updatedAt: new Date() };
  await tx
    .insert(importPresets)
    .values({ orgId: ctx.orgId, stream, name, ...values })
    .onConflictDoUpdate({ target: [importPresets.orgId, importPresets.stream, importPresets.name], set: values });
}

export async function getImportBatch(ctx: DomainContext, batchId: string): Promise<ImportBatchDTO> {
  const batch = await getBatchRow(db, ctx, batchId);
  await accessFor(ctx, batch.stream);
  return toBatchDTO(db, batch);
}

/** True when the batch exists in this workspace (for the real 404 of the batch page). */
export async function importBatchExists(ctx: DomainContext, batchId: string): Promise<boolean> {
  if (!isUuid(batchId)) return false;
  const [row] = await db.select({ id: importBatches.id }).from(importBatches).where(and(eq(importBatches.orgId, ctx.orgId), eq(importBatches.id, batchId)));
  return Boolean(row);
}

export interface ImportRowFilters {
  readonly action?: ImportAction | 'problems' | 'all' | null;
  readonly offset?: number;
  readonly limit?: number;
}

/** The preview rows of a batch, with every message on its cell. */
export async function listImportRows(ctx: DomainContext, batchId: string, filters: ImportRowFilters = {}): Promise<ImportRowsPage> {
  const batch = await getBatchRow(db, ctx, batchId);
  await accessFor(ctx, batch.stream);
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  const where =
    filters.action === 'problems'
      ? sql`AND (action = 'error' OR messages @> '[{"level":"warning"}]'::jsonb)`
      : filters.action && filters.action !== 'all'
        ? sql`AND action = ${filters.action}`
        : sql``;
  // The daily cleanup empties the row bodies once the undo window has passed. Counts and messages stay.
  const [total] = await rows<{ n: number; cleared: number }>(db, sql`SELECT count(*) FILTER (WHERE raw IS NOT NULL)::int AS n, count(*) FILTER (WHERE raw IS NULL)::int AS cleared FROM pulse.import_rows WHERE batch_id = ${batch.id} ${where}`);
  const found = await rows<{ n: number; raw: { c?: unknown; s?: unknown } | null; action: string | null; messages: unknown; parsed: { changes?: unknown } | null; entity_id: string | null }>(
    db,
    sql`SELECT row_number AS n, raw, action, messages, parsed, entity_id FROM pulse.import_rows WHERE batch_id = ${batch.id} AND raw IS NOT NULL ${where} ORDER BY row_number LIMIT ${limit} OFFSET ${offset}`,
  );
  return {
    total: total?.n ?? 0,
    cleared: (total?.n ?? 0) === 0 && (total?.cleared ?? 0) > 0,
    rows: found.map(
      (row): ImportRowDTO => ({
        rowNumber: row.n,
        cells: Array.isArray(row.raw?.c) ? (row.raw.c as string[]) : [],
        action: (row.action as ImportAction | null) ?? null,
        skippedByUser: row.raw?.s === true,
        messages: Array.isArray(row.messages) ? (row.messages as ImportMessage[]) : [],
        changes: Array.isArray(row.parsed?.changes) ? (row.parsed.changes as ImportChange[]) : [],
        entityId: row.entity_id,
      }),
    ),
  };
}

export interface EditImportRowInput {
  readonly rowNumber: number;
  /** New raw cells for the row, in header order. */
  readonly cells?: readonly string[];
  /** Leave this row out, or bring it back. */
  readonly skip?: boolean;
}

/** Fixes one row in place (or leaves it out) and runs the check again. */
export async function editImportRows(ctx: DomainContext, batchId: string, edits: readonly EditImportRowInput[]): Promise<ImportBatchDTO> {
  if (edits.length === 0 || edits.length > 500) throw invalid('Change between 1 and 500 rows at a time.');
  await inTx(async (tx) => {
    const batch = await getBatchRow(tx, ctx, batchId, true);
    await accessFor(ctx, batch.stream);
    if (batch.status === 'committed' || batch.status === 'undone') throw conflict('This import is already finished, so its rows cannot be changed.');
    const width = (batch.header ?? []).length;
    for (const edit of edits) {
      const [row] = await rows<{ id: string; raw: { c?: unknown; s?: unknown } | null }>(tx, sql`SELECT id, raw FROM pulse.import_rows WHERE batch_id = ${batch.id} AND row_number = ${edit.rowNumber}`);
      if (!row) throw notFound(`Row ${edit.rowNumber}`);
      const cells = edit.cells
        ? Array.from({ length: width }, (_, index) => {
            const value = String(edit.cells?.[index] ?? '');
            if (value.length > IMPORT_LIMITS.maxCellChars) throw invalid(`A cell can hold at most ${IMPORT_LIMITS.maxCellChars.toLocaleString('en-US')} characters.`);
            return value;
          })
        : Array.isArray(row.raw?.c)
          ? (row.raw.c as string[])
          : [];
      const skip = edit.skip === undefined ? row.raw?.s === true : edit.skip;
      await tx.execute(sql`UPDATE pulse.import_rows SET raw = ${JSON.stringify(skip ? { c: cells, s: true } : { c: cells })}::jsonb, updated_at = now() WHERE id = ${row.id}`);
    }
  });
  return checkImportBatch(ctx, batchId);
}

/** Throws away a batch that was never saved. */
export async function discardImportBatch(ctx: DomainContext, batchId: string): Promise<void> {
  await inTx(async (tx) => {
    const batch = await getBatchRow(tx, ctx, batchId, true);
    await accessFor(ctx, batch.stream);
    if (batch.status === 'committed' || batch.status === 'undone') throw conflict('This import was saved, so it stays in the history. Use Undo to take its rows back out.');
    await tx.delete(importRows).where(eq(importRows.batchId, batch.id));
    await tx.delete(importBatches).where(eq(importBatches.id, batch.id));
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Commit                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const tableName = (handler: Handler): SQL => sql.raw(`pulse.${getTableName(handler.table)}`);
const stampExpr = (handler: Handler, alias = 't'): SQL => sql.raw(handler.stamp === 'version' ? `${alias}.version::text` : `${alias}.updated_at::text`);

/** Snapshots for undo: the whole row, plus the price, quote and links of a job, or the lines of a plan. */
async function snapshotBefore(tx: Executor, batchId: string, stream: StreamId, handler: Handler): Promise<void> {
  const extra =
    stream === 'jobs'
      ? sql`, 'extra', jsonb_build_object(
            'price', (SELECT to_jsonb(p) FROM pulse.job_prices p WHERE p.job_id = t.id ORDER BY p.effective_from DESC LIMIT 1),
            'quote', (SELECT to_jsonb(q) FROM pulse.job_plans q WHERE q.job_id = t.id AND q.plan = 'quote'),
            'links', (SELECT COALESCE(jsonb_agg(to_jsonb(l)), '[]'::jsonb) FROM pulse.job_links l WHERE l.job_id = t.id AND l.target_type IN ('wms_work_order', 'crm_deal', 'pm_project')))`
      : stream === 'job_plans'
        ? sql`, 'extra', jsonb_build_object('lines', (SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.position), '[]'::jsonb) FROM pulse.job_plan_lines l WHERE l.plan_id = t.id))`
        : sql``;
  await tx.execute(sql`
    UPDATE pulse.import_rows ir SET before = jsonb_build_object('created', false, 'row', to_jsonb(t)${extra})
      FROM ${tableName(handler)} t
     WHERE ir.batch_id = ${batchId} AND ir.action = 'update' AND ir.entity_id = t.id`);
}

async function stampAfter(tx: Executor, batchId: string, handler: Handler): Promise<void> {
  await tx.execute(sql`
    UPDATE pulse.import_rows ir SET before = COALESCE(ir.before, '{}'::jsonb) || jsonb_build_object('created', ir.action = 'create', 'stamp', ${stampExpr(handler)})
      FROM ${tableName(handler)} t
     WHERE ir.batch_id = ${batchId} AND ir.action IN ('create', 'update') AND ir.entity_id = t.id`);
}

async function setEntityIds(tx: Executor, batchId: string, pairs: readonly { n: number; id: string }[]): Promise<void> {
  for (let offset = 0; offset < pairs.length; offset += 2000) {
    await tx.execute(sql`
      UPDATE pulse.import_rows ir SET entity_id = v.id
        FROM jsonb_to_recordset(${JSON.stringify(pairs.slice(offset, offset + 2000))}::jsonb) AS v(n int, id uuid)
       WHERE ir.batch_id = ${batchId} AND ir.row_number = v.n`);
  }
}

interface TouchedRow {
  readonly site_id: string | null;
  readonly d: string | null;
  readonly job_id: string | null;
  readonly client_id: string | null;
  readonly scope: string | null;
}

const writtenBy = (batchId: string): SQL => sql`(SELECT entity_id FROM pulse.import_rows WHERE batch_id = ${batchId} AND action IN ('create', 'update') AND entity_id IS NOT NULL)`;

/** The site, day, job and client of every row a batch wrote, as they are now and as they were before it. */
async function touchedRows(tx: Executor, batchId: string, stream: StreamId, handler: Handler): Promise<TouchedRow[]> {
  if (handler.recalc === 'jobs') {
    return rows<TouchedRow>(tx, sql`SELECT NULL::uuid AS site_id, NULL::text AS d, t.job_id, NULL::uuid AS client_id, NULL::text AS scope FROM pulse.job_plans t WHERE t.id IN ${writtenBy(batchId)}`);
  }
  if (handler.recalc !== 'days') return [];
  const dateColumn = stream === 'costs' ? 'cost_date' : stream === 'revenue' ? 'revenue_date' : stream === 'materials' ? 'usage_date' : 'work_date';
  const hasJob = stream !== 'indirect_time' && stream !== 'paid_hours';
  const hasClient = stream === 'costs' || stream === 'revenue' || stream === 'services_done';
  return rows<TouchedRow>(
    tx,
    sql`SELECT t.site_id, to_char(t.${sql.raw(dateColumn)}, 'YYYY-MM-DD') AS d, ${sql.raw(hasJob ? 't.job_id' : 'NULL::uuid')} AS job_id, ${sql.raw(hasClient ? 't.client_id' : 'NULL::uuid')} AS client_id,
               ${sql.raw(stream === 'costs' ? 't.scope' : 'NULL::text')} AS scope
          FROM ${tableName(handler)} t WHERE t.id IN ${writtenBy(batchId)}
        UNION ALL
        SELECT (ir.before->'row'->>'site_id')::uuid, ir.before->'row'->>${dateColumn}, (ir.before->'row'->>'job_id')::uuid, (ir.before->'row'->>'client_id')::uuid, ir.before->'row'->>'scope'
          FROM pulse.import_rows ir WHERE ir.batch_id = ${batchId} AND ir.action = 'update' AND ir.before ? 'row'`,
  );
}

/** Restamps and rebuilds what the batch moved. Dated streams touch only their days and jobs. */
async function recalcAfter(tx: Executor, ctx: DomainContext, batchId: string, stream: StreamId, handler: Handler, pre: readonly TouchedRow[] = []): Promise<void> {
  if (handler.recalc === 'none') return;
  if (handler.recalc === 'org') {
    await recalcOrg(tx, ctx);
    return;
  }
  const mine = writtenBy(batchId);
  const all = [...pre, ...(await touchedRows(tx, batchId, stream, handler))];
  if (handler.recalc === 'jobs') {
    const jobIds = [...new Set(all.map((row) => row.job_id).filter((id): id is string => Boolean(id)))];
    if (jobIds.length > 0) await recomputeJobs(tx, ctx, jobIds);
    return;
  }
  const touched = newTouched();
  const usesDays = stream === 'production' || stream === 'indirect_time' || stream === 'paid_hours' || stream === 'services_done' || stream === 'time_punches';
  const punchDays = new Map<string, { siteId: string; date: string }>();
  let defaultSite: string | null | undefined;
  for (const row of all) {
    if (stream === 'costs') {
      if (row.scope === 'company') {
        if (defaultSite === undefined) defaultSite = (await rows<{ id: string }>(tx, sql`SELECT id FROM pulse.sites WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1`))[0]?.id ?? null;
        touchDay(touched, row.site_id ?? defaultSite, row.d);
      } else touchJob(touched, row.job_id, row.client_id);
      continue;
    }
    if (usesDays) touchDay(touched, row.site_id, row.d);
    if (stream === 'time_punches') {
      if (row.site_id && row.d) punchDays.set(`${row.site_id}:${row.d}`, { siteId: row.site_id, date: row.d });
      continue;
    }
    touchJob(touched, row.job_id, row.client_id);
  }
  if (stream === 'production') {
    await restampProduction(tx, ctx.orgId, sql`src.id IN ${mine}`);
    const jobIds = [...touched.jobIds];
    const fixed = jobIds.length > 0 ? await rows<{ id: string }>(tx, sql`SELECT id FROM pulse.jobs WHERE org_id = ${ctx.orgId} AND pricing_model = 'fixed' AND id = ANY(${uuidArray(jobIds)})`) : [];
    for (const job of fixed) await restampFixedJob(tx, ctx, job.id);
  } else if (stream === 'indirect_time') await restampIndirect(tx, ctx.orgId, sql`src.id IN ${mine}`);
  else if (stream === 'services_done') await restampVas(tx, ctx.orgId, sql`src.id IN ${mine}`);
  else if (stream === 'materials') await restampUsage(tx, ctx.orgId, sql`src.id IN ${mine}`);
  else if (stream === 'time_punches') await rollupPunches(tx, ctx, [...punchDays.values()], touched);
  await finishWrite(tx, ctx, touched);
}

/** Saves the batch in one transaction: either every row that should be saved is saved, or nothing is. */
export async function commitImportBatch(ctx: DomainContext, batchId: string): Promise<ImportBatchDTO> {
  try {
    return await inTx(async (tx) => {
      const batch = await getBatchRow(tx, ctx, batchId, true);
      const access = await accessFor(ctx, batch.stream);
      if (batch.status === 'committed') throw conflict('This import was already saved.');
      if (batch.status !== 'checked') throw conflict('Check this import first, then save it.');
      const stream = batch.stream as StreamId;
      const handler = HANDLERS[stream];
      const options = optionsOf(batch);
      const total = batch.totalRows;
      PROGRESS.set(batch.id, { phase: 'checking', done: 0, total });
      // Plan again inside the transaction: the data may have moved since the check.
      const plan = await planBatch(tx, ctx, access, batch, await loadRaw(tx, batch.id), mappingOf(batch), options);
      if (plan.problems.length > 0) throw invalid(plan.problems[0] as string);
      const counts = countsOf(plan);
      if (counts.error > 0 && options.mode === 'all_or_nothing') {
        throw invalid(`${counts.error} ${counts.error === 1 ? 'row has a problem' : 'rows have problems'}, so nothing was saved. Fix them, leave them out, or switch to "Skip bad rows".`);
      }
      await writePlan(tx, batch.id, plan);
      await snapshotBefore(tx, batch.id, stream, handler);
      const made = await ensurePending(tx, plan.env);
      const env = plan.env;
      const writes = plan.rows.filter((row) => row.action === 'create' || row.action === 'update');
      const def = anyStreamDef(stream);
      const hasEntryId = def.columns.some((column) => column.key === 'entry_id');
      let done = 0;
      const tick = (step: number): void => {
        done += step;
        PROGRESS.set(batch.id, { phase: 'saving', done, total: writes.length });
      };
      tick(0);

      if (plan.layout === 'lines') {
        const groups = new Map<string, RowPlan[]>();
        for (const row of writes) groups.set(row.group ?? '', [...(groups.get(row.group ?? '') ?? []), row]);
        const pairs: { n: number; id: string }[] = [];
        for (const list of groups.values()) {
          const first = (list[0] as RowPlan).planned as Planned;
          const jobId = first.refs.job?.id;
          if (!jobId) continue;
          const lines: PlanLineInput[] = list.map((row) => {
            const { rec, refs } = row.planned as Planned;
            return { category: rec.category as PlanLineInput['category'], description: text(rec.description), quantity: text(rec.quantity), unit: (rec.unit as PlanLineInput['unit']) ?? null, unitAmount: text(rec.unitAmount), amountCents: cents(rec.amount) ?? 0, laborClassId: refs.laborClass?.id ?? null, vasServiceId: refs.service?.id ?? null, itemId: refs.item?.id ?? null };
          });
          const saved = await upsertPlan(tx, ctx, jobId, first.rec.plan as 'quote' | 'budget', (list[0] as RowPlan).existing ? { lines } : { lines, origin: 'csv' });
          for (const row of list) pairs.push({ n: row.n, id: saved.id });
          tick(list.length);
        }
        await setEntityIds(tx, batch.id, pairs);
      } else {
        const base = (): Record<string, unknown> => (handler.hasSource ? { source: 'csv', importBatchId: batch.id, createdBy: ctx.userId, updatedBy: ctx.userId } : {});
        const creates = writes.filter((row) => row.action === 'create');
        const pairs: { n: number; id: string }[] = [];
        if (handler.createOne) {
          for (const row of creates) {
            pairs.push({ n: row.n, id: await handler.createOne(tx, env, row.planned as Planned) });
            tick(1);
          }
        } else if (handler.values) {
          for (let offset = 0; offset < creates.length; offset += 500) {
            const part = creates.slice(offset, offset + 500);
            const values = part.map((row) => {
              const planned = row.planned as Planned;
              const entryId = hasEntryId && typeof planned.rec.entryId === 'string' ? planned.rec.entryId.toLowerCase() : null;
              return { orgId: ctx.orgId, ...base(), ...(handler.hasSource && entryId ? { sourceRef: entryId } : {}), ...(handler.defaults?.(planned, env) ?? {}), ...handler.values?.(planned, env, null) };
            });
            const inserted = (await tx
              .insert(handler.table)
              .values(values as never)
              .returning({ id: (handler.table as unknown as { id: never }).id })) as { id: string }[];
            inserted.forEach((row, index) => pairs.push({ n: (part[index] as RowPlan).n, id: row.id }));
            tick(part.length);
          }
        }
        await setEntityIds(tx, batch.id, pairs);
        for (const row of writes) {
          if (row.action !== 'update' || !row.existing) continue;
          const planned = row.planned as Planned;
          if (handler.updateOne) await handler.updateOne(tx, env, planned, row.existing, new Set(row.changes.map((change) => change.column)));
          else if (handler.values) {
            const idColumn = (handler.table as unknown as { id: never }).id;
            const extra: Record<string, unknown> = handler.stamp === 'version' ? { version: sql`version + 1`, updatedAt: new Date() } : { updatedAt: new Date() };
            if (handler.hasSource) extra.updatedBy = ctx.userId;
            await tx
              .update(handler.table)
              .set({ ...handler.values(planned, env, row.existing.record), ...extra } as never)
              .where(eq(idColumn, row.existing.id));
          }
          tick(1);
        }
      }

      PROGRESS.set(batch.id, { phase: 'totals', done: writes.length, total: writes.length });
      await recalcAfter(tx, ctx, batch.id, stream, handler);
      await stampAfter(tx, batch.id, handler);
      const stored = (batch.options ?? {}) as Record<string, unknown>;
      const [updated] = await tx
        .update(importBatches)
        .set({
          status: 'committed',
          committedAt: new Date(),
          undoUntil: new Date(Date.now() + IMPORT_LIMITS.undoDays * 86_400_000),
          createCount: counts.create,
          updateCount: counts.update,
          unchangedCount: counts.unchanged,
          skipCount: counts.skip + counts.lookalike + (options.mode === 'skip_bad_rows' ? counts.error : 0),
          errorCount: counts.error,
          warningCount: counts.warning,
          options: { ...stored, created: made, willCreate: plan.willCreate, problems: [], undoLeft: 0 },
          updatedAt: new Date(),
        })
        .where(eq(importBatches.id, batch.id))
        .returning();
      await logActivity(tx, ctx, {
        verb: 'import.committed',
        entityType: 'import',
        entityId: batch.id,
        after: { stream, fileName: batch.fileName, created: counts.create, changed: counts.update, unchanged: counts.unchanged, skipped: counts.skip + counts.lookalike, problems: counts.error },
        meta: { stream, added: made.map((item) => `${KIND_WORDS[item.kind]} ${item.code}`) },
      });
      return await toBatchDTO(tx, updated as BatchRow);
    });
  } finally {
    PROGRESS.delete(batchId);
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Undo                                                                                        */
/* ------------------------------------------------------------------------------------------ */

/** Columns of a table that undo puts back (everything but identity and bookkeeping). */
function restoreColumns(handler: Handler): string[] {
  return Object.values(getTableColumns(handler.table))
    .map((column) => column.name)
    .filter((name) => !['id', 'org_id', 'version', 'created_at', 'updated_at'].includes(name));
}

/** Where a missing record that an import added may still be in use. */
const USED_BY: Readonly<Record<string, readonly [string, string, boolean][]>> = {
  client: [
    ['jobs', 'client_id', true],
    ['cost_entries', 'client_id', true],
    ['revenue_entries', 'client_id', true],
    ['vas_entries', 'client_id', true],
    ['items', 'client_id', true],
    ['standards', 'client_id', true],
  ],
  job_type: [
    ['jobs', 'job_type_id', true],
    ['standards', 'job_type_id', true],
  ],
  labor_class: [
    ['production_entries', 'labor_class_id', true],
    ['indirect_entries', 'labor_class_id', true],
    ['paid_hours', 'labor_class_id', true],
    ['time_punches', 'labor_class_id', true],
    ['vas_entries', 'labor_class_id', true],
    ['labor_rates', 'labor_class_id', true],
    ['jobs', 'default_labor_class_id', true],
    ['job_types', 'default_labor_class_id', true],
    ['vas_services', 'default_labor_class_id', true],
    ['standards', 'labor_class_id', true],
  ],
  item: [['material_usage', 'item_id', true]],
};
const KIND_TABLES: Readonly<Record<string, string>> = { client: 'clients', job_type: 'job_types', labor_class: 'labor_classes', item: 'items' };

/** Takes a saved batch back out: changed rows get their old values, new rows are removed. */
export async function undoImportBatch(ctx: DomainContext, batchId: string): Promise<ImportBatchDTO> {
  return inTx(async (tx) => {
    const batch = await getBatchRow(tx, ctx, batchId, true);
    await accessFor(ctx, batch.stream);
    if (batch.status === 'undone') throw conflict('This import was already undone.');
    if (batch.status !== 'committed') throw conflict('Only a saved import can be undone.');
    if (!batch.undoUntil || batch.undoUntil.getTime() <= Date.now()) throw conflict(`An import can be undone for ${IMPORT_LIMITS.undoDays} days. That time has passed for this one.`);
    const stream = batch.stream as StreamId;
    const handler = HANDLERS[stream];
    const table = tableName(handler);
    const stamp = stampExpr(handler);
    const alive = handler.softDelete ? sql`AND t.deleted_at IS NULL` : sql``;
    const [left] = await rows<{ n: number }>(
      tx,
      sql`SELECT count(DISTINCT ir.entity_id)::int AS n FROM pulse.import_rows ir
           WHERE ir.batch_id = ${batch.id} AND ir.action IN ('create', 'update') AND ir.entity_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.id = ir.entity_id ${alive} AND ${stamp} = ir.before->>'stamp')`,
    );
    const mine = (action: 'create' | 'update'): SQL => sql`ir.batch_id = ${batch.id} AND ir.action = ${action} AND ir.entity_id = t.id AND t.org_id = ${ctx.orgId} ${alive} AND ${stamp} = ir.before->>'stamp'`;

    // Where the rows are now, so the rollups of those days and jobs are rebuilt after they move back.
    const pre = await touchedRows(tx, batch.id, stream, handler);

    if (stream === 'jobs') {
      await tx.execute(sql`
        UPDATE pulse.job_prices p SET unit_price = r.unit_price, bill_rate_cents = r.bill_rate_cents, material_cost_per_unit = r.material_cost_per_unit, updated_at = now()
          FROM pulse.import_rows ir JOIN ${table} t ON ${mine('update')}
          CROSS JOIN LATERAL jsonb_populate_record(NULL::pulse.job_prices, ir.before->'extra'->'price') r
         WHERE p.id = r.id AND jsonb_typeof(ir.before->'extra'->'price') = 'object'`);
      await tx.execute(sql`
        DELETE FROM pulse.job_plan_lines l USING pulse.job_plans q, pulse.import_rows ir, ${table} t
         WHERE ${mine('update')} AND q.job_id = t.id AND q.plan = 'quote' AND l.plan_id = q.id AND jsonb_typeof(ir.before->'extra'->'quote') IS DISTINCT FROM 'object'`);
      await tx.execute(sql`
        DELETE FROM pulse.job_plans q USING pulse.import_rows ir, ${table} t
         WHERE ${mine('update')} AND q.job_id = t.id AND q.plan = 'quote' AND jsonb_typeof(ir.before->'extra'->'quote') IS DISTINCT FROM 'object'`);
      await tx.execute(sql`
        UPDATE pulse.job_plans q SET units = r.units, revenue_cents = r.revenue_cents, labor_hours = r.labor_hours, labor_cents = r.labor_cents, setup_hours = r.setup_hours,
               setup_cents = r.setup_cents, material_cents = r.material_cents, other_cents = r.other_cents, shared_cents = r.shared_cents, shared_auto = r.shared_auto,
               origin = r.origin, origin_ref = r.origin_ref, note = r.note, version = q.version + 1, updated_at = now()
          FROM pulse.import_rows ir JOIN ${table} t ON ${mine('update')}
          CROSS JOIN LATERAL jsonb_populate_record(NULL::pulse.job_plans, ir.before->'extra'->'quote') r
         WHERE q.id = r.id AND jsonb_typeof(ir.before->'extra'->'quote') = 'object'`);
      await tx.execute(sql`
        DELETE FROM pulse.job_links l USING pulse.import_rows ir JOIN ${table} t ON ${mine('update')}
         WHERE l.job_id = t.id AND l.target_type IN ('wms_work_order', 'crm_deal', 'pm_project')`);
      await tx.execute(sql`
        INSERT INTO pulse.job_links SELECT r.* FROM pulse.import_rows ir JOIN ${table} t ON ${mine('update')}
          CROSS JOIN LATERAL jsonb_populate_recordset(NULL::pulse.job_links, ir.before->'extra'->'links') r
        ON CONFLICT DO NOTHING`);
    }
    if (stream === 'job_plans') {
      await tx.execute(sql`DELETE FROM pulse.job_plan_lines l USING pulse.import_rows ir JOIN ${table} t ON ${mine('update')} WHERE l.plan_id = t.id`);
      await tx.execute(sql`
        INSERT INTO pulse.job_plan_lines SELECT DISTINCT ON (r.id) r.* FROM pulse.import_rows ir JOIN ${table} t ON ${mine('update')}
          CROSS JOIN LATERAL jsonb_populate_recordset(NULL::pulse.job_plan_lines, ir.before->'extra'->'lines') r`);
      await tx.execute(sql`DELETE FROM pulse.job_plan_lines l USING pulse.import_rows ir JOIN ${table} t ON ${mine('create')} WHERE l.plan_id = t.id`);
    }

    // Changed rows get their old values back.
    const columns = restoreColumns(handler);
    const bump = handler.stamp === 'version' ? sql`, version = t.version + 1` : sql``;
    await tx.execute(sql`
      UPDATE ${table} t SET ${sql.raw(columns.map((column) => `"${column}" = r."${column}"`).join(', '))}${bump}, updated_at = now()
        FROM pulse.import_rows ir CROSS JOIN LATERAL jsonb_populate_record(NULL::${table}, ir.before->'row') r
       WHERE ir.batch_id = ${batch.id} AND ir.action = 'update' AND ir.entity_id = t.id AND t.org_id = ${ctx.orgId} ${alive} AND ${stamp} = ir.before->>'stamp'`);
    // New rows are removed.
    if (handler.softDelete) {
      await tx.execute(sql`UPDATE ${table} t SET deleted_at = now(), updated_at = now()${bump} FROM pulse.import_rows ir WHERE ${mine('create')}`);
    } else {
      await tx.execute(sql`DELETE FROM ${table} t USING pulse.import_rows ir WHERE ${mine('create')}`);
    }

    // Records the import added on the side (Create missing) go too, unless something still uses them.
    const stored = (batch.options ?? {}) as Record<string, unknown>;
    const made = Array.isArray(stored.created) ? (stored.created as { kind: string; id: string }[]) : [];
    for (const item of made) {
      const usedBy = USED_BY[item.kind];
      const target = KIND_TABLES[item.kind];
      if (!usedBy || !target || !isUuid(item.id)) continue;
      const free = sql.join(
        usedBy.map(([name, column]) => sql`NOT EXISTS (SELECT 1 FROM pulse.${sql.raw(name)} u WHERE u.org_id = ${ctx.orgId} AND u.${sql.raw(column)} = ${item.id} AND u.deleted_at IS NULL)`),
        sql` AND `,
      );
      await tx.execute(sql`UPDATE pulse.${sql.raw(target)} SET deleted_at = now(), updated_at = now() WHERE org_id = ${ctx.orgId} AND id = ${item.id} AND deleted_at IS NULL AND ${free}`);
    }

    await recalcAfter(tx, ctx, batch.id, stream, handler, pre);
    const [updated] = await tx
      .update(importBatches)
      .set({ status: 'undone', undoneAt: new Date(), options: { ...stored, undoLeft: left?.n ?? 0 }, updatedAt: new Date() })
      .where(eq(importBatches.id, batch.id))
      .returning();
    await logActivity(tx, ctx, { verb: 'import.undone', entityType: 'import', entityId: batch.id, after: { stream, fileName: batch.fileName, leftAlone: left?.n ?? 0 }, meta: { stream } });
    return toBatchDTO(tx, updated as BatchRow);
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Error report, history, presets                                                              */
/* ------------------------------------------------------------------------------------------ */

/** The rows that did not pass, with the file's own headers and a `problem` column, ready to fix and upload again. */
export async function importErrorReport(ctx: DomainContext, batchId: string): Promise<{ fileName: string; csv: string; rows: number }> {
  const batch = await getBatchRow(db, ctx, batchId);
  await accessFor(ctx, batch.stream);
  const headers = batch.header ?? [];
  const found = await rows<{ n: number; raw: { c?: unknown } | null; messages: unknown; action: string | null }>(
    db,
    sql`SELECT row_number AS n, raw, messages, action FROM pulse.import_rows WHERE batch_id = ${batch.id} AND action IN ('error', 'lookalike') ORDER BY row_number`,
  );
  const body = toCsv(
    [...headers, 'problem'],
    found.map((row) => {
      const cells = Array.isArray(row.raw?.c) ? (row.raw.c as string[]) : [];
      const messages = (Array.isArray(row.messages) ? (row.messages as ImportMessage[]) : []).filter((message) => message.level === 'error' || row.action === 'lookalike');
      return [...headers.map((_, index) => cleanCell(cells[index])), messages.map((message) => (message.column ? `${message.column}: ${message.text}` : message.text)).join(' ')];
    }),
  );
  await logActivity(db, ctx, { verb: 'export.run', entityType: 'export', meta: { stream: batch.stream, report: 'import_errors', rows: found.length, batchId: batch.id } });
  const base = (batch.fileName ?? `${batch.stream}.csv`).replace(/\.[A-Za-z0-9]+$/, '');
  return { fileName: `${base}-problems.csv`, csv: body, rows: found.length };
}

/** Past imports, newest first. */
export async function listImportBatches(ctx: DomainContext, filters: { limit?: number; stream?: string | null } = {}): Promise<ImportBatchDTO[]> {
  const access = await pulseAccessFor(ctx);
  if (!STREAM_IDS.some((stream) => canImportStream(access.role, stream))) throw forbidden('Your Pulse role cannot see imports.');
  const found = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.orgId, ctx.orgId), filters.stream && isStreamId(filters.stream) ? eq(importBatches.stream, filters.stream) : undefined))
    .orderBy(desc(importBatches.createdAt))
    .limit(Math.min(Math.max(filters.limit ?? 30, 1), 100));
  const visible = found.filter((batch) => canImportStream(access.role, batch.stream));
  const people = await getPeople(visible.map((batch) => batch.createdBy).filter((id): id is string => Boolean(id)));
  const out: ImportBatchDTO[] = [];
  for (const batch of visible) out.push(await toBatchDTO(db, batch, people));
  return out;
}

/** One line per stream for the import center cards: rows in Pulse and the last saved import. */
export async function listImportStreams(ctx: DomainContext): Promise<ImportStreamSummaryDTO[]> {
  const counts = await countStreamRows(ctx);
  const last = await rows<{ stream: string; id: string; at: Date; n: number }>(
    db,
    sql`SELECT DISTINCT ON (stream) stream, id, committed_at AS at, (create_count + update_count)::int AS n
          FROM pulse.import_batches WHERE org_id = ${ctx.orgId} AND status = 'committed' ORDER BY stream, committed_at DESC`,
  );
  const byStream = new Map(last.map((row) => [row.stream, row]));
  return counts.map((count) => {
    const row = byStream.get(count.stream);
    return { stream: count.stream, rows: count.rows, lastImportAt: row ? iso(row.at) : null, lastImportRows: row?.n ?? null, lastBatchId: row?.id ?? null };
  });
}

export async function listImportPresets(ctx: DomainContext, stream: string): Promise<ImportPresetDTO[]> {
  await accessFor(ctx, stream);
  const found = await db.select().from(importPresets).where(and(eq(importPresets.orgId, ctx.orgId), eq(importPresets.stream, stream))).orderBy(sql`${importPresets.lastUsedAt} DESC NULLS LAST`);
  return found.map((row) => presetDTO(row));
}

/** Saves a column mapping under a name. The same name saves over the old one. */
export async function saveImportPreset(ctx: DomainContext, input: { stream: string; name: string; headers: readonly string[]; mapping: readonly (string | null)[]; options?: Partial<ImportOptions> }): Promise<ImportPresetDTO[]> {
  await accessFor(ctx, input.stream);
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the saved mapping a name.', { name: 'Give the saved mapping a name.' });
  await inTx((tx) => upsertPreset(tx, ctx, input.stream as StreamId, name.slice(0, 80), input.headers, input.mapping, { ...DEFAULT_IMPORT_OPTIONS, ...(input.options ?? {}) }));
  return listImportPresets(ctx, input.stream);
}

export async function renameImportPreset(ctx: DomainContext, presetId: string, name: string): Promise<void> {
  const clean = cleanText(name);
  if (!clean) throw invalid('Give the saved mapping a name.', { name: 'Give the saved mapping a name.' });
  await inTx(async (tx) => {
    const [row] = isUuid(presetId) ? await tx.select().from(importPresets).where(and(eq(importPresets.orgId, ctx.orgId), eq(importPresets.id, presetId))) : [];
    if (!row) throw notFound('That saved mapping');
    await accessFor(ctx, row.stream);
    await tx.update(importPresets).set({ name: clean.slice(0, 80), updatedAt: new Date() }).where(eq(importPresets.id, row.id));
  });
}

export async function deleteImportPreset(ctx: DomainContext, presetId: string): Promise<void> {
  const [row] = isUuid(presetId) ? await db.select().from(importPresets).where(and(eq(importPresets.orgId, ctx.orgId), eq(importPresets.id, presetId))) : [];
  if (!row) throw notFound('That saved mapping');
  await accessFor(ctx, row.stream);
  await db.delete(importPresets).where(eq(importPresets.id, row.id));
}
