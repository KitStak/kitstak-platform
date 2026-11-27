/**
 * Entry work for the materials, costs and money in ledgers on top of `entries.ts`: adding many
 * rows at once, and pulling the parts a warehouse work order really used into material usage,
 * dated the day the warehouse used them.
 *
 * Bulk adds are all or nothing from the person's point of view: rows are saved one by one through
 * the normal save (so every check, stamp and activity line is the same as a single add), and if
 * one row fails the rows saved before it in the same call are taken back out.
 */
import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { DomainError, invalid, isDomainError } from '@/server/errors';
import { siblingDb, wmsSchemaFor, wmsTableExists } from '@/server/integrations';
import { logSoftFail } from '@/server/integrations/log';
import { fromScaled, mulQuantityPrice, PRICE_SCALE, priceToScaled, QUANTITY_SCALE, quantityToScaled } from '@/lib/money';
import type { CostEntryDTO, MaterialUsageDTO, RevenueEntryDTO, VasEntryDTO } from '@/lib/types';
import { centsOut, monthStart, rows, todayInZone, type DomainContext } from './_shared';
import { requirePulse } from './access';
import {
  deleteCost,
  deleteMaterialUsage,
  deleteRevenue,
  deleteVasEntry,
  saveCost,
  saveMaterialUsage,
  saveRevenue,
  saveVasEntry,
  type CostInput,
  type MaterialUsageInput,
  type RevenueInput,
  type VasEntryInput,
} from './entries';
import { getJob } from './jobs';
import { closedMonths } from './recalc';
import { loadSettings } from './settings';
import { planUsage, refDate, usageDays, wmsUsageRef } from './wms-usage';

const MAX_BULK = 200;

async function bulk<I, T extends { id: string }>(ctx: DomainContext, inputs: readonly I[], save: (ctx: DomainContext, input: I) => Promise<T>, undo: (ctx: DomainContext, id: string) => Promise<unknown>): Promise<T[]> {
  if (inputs.length === 0) throw invalid('Add at least one row.');
  if (inputs.length > MAX_BULK) throw invalid(`Add ${MAX_BULK} rows or fewer at a time. For more, use Import.`);
  const saved: T[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    try {
      saved.push(await save(ctx, inputs[index]!));
    } catch (error) {
      for (const row of saved.reverse()) {
        try {
          await undo(ctx, row.id);
        } catch {
          // The row stays; the message below tells the person which rows to look at.
        }
      }
      const message = isDomainError(error) ? error.message : 'Something went wrong on our side.';
      const fields: Record<string, string> = { [`rows.${index}`]: message };
      if (isDomainError(error) && error.fields) for (const [key, value] of Object.entries(error.fields)) fields[`rows.${index}.${key}`] = value;
      throw new DomainError(isDomainError(error) ? error.code : 'INTERNAL', `Row ${index + 1}: ${message} Nothing was added.`, fields);
    }
  }
  return saved;
}

export const saveCostsBulk = scoped((ctx: DomainContext, inputs: readonly CostInput[]): Promise<CostEntryDTO[]> => bulk(ctx, inputs.map((input) => ({ ...input, id: null })), saveCost, deleteCost));
export const saveMaterialUsageBulk = scoped((ctx: DomainContext, inputs: readonly MaterialUsageInput[]): Promise<MaterialUsageDTO[]> => bulk(ctx, inputs.map((input) => ({ ...input, id: null })), saveMaterialUsage, deleteMaterialUsage));
export const saveRevenueBulk = scoped((ctx: DomainContext, inputs: readonly RevenueInput[]): Promise<RevenueEntryDTO[]> => bulk(ctx, inputs.map((input) => ({ ...input, id: null })), saveRevenue, deleteRevenue));
export const saveVasEntriesBulk = scoped((ctx: DomainContext, inputs: readonly VasEntryInput[]): Promise<VasEntryDTO[]> => bulk(ctx, inputs.map((input) => ({ ...input, id: null })), saveVasEntry, deleteVasEntry));

/* ---------------------------------------------------------------- parts used, from the warehouse */

export interface WmsUsageLineDTO {
  readonly componentId: string;
  readonly sku: string;
  readonly name: string;
  /** Parts the work order has used so far, by the warehouse count. */
  readonly consumed: string;
  /** Parts already in Pulse for this job and part, from the warehouse. */
  readonly inPulse: string;
  /** What a pull would add now. 0 when Pulse is up to date. */
  readonly toAdd: string;
  /** Cost of one part, in currency units, from the warehouse product. Null when hidden or unknown. */
  readonly unitCost: string | null;
  readonly addCents: number | null;
}

