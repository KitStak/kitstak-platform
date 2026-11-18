/**
 * Entry work for the materials, costs and money in ledgers on top of `entries.ts`: adding many
 * rows at once, and pulling the parts a warehouse work order really used into material usage.
 *
 * Bulk adds are all or nothing from the person's point of view: rows are saved one by one through
 * the normal save (so every check, stamp and activity line is the same as a single add), and if
 * one row fails the rows saved before it in the same call are taken back out.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { DomainError, invalid, isDomainError } from '@/server/errors';
import { wmsSchemaFor, wmsTableExists } from '@/server/integrations';
import type { CostEntryDTO, MaterialUsageDTO, RevenueEntryDTO, VasEntryDTO } from '@/lib/types';
import { rows, todayInZone, type DomainContext } from './_shared';
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
import { loadSettings } from './settings';

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

export const saveCostsBulk = (ctx: DomainContext, inputs: readonly CostInput[]): Promise<CostEntryDTO[]> => bulk(ctx, inputs.map((input) => ({ ...input, id: null })), saveCost, deleteCost);
export const saveMaterialUsageBulk = (ctx: DomainContext, inputs: readonly MaterialUsageInput[]): Promise<MaterialUsageDTO[]> => bulk(ctx, inputs.map((input) => ({ ...input, id: null })), saveMaterialUsage, deleteMaterialUsage);
export const saveRevenueBulk = (ctx: DomainContext, inputs: readonly RevenueInput[]): Promise<RevenueEntryDTO[]> => bulk(ctx, inputs.map((input) => ({ ...input, id: null })), saveRevenue, deleteRevenue);
export const saveVasEntriesBulk = (ctx: DomainContext, inputs: readonly VasEntryInput[]): Promise<VasEntryDTO[]> => bulk(ctx, inputs.map((input) => ({ ...input, id: null })), saveVasEntry, deleteVasEntry);

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
}

async function wmsLines(ctx: DomainContext, jobId: string): Promise<{ reason: WmsUsagePreviewDTO['reason']; lines: WmsLine[]; code: string | null }> {
  try {
    const schema = await wmsSchemaFor(ctx);
    if (!schema || !(await wmsTableExists(schema, 'work_order_components')) || !(await wmsTableExists(schema, 'products'))) return { reason: 'no_wms', lines: [], code: null };
    const links = await rows<{ target_id: string }>(db, sql`SELECT target_id FROM pulse.job_links WHERE org_id = ${ctx.orgId} AND job_id = ${jobId} AND target_type = 'wms_work_order'`);
    const ids = links.map((link) => link.target_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (ids.length === 0) return { reason: 'no_work_order', lines: [], code: null };
    const table = (name: string) => sql.raw(`"${schema}"."${name}"`);
    const found = await rows<WmsLine>(
      db,
      sql`SELECT wc.id::text AS id, p.sku, p.name, COALESCE(wc.consumed_qty, 0)::text AS consumed, p.purchase_price::text AS unit_cost, w.code
            FROM ${table('work_order_components')} wc
            JOIN ${table('products')} p ON p.id = wc.component_product_id
            JOIN ${table('work_orders')} w ON w.id = wc.work_order_id
           WHERE wc.work_order_id::text = ANY(${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::text[]`})
           ORDER BY p.sku`,
    );
    return { reason: 'ok', lines: found, code: found[0]?.code ?? null };
  } catch {
    // The warehouse is read fail soft: any problem reads as "not there".
    return { reason: 'no_wms', lines: [], code: null };
  }
}

async function plan(ctx: DomainContext, jobRef: string): Promise<{ jobId: string; siteTimezone: string; preview: WmsUsagePreviewDTO }> {
  const access = await requirePulse(ctx, 'pulse:read');
  const job = await getJob(ctx, jobRef);
  const settings = await loadSettings(ctx.orgId);
  const { reason, lines, code } = await wmsLines(ctx, job.id);
  if (reason !== 'ok') return { jobId: job.id, siteTimezone: settings.timezone, preview: { available: false, reason, workOrderCode: null, lines: [], rowsToAdd: 0, addCents: null, moneyHidden: !access.seesMoney } };
  const have = await rows<{ sku: string; used: string }>(db, sql`SELECT lower(item_sku) AS sku, sum(quantity_used)::text AS used FROM pulse.material_usage WHERE org_id = ${ctx.orgId} AND job_id = ${job.id} AND deleted_at IS NULL AND source = 'wms' AND item_sku IS NOT NULL GROUP BY lower(item_sku)`);
  const haveBySku = new Map(have.map((row) => [row.sku, Number(row.used)]));
  let total = 0;
  const out: WmsUsageLineDTO[] = lines.map((line) => {
    const consumed = Number(line.consumed);
    const inPulse = haveBySku.get(line.sku.toLowerCase()) ?? 0;
    const toAdd = Math.max(0, Math.round((consumed - inPulse) * 1000) / 1000);
    const cost = line.unit_cost !== null && Number(line.unit_cost) > 0 ? Number(line.unit_cost) : null;
    const addCents = cost === null ? null : Math.round(toAdd * cost * 100);
    total += addCents ?? 0;
    return { componentId: line.id, sku: line.sku, name: line.name, consumed: String(consumed), inPulse: String(inPulse), toAdd: String(toAdd), unitCost: access.seesMoney && cost !== null ? cost.toFixed(4) : null, addCents: access.seesMoney ? addCents : null };
  });
  return {
    jobId: job.id,
    siteTimezone: settings.timezone,
    preview: { available: true, reason: 'ok', workOrderCode: code, lines: out, rowsToAdd: out.filter((line) => Number(line.toAdd) > 0).length, addCents: access.seesMoney ? total : null, moneyHidden: !access.seesMoney },
  };
}

/** What a pull from the warehouse would add to a job's material usage right now. Reads only. */
export async function previewWmsUsage(ctx: DomainContext, jobRef: string): Promise<WmsUsagePreviewDTO> {
  return (await plan(ctx, jobRef)).preview;
}

