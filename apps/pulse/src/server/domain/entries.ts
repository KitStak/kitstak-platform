/**
 * The other dated streams of a job or a client (SPEC 5.3): material usage, other costs
 * (job, client or company level), revenue entries (invoices are a billed memo, never profit)
 * and extra service entries. Each write is stamped, logged and rolled up in one transaction;
 * deletes are soft and can be restored.
 */
import 'server-only';
import { and, asc, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { costEntries, items, materialUsage, revenueEntries, vasEntries } from '@/server/db/schema';
import { appUrls } from '@/server/env';
import { orgModuleFlags } from '@/server/entitlements';
import { conflict, invalid, notFound } from '@/server/errors';
import type { CostCategory, CostScope, PartsOwnerValue, RevenueKind, StoredRevenueKind, StreamSource } from '@/lib/constants';
import { mulQuantityPrice } from '@/lib/money';
import type { CostEntryDTO, MaterialUsageDTO, RevenueEntryDTO, VasEntryDTO } from '@/lib/types';
import { assertVersion, cleanText, diff, hideUnless, inTx, iso, isoRequired, isUuid, moneyOut, monthStart, type DomainContext } from './_shared';
import { requirePulse, type PulseAccess } from './access';
import { logActivity } from './activity';
import { getClientRow, getSiteRow, getVasServiceRow, insertItem, resolveSite } from './catalog';
import { getJobRow } from './jobs';
import { assertOpen, closedMonths, finishWrite, newTouched, restampUsage, restampVas, touchDay, touchJob } from './recalc';
import { defaultSiteId } from './settings';

type Access = Pick<PulseAccess, 'seesMoney'>;
type UsageRow = typeof materialUsage.$inferSelect;
type CostRow = typeof costEntries.$inferSelect;
type RevenueRow = typeof revenueEntries.$inferSelect;
type VasRow = typeof vasEntries.$inferSelect;

interface StreamCols {
  id: string;
  siteId: string | null;
  source: string;
  sourceRef: string | null;
  isSample: boolean;
  version: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const base = (row: StreamCols, access: Access, closed: ReadonlySet<string>, date: string) => ({
  id: row.id,
  siteId: row.siteId,
  source: row.source as StreamSource,
  sourceRef: row.sourceRef,
  isSample: row.isSample,
  version: row.version,
  createdBy: row.createdBy,
  createdAt: isoRequired(row.createdAt),
  updatedAt: isoRequired(row.updatedAt),
  deletedAt: iso(row.deletedAt),
  locked: closed.has(monthStart(date)),
  moneyHidden: !access.seesMoney,
});

export interface EntryFilters {
  readonly jobId?: string | null;
  readonly clientId?: string | null;
  readonly siteId?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly includeDeleted?: boolean;
  readonly limit?: number;
}

const cap = (limit: number | undefined): number => Math.min(limit ?? 2000, 10_000);

/* ---------------------------------------------------------------- material usage */

function toUsageDTO(row: UsageRow, access: Access, closed: ReadonlySet<string>): MaterialUsageDTO {
  const money = access.seesMoney;
  return {
    ...base(row, access, closed, row.usageDate),
    siteId: row.siteId,
    note: row.note,
    jobId: row.jobId,
    usageDate: row.usageDate,
    itemId: row.itemId,
    itemSku: row.itemSku,
    itemName: row.itemName,
    quantityUsed: row.quantityUsed,
    quantityScrapped: row.quantityScrapped,
    quantityPlanned: row.quantityPlanned,
    unitCost: hideUnless(money, row.unitCost),
    uom: row.uom,
    lot: row.lot,
    suppliedBy: row.suppliedBy as PartsOwnerValue | null,
    resolvedSuppliedBy: row.resolvedSuppliedBy as PartsOwnerValue,
    costCents: moneyOut(money, row.costCents),
    scrapCents: moneyOut(money, row.scrapCents),
  };
}

export async function listMaterialUsage(ctx: DomainContext, filters: EntryFilters = {}): Promise<MaterialUsageDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const closed = await closedMonths(db, ctx.orgId);
  const found = await db
    .select()
    .from(materialUsage)
    .where(
      and(
        eq(materialUsage.orgId, ctx.orgId),
        filters.includeDeleted ? undefined : isNull(materialUsage.deletedAt),
        filters.jobId ? eq(materialUsage.jobId, filters.jobId) : undefined,
        filters.siteId ? eq(materialUsage.siteId, filters.siteId) : undefined,
        filters.from ? gte(materialUsage.usageDate, filters.from) : undefined,
        filters.to ? lte(materialUsage.usageDate, filters.to) : undefined,
      ),
    )
    .orderBy(desc(materialUsage.usageDate), asc(materialUsage.createdAt))
    .limit(cap(filters.limit));
  return found.map((row) => toUsageDTO(row, access, closed));
}

export interface MaterialUsageInput {
  id?: string | null;
  jobId: string;
  usageDate: string;
  itemId?: string | null;
  /** Used when `itemId` is not given: finds the item by SKU or makes it. */
  itemSku?: string | null;
  itemName?: string | null;
  quantityUsed: string;
  quantityScrapped?: string;
  quantityPlanned?: string | null;
  /** Left out means the item's cost. Only people who see money may set it. */
  unitCost?: string | null;
  uom?: string | null;
  lot?: string | null;
  suppliedBy?: PartsOwnerValue | null;
  note?: string | null;
  version?: number | null;
  source?: StreamSource;
  sourceRef?: string | null;
  isSample?: boolean;
}

export async function saveMaterialUsage(ctx: DomainContext, input: MaterialUsageInput): Promise<MaterialUsageDTO> {
  const access = await requirePulse(ctx, 'material:log');
  return inTx(async (tx) => {
    let existing: UsageRow | undefined;
    if (input.id) {
      [existing] = isUuid(input.id) ? await tx.select().from(materialUsage).where(and(eq(materialUsage.orgId, ctx.orgId), eq(materialUsage.id, input.id), isNull(materialUsage.deletedAt))) : [];
      if (!existing) throw notFound('That material row');
      assertVersion(existing.version, input.version);
    }
    const job = await getJobRow(ctx, input.jobId, tx);
    await assertOpen(tx, ctx.orgId, [input.usageDate, existing?.usageDate]);
    let item: typeof items.$inferSelect | undefined;
    if (input.itemId) [item] = await tx.select().from(items).where(and(eq(items.orgId, ctx.orgId), eq(items.id, input.itemId), isNull(items.deletedAt)));
    else if (cleanText(input.itemSku)) {
      const sku = cleanText(input.itemSku)!;
      [item] = await tx.select().from(items).where(and(eq(items.orgId, ctx.orgId), sql`lower(${items.sku}) = ${sku.toLowerCase()}`, isNull(items.deletedAt)));
      if (!item) item = await insertItem(tx, ctx, { sku, name: cleanText(input.itemName) ?? sku, uom: input.uom ?? undefined, unitCost: access.seesMoney ? (input.unitCost ?? '0') : '0' });
    }
    if (input.itemId && !item) throw invalid('That item does not exist in this workspace.', { itemId: 'Pick an item from the list.' });
    const typedCost = access.seesMoney ? input.unitCost : undefined;
    const values = {
      siteId: job.siteId,
      jobId: job.id,
      usageDate: input.usageDate,
      itemId: item?.id ?? existing?.itemId ?? null,
      itemSku: item?.sku ?? cleanText(input.itemSku) ?? existing?.itemSku ?? null,
      itemName: cleanText(input.itemName) ?? item?.name ?? existing?.itemName ?? null,
      quantityUsed: input.quantityUsed,
      quantityScrapped: input.quantityScrapped ?? existing?.quantityScrapped ?? '0',
      quantityPlanned: input.quantityPlanned === undefined ? (existing?.quantityPlanned ?? null) : input.quantityPlanned,
      unitCost: typedCost ?? existing?.unitCost ?? item?.unitCost ?? '0',
      uom: cleanText(input.uom) ?? item?.uom ?? existing?.uom ?? null,
      lot: input.lot === undefined ? (existing?.lot ?? null) : cleanText(input.lot),
      suppliedBy: input.suppliedBy === undefined ? (existing?.suppliedBy ?? null) : input.suppliedBy,
      note: input.note === undefined ? (existing?.note ?? null) : cleanText(input.note),
    };
    let row: UsageRow;
    if (existing) {
      const change = diff(existing as unknown as Record<string, unknown>, values as Record<string, unknown>);
      if (!change) return toUsageDTO(existing, access, await closedMonths(tx, ctx.orgId));
      [row] = (await tx.update(materialUsage).set({ ...values, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(materialUsage.id, existing.id)).returning()) as [UsageRow];
      await logActivity(tx, ctx, { verb: 'material.edited', entityType: 'material', entityId: row.id, jobId: job.id, clientId: job.clientId, ...change });
    } else {
      [row] = (await tx
        .insert(materialUsage)
        .values({ orgId: ctx.orgId, ...values, source: input.source ?? 'manual', sourceRef: input.sourceRef ?? null, isSample: Boolean(input.isSample), createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning()) as [UsageRow];
      await logActivity(tx, ctx, { verb: 'material.logged', entityType: 'material', entityId: row.id, jobId: job.id, clientId: job.clientId, after: { usageDate: row.usageDate, itemSku: row.itemSku, quantityUsed: row.quantityUsed, quantityScrapped: row.quantityScrapped } });
    }
    await restampUsage(tx, ctx.orgId, sql`src.id = ${row.id}`);
    const touched = newTouched();
    touched.jobIds.add(job.id);
    if (existing && existing.jobId !== job.id) touched.jobIds.add(existing.jobId);
    await finishWrite(tx, ctx, touched);
    const [fresh] = await tx.select().from(materialUsage).where(eq(materialUsage.id, row.id));
    return toUsageDTO(fresh!, access, await closedMonths(tx, ctx.orgId));
  });
}

async function toggleUsage(ctx: DomainContext, id: string, restore: boolean): Promise<MaterialUsageDTO> {
  const access = await requirePulse(ctx, 'material:log');
  return inTx(async (tx) => {
    const [row] = isUuid(id) ? await tx.select().from(materialUsage).where(and(eq(materialUsage.orgId, ctx.orgId), eq(materialUsage.id, id))) : [];
    if (!row || (row.deletedAt !== null) !== restore) throw notFound('That material row');
    await assertOpen(tx, ctx.orgId, [row.usageDate]);
    const [after] = await tx.update(materialUsage).set({ deletedAt: restore ? null : new Date(), version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(materialUsage.id, row.id)).returning();
    await logActivity(tx, ctx, { verb: restore ? 'material.restored' : 'material.deleted', entityType: 'material', entityId: row.id, jobId: row.jobId, before: restore ? undefined : { usageDate: row.usageDate, itemSku: row.itemSku, quantityUsed: row.quantityUsed } });
    if (restore) await restampUsage(tx, ctx.orgId, sql`src.id = ${row.id}`);
    const touched = newTouched();
    touched.jobIds.add(row.jobId);
    await finishWrite(tx, ctx, touched);
    return toUsageDTO(after!, access, await closedMonths(tx, ctx.orgId));
  });
}

export const deleteMaterialUsage = (ctx: DomainContext, id: string): Promise<MaterialUsageDTO> => toggleUsage(ctx, id, false);
export const restoreMaterialUsage = (ctx: DomainContext, id: string): Promise<MaterialUsageDTO> => toggleUsage(ctx, id, true);

/* ---------------------------------------------------------------- other costs */

function toCostDTO(row: CostRow, access: Access, closed: ReadonlySet<string>): CostEntryDTO {
  return {
    ...base(row, access, closed, row.costDate),
    note: row.note,
    scope: row.scope as CostScope,
    jobId: row.jobId,
    clientId: row.clientId,
    costDate: row.costDate,
    category: row.category as CostCategory,
    amountCents: moneyOut(access.seesMoney, row.amountCents),
    vendor: row.vendor,
    reference: row.reference,
  };
}

export async function listCosts(ctx: DomainContext, filters: EntryFilters & { scope?: CostScope | null } = {}): Promise<CostEntryDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const closed = await closedMonths(db, ctx.orgId);
  const found = await db
    .select()
    .from(costEntries)
    .where(
      and(
        eq(costEntries.orgId, ctx.orgId),
        filters.includeDeleted ? undefined : isNull(costEntries.deletedAt),
        filters.scope ? eq(costEntries.scope, filters.scope) : undefined,
        filters.jobId ? eq(costEntries.jobId, filters.jobId) : undefined,
        filters.clientId ? eq(costEntries.clientId, filters.clientId) : undefined,
        filters.siteId ? eq(costEntries.siteId, filters.siteId) : undefined,
        filters.from ? gte(costEntries.costDate, filters.from) : undefined,
        filters.to ? lte(costEntries.costDate, filters.to) : undefined,
      ),
    )
    .orderBy(desc(costEntries.costDate), asc(costEntries.createdAt))
    .limit(cap(filters.limit));
  return found.map((row) => toCostDTO(row, access, closed));
}

export interface CostInput {
  id?: string | null;
  /** With a job the cost is a job cost; with only a client, a client cost; with neither, a company cost. */
  jobId?: string | null;
  clientId?: string | null;
  siteId?: string | null;
  costDate: string;
  category: CostCategory;
  /** May be negative (a vendor credit). */
  amountCents: number;
  vendor?: string | null;
  reference?: string | null;
  note?: string | null;
  version?: number | null;
  source?: StreamSource;
  sourceRef?: string | null;
  isSample?: boolean;
}

async function touchCost(tx: Executor, ctx: DomainContext, touched: ReturnType<typeof newTouched>, row: Pick<CostRow, 'scope' | 'jobId' | 'clientId' | 'siteId' | 'costDate'>): Promise<void> {
  if (row.scope === 'company') touchDay(touched, row.siteId ?? (await defaultSiteId(ctx.orgId, tx)), row.costDate);
  else touchJob(touched, row.jobId, row.clientId);
}

export async function saveCost(ctx: DomainContext, input: CostInput): Promise<CostEntryDTO> {
  const access = await requirePulse(ctx, 'cost:manage');
  return inTx(async (tx) => {
    let existing: CostRow | undefined;
    if (input.id) {
      [existing] = isUuid(input.id) ? await tx.select().from(costEntries).where(and(eq(costEntries.orgId, ctx.orgId), eq(costEntries.id, input.id), isNull(costEntries.deletedAt))) : [];
      if (!existing) throw notFound('That cost');
      assertVersion(existing.version, input.version);
    }
    await assertOpen(tx, ctx.orgId, [input.costDate, existing?.costDate]);
    const job = input.jobId ? await getJobRow(ctx, input.jobId, tx) : null;
    const client = job ? null : input.clientId ? await getClientRow(ctx, input.clientId, tx) : null;
    const scope: CostScope = job ? 'job' : client ? 'client' : 'company';
    const siteId = job ? job.siteId : input.siteId ? (await getSiteRow(ctx, input.siteId, tx)).id : scope === 'client' ? await defaultSiteId(ctx.orgId, tx) : null;
    const values = {
      scope,
      jobId: job?.id ?? null,
      clientId: job?.clientId ?? client?.id ?? null,
      siteId,
      costDate: input.costDate,
      category: input.category,
      amountCents: BigInt(input.amountCents),
      vendor: input.vendor === undefined ? (existing?.vendor ?? null) : cleanText(input.vendor),
      reference: input.reference === undefined ? (existing?.reference ?? null) : cleanText(input.reference),
      note: input.note === undefined ? (existing?.note ?? null) : cleanText(input.note),
    };
    const touched = newTouched();
    let row: CostRow;
    if (existing) {
      const change = diff(existing as unknown as Record<string, unknown>, values as Record<string, unknown>);
      if (!change) return toCostDTO(existing, access, await closedMonths(tx, ctx.orgId));
      [row] = (await tx.update(costEntries).set({ ...values, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(costEntries.id, existing.id)).returning()) as [CostRow];
      await logActivity(tx, ctx, { verb: 'cost.edited', entityType: 'cost', entityId: row.id, jobId: row.jobId, clientId: row.clientId, ...change });
      await touchCost(tx, ctx, touched, existing);
    } else {
      [row] = (await tx
        .insert(costEntries)
        .values({ orgId: ctx.orgId, ...values, source: input.source ?? 'manual', sourceRef: input.sourceRef ?? null, isSample: Boolean(input.isSample), createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning()) as [CostRow];
      await logActivity(tx, ctx, { verb: 'cost.logged', entityType: 'cost', entityId: row.id, jobId: row.jobId, clientId: row.clientId, after: { scope, costDate: row.costDate, category: row.category, amountCents: row.amountCents } });
    }
    await touchCost(tx, ctx, touched, row);
    await finishWrite(tx, ctx, touched);
    return toCostDTO(row, access, await closedMonths(tx, ctx.orgId));
  });
}

async function toggleCost(ctx: DomainContext, id: string, restore: boolean): Promise<CostEntryDTO> {
  const access = await requirePulse(ctx, 'cost:manage');
  return inTx(async (tx) => {
    const [row] = isUuid(id) ? await tx.select().from(costEntries).where(and(eq(costEntries.orgId, ctx.orgId), eq(costEntries.id, id))) : [];
    if (!row || (row.deletedAt !== null) !== restore) throw notFound('That cost');
    await assertOpen(tx, ctx.orgId, [row.costDate]);
    const [after] = await tx.update(costEntries).set({ deletedAt: restore ? null : new Date(), version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(costEntries.id, row.id)).returning();
    await logActivity(tx, ctx, { verb: restore ? 'cost.restored' : 'cost.deleted', entityType: 'cost', entityId: row.id, jobId: row.jobId, clientId: row.clientId, before: restore ? undefined : { costDate: row.costDate, category: row.category, amountCents: row.amountCents } });
    const touched = newTouched();
    await touchCost(tx, ctx, touched, row);
    await finishWrite(tx, ctx, touched);
    return toCostDTO(after!, access, await closedMonths(tx, ctx.orgId));
  });
}

export const deleteCost = (ctx: DomainContext, id: string): Promise<CostEntryDTO> => toggleCost(ctx, id, false);
export const restoreCost = (ctx: DomainContext, id: string): Promise<CostEntryDTO> => toggleCost(ctx, id, true);

/* ---------------------------------------------------------------- revenue entries */

function toRevenueDTO(row: RevenueRow, access: Access, closed: ReadonlySet<string>): RevenueEntryDTO {
  const money = access.seesMoney;
  return {
    ...base(row, access, closed, row.revenueDate),
    siteId: row.siteId,
    note: row.note,
    jobId: row.jobId,
    clientId: row.clientId,
    revenueDate: row.revenueDate,
    kind: row.kind as StoredRevenueKind,
    description: row.description,
    quantity: row.quantity,
    unitPrice: hideUnless(money, row.unitPrice),
    amountCents: moneyOut(money, row.amountCents),
    invoiceNumber: row.invoiceNumber,
    vasServiceId: row.vasServiceId,
    serviceLabel: row.serviceLabel,
    approved: row.approved,
  };
}

export async function listRevenue(ctx: DomainContext, filters: EntryFilters & { kind?: StoredRevenueKind | null } = {}): Promise<RevenueEntryDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const closed = await closedMonths(db, ctx.orgId);
  const found = await db
    .select()
    .from(revenueEntries)
    .where(
      and(
        eq(revenueEntries.orgId, ctx.orgId),
        filters.includeDeleted ? undefined : isNull(revenueEntries.deletedAt),
        filters.kind ? eq(revenueEntries.kind, filters.kind) : undefined,
        filters.jobId ? eq(revenueEntries.jobId, filters.jobId) : undefined,
        filters.clientId ? eq(revenueEntries.clientId, filters.clientId) : undefined,
        filters.from ? gte(revenueEntries.revenueDate, filters.from) : undefined,
        filters.to ? lte(revenueEntries.revenueDate, filters.to) : undefined,
      ),
    )
    .orderBy(desc(revenueEntries.revenueDate), asc(revenueEntries.createdAt))
    .limit(cap(filters.limit));
  return found.map((row) => toRevenueDTO(row, access, closed));
}

export interface RevenueInput {
  id?: string | null;
  /** A job, or a client with no job. One is needed. */
  jobId?: string | null;
  clientId?: string | null;
  revenueDate: string;
  kind: RevenueKind;
  description?: string | null;
  quantity?: string | null;
  unitPrice?: string | null;
  /** Left out means quantity times unit price. Credits are stored below zero. */
  amountCents?: number | null;
  invoiceNumber?: string | null;
  vasServiceId?: string | null;
  serviceLabel?: string | null;
  approved?: boolean;
  note?: string | null;
  version?: number | null;
  source?: StreamSource;
  sourceRef?: string | null;
  isSample?: boolean;
}

export async function saveRevenue(ctx: DomainContext, input: RevenueInput): Promise<RevenueEntryDTO> {
  const access = await requirePulse(ctx, 'revenue:manage');
  return inTx(async (tx) => {
    let existing: RevenueRow | undefined;
    if (input.id) {
      [existing] = isUuid(input.id) ? await tx.select().from(revenueEntries).where(and(eq(revenueEntries.orgId, ctx.orgId), eq(revenueEntries.id, input.id), isNull(revenueEntries.deletedAt))) : [];
      if (!existing) throw notFound('That revenue row');
      if (existing.kind === 'fixed_true_up') throw conflict('Pulse writes the fixed price true up by itself. Change the fixed price or the planned units instead.');
      assertVersion(existing.version, input.version);
    }
    await assertOpen(tx, ctx.orgId, [input.revenueDate, existing?.revenueDate]);
    const job = input.jobId ? await getJobRow(ctx, input.jobId, tx) : null;
    const client = job ? await getClientRow(ctx, job.clientId, tx, true) : input.clientId ? await getClientRow(ctx, input.clientId, tx) : null;
    if (!client) throw invalid('Pick a job or a client for this row.', { jobId: 'Pick a job or a client.' });
    if (input.vasServiceId) await getVasServiceRow(ctx, input.vasServiceId, tx);
    let amount: bigint;
    if (input.amountCents !== null && input.amountCents !== undefined) amount = BigInt(input.amountCents);
    else if (input.quantity && input.unitPrice) amount = mulQuantityPrice(input.quantity, input.unitPrice);
    else throw invalid('Type an amount, or a quantity and a price.', { amountCents: 'Type an amount.' });
    if (input.kind === 'credit' && amount > BigInt(0)) amount = -amount;
    const values = {
      siteId: job?.siteId ?? existing?.siteId ?? (await defaultSiteId(ctx.orgId, tx)),
      jobId: job?.id ?? null,
      clientId: client.id,
      revenueDate: input.revenueDate,
      kind: input.kind,
      description: input.description === undefined ? (existing?.description ?? null) : cleanText(input.description),
      quantity: input.quantity === undefined ? (existing?.quantity ?? null) : input.quantity,
      unitPrice: input.unitPrice === undefined ? (existing?.unitPrice ?? null) : input.unitPrice,
      amountCents: amount,
      invoiceNumber: input.invoiceNumber === undefined ? (existing?.invoiceNumber ?? null) : cleanText(input.invoiceNumber),
      vasServiceId: input.vasServiceId === undefined ? (existing?.vasServiceId ?? null) : input.vasServiceId,
      serviceLabel: input.serviceLabel === undefined ? (existing?.serviceLabel ?? null) : cleanText(input.serviceLabel),
      approved: input.approved ?? existing?.approved ?? true,
      note: input.note === undefined ? (existing?.note ?? null) : cleanText(input.note),
    };
    const touched = newTouched();
    let row: RevenueRow;
    if (existing) {
      const change = diff(existing as unknown as Record<string, unknown>, values as Record<string, unknown>);
      if (!change) return toRevenueDTO(existing, access, await closedMonths(tx, ctx.orgId));
      [row] = (await tx.update(revenueEntries).set({ ...values, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(revenueEntries.id, existing.id)).returning()) as [RevenueRow];
      await logActivity(tx, ctx, { verb: 'revenue.edited', entityType: 'revenue', entityId: row.id, jobId: row.jobId, clientId: row.clientId, ...change });
      touchJob(touched, existing.jobId, existing.clientId);
    } else {
      [row] = (await tx
        .insert(revenueEntries)
        .values({ orgId: ctx.orgId, ...values, source: input.source ?? 'manual', sourceRef: input.sourceRef ?? null, isSample: Boolean(input.isSample), createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning()) as [RevenueRow];
      await logActivity(tx, ctx, { verb: 'revenue.logged', entityType: 'revenue', entityId: row.id, jobId: row.jobId, clientId: row.clientId, after: { revenueDate: row.revenueDate, kind: row.kind, amountCents: row.amountCents, invoiceNumber: row.invoiceNumber } });
    }
    touchJob(touched, row.jobId, row.clientId);
    await finishWrite(tx, ctx, touched);
    return toRevenueDTO(row, access, await closedMonths(tx, ctx.orgId));
  });
}

async function toggleRevenue(ctx: DomainContext, id: string, restore: boolean): Promise<RevenueEntryDTO> {
  const access = await requirePulse(ctx, 'revenue:manage');
  return inTx(async (tx) => {
    const [row] = isUuid(id) ? await tx.select().from(revenueEntries).where(and(eq(revenueEntries.orgId, ctx.orgId), eq(revenueEntries.id, id))) : [];
    if (!row || (row.deletedAt !== null) !== restore) throw notFound('That revenue row');
    if (row.kind === 'fixed_true_up') throw conflict('Pulse writes the fixed price true up by itself. Reopen the job to remove it.');
    await assertOpen(tx, ctx.orgId, [row.revenueDate]);
    const [after] = await tx.update(revenueEntries).set({ deletedAt: restore ? null : new Date(), version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(revenueEntries.id, row.id)).returning();
    await logActivity(tx, ctx, { verb: restore ? 'revenue.restored' : 'revenue.deleted', entityType: 'revenue', entityId: row.id, jobId: row.jobId, clientId: row.clientId, before: restore ? undefined : { revenueDate: row.revenueDate, kind: row.kind, amountCents: row.amountCents } });
    const touched = newTouched();
    touchJob(touched, row.jobId, row.clientId);
    await finishWrite(tx, ctx, touched);
    return toRevenueDTO(after!, access, await closedMonths(tx, ctx.orgId));
  });
}

export const deleteRevenue = (ctx: DomainContext, id: string): Promise<RevenueEntryDTO> => toggleRevenue(ctx, id, false);
export const restoreRevenue = (ctx: DomainContext, id: string): Promise<RevenueEntryDTO> => toggleRevenue(ctx, id, true);

/* ---------------------------------------------------------------- extra service entries */

/** The WMS app's address when the workspace still has the warehouse on its plan, else null (so a link is never dead). */
async function warehouseBase(ctx: DomainContext): Promise<string | null> {
  try {
    return (await orgModuleFlags(ctx.orgId)).wms ? appUrls().wms : null;
  } catch {
    return null;
  }
}

/** Link back to the warehouse record a pulled entry came from. Only a path is stored on the row. */
function warehouseUrl(row: VasRow, wmsBase: string | null): string | null {
  if (!wmsBase || row.source !== 'wms') return null;
  const path = (row.meta as { wms?: { path?: unknown } } | null)?.wms?.path;
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? `${wmsBase}${path}` : null;
}

/** Fields a person changed on an entry pulled from another app. The next sync leaves them alone. */
function lockedMeta(row: VasRow, changed: readonly string[]): Record<string, unknown> {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const prior = Array.isArray(meta.locked_fields) ? (meta.locked_fields as string[]) : [];
  return { ...meta, locked_fields: [...new Set([...prior, ...changed])] };
}

function toVasEntryDTO(row: VasRow, access: Access, closed: ReadonlySet<string>, wmsBase: string | null): VasEntryDTO {
  const money = access.seesMoney;
  return {
    ...base(row, access, closed, row.workDate),
    sourceUrl: warehouseUrl(row, wmsBase),
    siteId: row.siteId,
    note: row.note,
    vasServiceId: row.vasServiceId,
    clientId: row.clientId,
    jobId: row.jobId,
    workDate: row.workDate,
    quantity: row.quantity,
    unitPrice: hideUnless(money, row.unitPrice),
    amountCents: moneyOut(money, row.amountCents),
    noPrice: row.amountCents === null,
    laborClassId: row.laborClassId,
    headcount: row.headcount,
    hours: row.hours,
    overtimeHours: row.overtimeHours,
    materialCents: moneyOut(money, row.materialCents),
    laborCostCents: moneyOut(money, row.laborCostCents),
    sharedCents: moneyOut(money, row.sharedCents),
    needsRate: row.needsRate,
  };
}

export async function listVasEntries(ctx: DomainContext, filters: EntryFilters & { vasServiceId?: string | null; noPrice?: boolean } = {}): Promise<VasEntryDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const closed = await closedMonths(db, ctx.orgId);
  const where: (SQL | undefined)[] = [
    eq(vasEntries.orgId, ctx.orgId),
    filters.includeDeleted ? undefined : isNull(vasEntries.deletedAt),
    filters.vasServiceId ? eq(vasEntries.vasServiceId, filters.vasServiceId) : undefined,
    filters.jobId ? eq(vasEntries.jobId, filters.jobId) : undefined,
    filters.clientId ? eq(vasEntries.clientId, filters.clientId) : undefined,
    filters.siteId ? eq(vasEntries.siteId, filters.siteId) : undefined,
    filters.from ? gte(vasEntries.workDate, filters.from) : undefined,
    filters.to ? lte(vasEntries.workDate, filters.to) : undefined,
    filters.noPrice ? isNull(vasEntries.amountCents) : undefined,
  ];
  const found = await db.select().from(vasEntries).where(and(...where)).orderBy(desc(vasEntries.workDate), asc(vasEntries.createdAt)).limit(cap(filters.limit));
  const wmsBase = found.some((row) => row.source === 'wms') ? await warehouseBase(ctx) : null;
  return found.map((row) => toVasEntryDTO(row, access, closed, wmsBase));
}

export interface VasEntryInput {
  id?: string | null;
  vasServiceId: string;
  /** A job, or a client with no job. One is needed. */
  jobId?: string | null;
  clientId?: string | null;
  siteId?: string | null;
  workDate: string;
  quantity: string;
  /** Left out means the service's default price. */
  unitPrice?: string | null;
  /** A typed flat amount wins over quantity times price. */
  amountCents?: number | null;
  laborClassId?: string | null;
  headcount?: string | null;
  hours?: string;
  overtimeHours?: string;
  /** Left out means quantity times the service's default cost per unit. */
  materialCents?: number | null;
  note?: string | null;
  version?: number | null;
  source?: StreamSource;
  sourceRef?: string | null;
  isSample?: boolean;
  /** Extra facts kept on the row (a sync stores the path back to its record here). Merged over what is there. */
  meta?: Record<string, unknown>;
}

export async function saveVasEntry(ctx: DomainContext, input: VasEntryInput): Promise<VasEntryDTO> {
  const access = await requirePulse(ctx, 'vas:manage');
  const wmsBase = await warehouseBase(ctx);
  const hours = input.hours ?? '0';
  if (Number(input.overtimeHours ?? 0) > Number(hours)) throw invalid('Overtime hours cannot be more than the labor hours.', { overtimeHours: 'More than the labor hours.' });
  return inTx(async (tx) => {
    let existing: VasRow | undefined;
    if (input.id) {
      [existing] = isUuid(input.id) ? await tx.select().from(vasEntries).where(and(eq(vasEntries.orgId, ctx.orgId), eq(vasEntries.id, input.id), isNull(vasEntries.deletedAt))) : [];
      if (!existing) throw notFound('That service entry');
      assertVersion(existing.version, input.version);
    }
    await assertOpen(tx, ctx.orgId, [input.workDate, existing?.workDate]);
    const service = await getVasServiceRow(ctx, input.vasServiceId, tx);
    const job = input.jobId ? await getJobRow(ctx, input.jobId, tx) : null;
    const client = job ? await getClientRow(ctx, job.clientId, tx, true) : input.clientId ? await getClientRow(ctx, input.clientId, tx) : null;
    if (!client) throw invalid('Pick a job or a client for this service.', { jobId: 'Pick a job or a client.' });
    const site = job ? await getSiteRow(ctx, job.siteId, tx) : await resolveSite(ctx, input.siteId ?? existing?.siteId, tx);
    const unitPrice = input.unitPrice === undefined ? (existing?.unitPrice ?? service.defaultPrice) : input.unitPrice;
    let amount: bigint | null;
    if (input.amountCents !== null && input.amountCents !== undefined) amount = BigInt(input.amountCents);
    else if (unitPrice === null) amount = null;
    else if (service.billing === 'flat') amount = mulQuantityPrice('1', unitPrice);
    else amount = mulQuantityPrice(service.billing === 'per_hour' ? hours : input.quantity, unitPrice);
    const material = input.materialCents !== null && input.materialCents !== undefined ? BigInt(input.materialCents) : existing && input.materialCents === undefined && existing.quantity === input.quantity ? existing.materialCents : service.defaultCostPerUnit ? mulQuantityPrice(input.quantity, service.defaultCostPerUnit) : BigInt(0);
    const values = {
      siteId: site.id,
      vasServiceId: service.id,
      clientId: client.id,
      jobId: job?.id ?? null,
      workDate: input.workDate,
      quantity: input.quantity,
      unitPrice,
      amountCents: amount,
      laborClassId: input.laborClassId === undefined ? (existing?.laborClassId ?? service.defaultLaborClassId) : input.laborClassId,
      headcount: input.headcount === undefined ? (existing?.headcount ?? null) : input.headcount,
      hours,
      overtimeHours: input.overtimeHours ?? existing?.overtimeHours ?? '0',
      materialCents: material,
      note: input.note === undefined ? (existing?.note ?? null) : cleanText(input.note),
    };
    const touched = newTouched();
    let row: VasRow;
    if (existing) {
      const change = diff(existing as unknown as Record<string, unknown>, values as Record<string, unknown>);
      if (!change) return toVasEntryDTO(existing, access, await closedMonths(tx, ctx.orgId), wmsBase);
      // A person's change to a pulled entry is remembered, so the next sync does not undo it.
      const pulled = existing.source !== 'manual' && existing.source !== 'csv' && existing.source !== 'sample';
      const kept = pulled && ctx.actorKind !== 'integration' ? lockedMeta(existing, Object.keys(change.after)) : ((existing.meta ?? {}) as Record<string, unknown>);
      const meta = { ...kept, ...(input.meta ?? {}) };
      [row] = (await tx.update(vasEntries).set({ ...values, meta, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(vasEntries.id, existing.id)).returning()) as [VasRow];
      await logActivity(tx, ctx, { verb: 'service_entry.edited', entityType: 'service_entry', entityId: row.id, jobId: row.jobId, clientId: row.clientId, ...change });
      touchJob(touched, existing.jobId, existing.clientId);
      touchDay(touched, existing.siteId, existing.workDate);
    } else {
      [row] = (await tx
        .insert(vasEntries)
        .values({ orgId: ctx.orgId, ...values, source: input.source ?? 'manual', sourceRef: input.sourceRef ?? null, isSample: Boolean(input.isSample), meta: input.meta ?? {}, createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning()) as [VasRow];
      await logActivity(tx, ctx, { verb: 'service_entry.logged', entityType: 'service_entry', entityId: row.id, jobId: row.jobId, clientId: row.clientId, after: { vasServiceId: row.vasServiceId, workDate: row.workDate, quantity: row.quantity, hours: row.hours } });
    }
    await restampVas(tx, ctx.orgId, sql`src.id = ${row.id}`);
    touchJob(touched, row.jobId, row.clientId);
    touchDay(touched, row.siteId, row.workDate);
    await finishWrite(tx, ctx, touched);
    const [fresh] = await tx.select().from(vasEntries).where(eq(vasEntries.id, row.id));
    return toVasEntryDTO(fresh!, access, await closedMonths(tx, ctx.orgId), wmsBase);
  });
}

async function toggleVasEntry(ctx: DomainContext, id: string, restore: boolean): Promise<VasEntryDTO> {
  const access = await requirePulse(ctx, 'vas:manage');
  return inTx(async (tx) => {
    const [row] = isUuid(id) ? await tx.select().from(vasEntries).where(and(eq(vasEntries.orgId, ctx.orgId), eq(vasEntries.id, id))) : [];
    if (!row || (row.deletedAt !== null) !== restore) throw notFound('That service entry');
    await assertOpen(tx, ctx.orgId, [row.workDate]);
    const [after] = await tx.update(vasEntries).set({ deletedAt: restore ? null : new Date(), version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(vasEntries.id, row.id)).returning();
    await logActivity(tx, ctx, { verb: restore ? 'service_entry.restored' : 'service_entry.deleted', entityType: 'service_entry', entityId: row.id, jobId: row.jobId, clientId: row.clientId, before: restore ? undefined : { vasServiceId: row.vasServiceId, workDate: row.workDate, quantity: row.quantity } });
    if (restore) await restampVas(tx, ctx.orgId, sql`src.id = ${row.id}`);
    const touched = newTouched();
    touchJob(touched, row.jobId, row.clientId);
    touchDay(touched, row.siteId, row.workDate);
    await finishWrite(tx, ctx, touched);
    return toVasEntryDTO(after!, access, await closedMonths(tx, ctx.orgId), await warehouseBase(ctx));
  });
}

export const deleteVasEntry = (ctx: DomainContext, id: string): Promise<VasEntryDTO> => toggleVasEntry(ctx, id, false);
export const restoreVasEntry = (ctx: DomainContext, id: string): Promise<VasEntryDTO> => toggleVasEntry(ctx, id, true);