export interface WmsUsagePreviewDTO {
  /** False when the warehouse app is not there or this job has no work order. The UI hides the button. */
  readonly available: boolean;
  readonly reason: 'ok' | 'no_wms' | 'no_work_order';
  readonly workOrderCode: string | null;
  readonly lines: readonly WmsUsageLineDTO[];
  readonly rowsToAdd: number;
  readonly addCents: number | null;
  readonly moneyHidden: boolean;
}

interface WmsLine {
  id: string;
  sku: string;
  name: string;
  consumed: string;
  unit_cost: string | null;
  code: string | null;
  /** The day the work order's kits were last built, else when it finished or started, in the site time zone. */
  build_date: string | null;
}

interface WmsLedgerDay {
  component_id: string;
  work_date: string;
  qty: string;
}

const WMS_ID = /^[0-9a-f-]{36}$/i;
const ZERO_QTY = BigInt(0);

/** A positive warehouse cost for one part as exact text with four places, else null. */
function partCost(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const scaled = priceToScaled(raw);
    return scaled > ZERO_QTY ? fromScaled(scaled, PRICE_SCALE) : null;
  } catch {
    return null;
  }
}

/** Exact quantity text without trailing zeros, for the preview ("12", "2.5"). */
const qtyText = (scaled: bigint): string => fromScaled(scaled, QUANTITY_SCALE).replace(/\.?0+$/, '') || '0';

const safeQty = (raw: string | null | undefined): bigint => {
  try {
    return raw ? quantityToScaled(raw) : ZERO_QTY;
  } catch {
    return ZERO_QTY;
  }
};