/**
 * Adds the parts the linked work order used since the last pull as material usage rows dated
 * today (source "wms"), with the warehouse's cost for one part kept on the row. Safe to run
 * again: it only ever adds the difference, so nothing is counted twice.
 */
export async function pullWmsUsage(ctx: DomainContext, jobRef: string): Promise<{ added: MaterialUsageDTO[]; preview: WmsUsagePreviewDTO }> {
  const access = await requirePulse(ctx, 'material:log');
  const { jobId, siteTimezone, preview } = await plan(ctx, jobRef);
  if (!preview.available) throw invalid(preview.reason === 'no_work_order' ? 'This job is not linked to a warehouse work order.' : 'The warehouse app is not connected for this workspace.');
  const today = todayInZone(siteTimezone);
  const wanted = preview.lines.filter((line) => Number(line.toAdd) > 0);
  if (wanted.length === 0) return { added: [], preview };
  const { lines: raw } = await wmsLines(ctx, jobId);
  const costById = new Map(raw.map((line) => [line.id, line.unit_cost !== null && Number(line.unit_cost) > 0 ? Number(line.unit_cost).toFixed(4) : null]));
  // The rows are stamped with the warehouse cost even when the person pulling may not see money:
  // the save runs with system eyes (same person on the audit line) and money is taken off the answer below.
  const saved = await saveMaterialUsageBulk(
    { ...ctx, actorKind: 'system' },
    wanted.map((line) => ({
      jobId,
      usageDate: today,
      itemSku: line.sku,
      itemName: line.name,
      quantityUsed: line.toAdd,
      unitCost: costById.get(line.componentId) ?? null,
      suppliedBy: null,
      note: `Pulled from work order ${preview.workOrderCode ?? ''}`.trim(),
      source: 'wms' as const,
      sourceRef: `woc:${line.componentId}:${today}`,
    })),
  );
  const added = access.seesMoney ? saved : saved.map((row) => ({ ...row, unitCost: null, costCents: null, scrapCents: null, moneyHidden: true }));
  return { added, preview: (await plan(ctx, jobRef)).preview };
}