async function wmsLines(ctx: DomainContext, jobId: string, timezone: string): Promise<{ reason: WmsUsagePreviewDTO['reason']; lines: WmsLine[]; ledger: WmsLedgerDay[]; code: string | null }> {
  try {
    const schema = await wmsSchemaFor(ctx);
    if (!schema || !(await wmsTableExists(schema, 'work_order_components')) || !(await wmsTableExists(schema, 'products'))) return { reason: 'no_wms', lines: [], ledger: [], code: null };
    const links = await rows<{ target_id: string }>(db, sql`SELECT target_id FROM pulse.job_links WHERE org_id = ${ctx.orgId} AND job_id = ${jobId} AND target_type = 'wms_work_order'`);
    const ids = links.map((link) => link.target_id).filter((id) => WMS_ID.test(id));
    if (ids.length === 0) return { reason: 'no_work_order', lines: [], ledger: [], code: null };
    const table = (name: string) => sql.raw(`"${schema}"."${name}"`);
    const idArray = sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::text[]`;
    const hasLedger = await wmsTableExists(schema, 'inventory_transactions');
    const localDay = (column: SQL) => sql`CASE WHEN ${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN ((${column})::timestamptz AT TIME ZONE ${timezone})::date::text END`;
    const lastBuild = hasLedger
      ? sql`(SELECT max(${localDay(sql`it.at`)}) FROM ${table('inventory_transactions')} it WHERE it.work_order_id = w.id AND it.type = 'Kitting' AND it.product_id = w.kit_product_id)`
      : sql`NULL::text`;
    const found = await rows<WmsLine>(
      siblingDb,
      sql`SELECT wc.id::text AS id, p.sku, p.name, COALESCE(wc.consumed_qty, 0)::text AS consumed, p.purchase_price::text AS unit_cost, w.code,
                 COALESCE(${lastBuild}, ${localDay(sql`w.actual_finish_at`)}, ${localDay(sql`w.actual_start_at`)}) AS build_date
            FROM ${table('work_order_components')} wc
            JOIN ${table('products')} p ON p.id = wc.component_product_id
            JOIN ${table('work_orders')} w ON w.id = wc.work_order_id
           WHERE wc.work_order_id::text = ANY(${idArray})
           ORDER BY p.sku`,
    );
    // The day each part was really used: the warehouse ledger's Kitting rows for that part on that
    // work order. A part leaving a location was used; a part coming back (taking a kit apart) was not.
    const ledger = hasLedger
      ? await rows<WmsLedgerDay>(
          siblingDb,
          sql`SELECT wc.id::text AS component_id, ${localDay(sql`it.at`)} AS work_date,
                     sum(CASE WHEN it.from_location_id IS NOT NULL THEN it.uom_qty ELSE -it.uom_qty END)::text AS qty
                FROM ${table('work_order_components')} wc
                JOIN ${table('inventory_transactions')} it ON it.work_order_id = wc.work_order_id AND it.product_id = wc.component_product_id AND it.type = 'Kitting'
               WHERE wc.work_order_id::text = ANY(${idArray}) AND it.at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
               GROUP BY 1, 2`,
        )
      : [];
    return { reason: 'ok', lines: found, ledger, code: found[0]?.code ?? null };
  } catch (error) {
    // The warehouse is read fail soft: any problem reads as "not there", with one line in the log.
    logSoftFail(ctx.orgId, 'ledger.wmsLines', error);
    return { reason: 'no_wms', lines: [], ledger: [], code: null };
  }
}

/** The time zone of the job's site, else the workspace's. */
async function siteTimezone(ctx: DomainContext, jobId: string): Promise<string> {
  const [site] = await rows<{ timezone: string | null }>(db, sql`SELECT s.timezone FROM pulse.jobs j JOIN pulse.sites s ON s.id = j.site_id WHERE j.org_id = ${ctx.orgId} AND j.id = ${jobId}`);
  return site?.timezone || (await loadSettings(ctx.orgId)).timezone;
}

interface Plan {
  jobId: string;
  timezone: string;
  lines: WmsLine[];
  ledger: WmsLedgerDay[];
  preview: WmsUsagePreviewDTO;
}

async function plan(ctx: DomainContext, jobRef: string): Promise<Plan> {
  const access = await requirePulse(ctx, 'pulse:read');
  const job = await getJob(ctx, jobRef);
  const timezone = await siteTimezone(ctx, job.id);
  const { reason, lines, ledger, code } = await wmsLines(ctx, job.id, timezone);
  if (reason !== 'ok') return { jobId: job.id, timezone, lines: [], ledger: [], preview: { available: false, reason, workOrderCode: null, lines: [], rowsToAdd: 0, addCents: null, moneyHidden: !access.seesMoney } };
  const have = await rows<{ sku: string; used: string }>(db, sql`SELECT lower(item_sku) AS sku, sum(quantity_used)::text AS used FROM pulse.material_usage WHERE org_id = ${ctx.orgId} AND job_id = ${job.id} AND deleted_at IS NULL AND source = 'wms' AND item_sku IS NOT NULL GROUP BY lower(item_sku)`);
  const haveBySku = new Map(have.map((row) => [row.sku, safeQty(row.used)]));
  let total = ZERO_QTY;
  const out: WmsUsageLineDTO[] = lines.map((line) => {
    const consumed = safeQty(line.consumed);
    const inPulse = haveBySku.get(line.sku.toLowerCase()) ?? ZERO_QTY;
    const toAdd = consumed > inPulse ? consumed - inPulse : ZERO_QTY;
    const cost = partCost(line.unit_cost);
    const addCents = cost === null ? null : mulQuantityPrice(fromScaled(toAdd, QUANTITY_SCALE), cost);
    total += addCents ?? ZERO_QTY;
    return { componentId: line.id, sku: line.sku, name: line.name, consumed: qtyText(consumed), inPulse: qtyText(inPulse), toAdd: qtyText(toAdd), unitCost: access.seesMoney ? cost : null, addCents: access.seesMoney && addCents !== null ? centsOut(addCents) : null };
  });
  return {
    jobId: job.id,
    timezone,
    lines,
    ledger,
    preview: { available: true, reason: 'ok', workOrderCode: code, lines: out, rowsToAdd: out.filter((line) => line.toAdd !== '0').length, addCents: access.seesMoney ? centsOut(total) : null, moneyHidden: !access.seesMoney },
  };
}

/** What a pull from the warehouse would add to a job's material usage right now. Reads only. */
export const previewWmsUsage = scoped(async function previewWmsUsage(ctx: DomainContext, jobRef: string): Promise<WmsUsagePreviewDTO> {
  return (await plan(ctx, jobRef)).preview;
});

export interface WmsPullResult {
  readonly added: MaterialUsageDTO[];
  /** Rows whose count changed or that were moved to the day the parts were really used. */
  readonly updated: number;
  /** Rows taken out because the warehouse no longer counts those parts. */
  readonly removed: number;
  /** Days left alone because their month is closed. */
  readonly skippedClosed: number;
  readonly preview: WmsUsagePreviewDTO;
}

interface OwnUsageRow {
  id: string;
  usage_date: string;
  quantity_used: string;
  source_ref: string | null;
  item_sku: string | null;
}

const isClosedError = (error: unknown): boolean => isDomainError(error) && /closed/i.test(error.message);

/**
 * Makes the job's material usage match the parts the linked work order used, one row per part
 * and day (source "wms", ref `woc:<componentId>:<date>`), dated the day the warehouse used them
 * in the site's time zone. Safe to run again: a second run changes nothing. Rows an older pull
 * dated on the sync day are moved to the right day. Parts that came in another way (an import)
 * are counted and never added twice. Closed months are left alone.
 */
export const pullWmsUsage = scoped(async function pullWmsUsage(ctx: DomainContext, jobRef: string): Promise<WmsPullResult> {
  const access = await requirePulse(ctx, 'material:log');
  const { jobId, timezone, lines, ledger, preview } = await plan(ctx, jobRef);
  if (!preview.available) throw invalid(preview.reason === 'no_work_order' ? 'This job is not linked to a warehouse work order.' : 'The warehouse app is not connected for this workspace.');
  const today = todayInZone(timezone);
  const closed = await closedMonths(db, ctx.orgId);
  const isClosed = (date: string): boolean => closed.has(monthStart(date));
  const existing = await rows<OwnUsageRow>(
    db,
    sql`SELECT id, usage_date::text AS usage_date, quantity_used::text AS quantity_used, source_ref, lower(item_sku) AS item_sku
          FROM pulse.material_usage WHERE org_id = ${ctx.orgId} AND job_id = ${jobId} AND deleted_at IS NULL AND source = 'wms'`,
  );
  // The rows are stamped with the warehouse cost even when the person pulling may not see money:
  // the save runs with system eyes (same person on the audit line) and money is taken off the answer below.
  const system: DomainContext = { ...ctx, actorKind: 'system' };
  const note = `Pulled from work order ${preview.workOrderCode ?? ''}`.trim();
  const saved: MaterialUsageDTO[] = [];
  let updated = 0;
  let removed = 0;
  let skippedClosed = 0;
  for (const line of lines) {
    const mine = existing.filter((row) => refDate(row.source_ref, line.id) !== null);
    const other = existing.filter((row) => refDate(row.source_ref, line.id) === null && row.source_ref?.startsWith(`woc:`) !== true && row.item_sku === line.sku.toLowerCase());
    const days = usageDays(
      ledger.filter((day) => day.component_id === line.id && day.work_date).map((day) => ({ date: day.work_date, qty: safeQty(day.qty) })),
      safeQty(line.consumed),
      line.build_date ?? today,
    );
    const steps = planUsage(
      line.id,
      days,
      mine.map((row) => ({ id: row.id, date: row.usage_date, qty: safeQty(row.quantity_used), ref: row.source_ref })),
      other.map((row) => ({ date: row.usage_date, qty: safeQty(row.quantity_used) })),
      isClosed,
    );
    skippedClosed += steps.skippedClosed;
    const base = { jobId, itemSku: line.sku, itemName: line.name, unitCost: partCost(line.unit_cost), suppliedBy: null, note, source: 'wms' as const };
    try {
      for (const id of steps.remove) {
        await deleteMaterialUsage(system, id);
        removed += 1;
      }
      for (const step of steps.update) {
        await saveMaterialUsage(system, { ...base, id: step.id, usageDate: step.date, quantityUsed: fromScaled(step.qty, QUANTITY_SCALE) });
        // The normal save keeps a row's ref; a moved row takes the ref of its new day.
        await db.execute(sql`UPDATE pulse.material_usage SET source_ref = ${step.ref} WHERE org_id = ${ctx.orgId} AND id = ${step.id} AND source = 'wms' AND source_ref IS DISTINCT FROM ${step.ref}`);
        updated += 1;
      }
      for (const step of steps.create) saved.push(await saveMaterialUsage(system, { ...base, id: null, usageDate: step.date, quantityUsed: fromScaled(step.qty, QUANTITY_SCALE), sourceRef: wmsUsageRef(line.id, step.date) }));
    } catch (error) {
      if (!isClosedError(error)) throw error;
      skippedClosed += 1;
    }
  }
  const added = access.seesMoney ? saved : saved.map((row) => ({ ...row, unitCost: null, costCents: null, scrapCents: null, moneyHidden: true }));
  return { added, updated, removed, skippedClosed, preview: (await plan(ctx, jobRef)).preview };
});
