'use server';
import { z } from 'zod';
import {
  deleteCost,
  deleteMaterialUsage,
  deleteRevenue,
  deleteVasEntry,
  restoreCost,
  restoreMaterialUsage,
  restoreRevenue,
  restoreVasEntry,
  saveCost,
  saveMaterialUsage,
  saveRevenue,
  saveVasEntry,
} from '@/server/domain';
import { runAction } from './_action';
import { cents, costCategory, headcount, hours, isoDate, partsOwner, positiveCents, quantity, revenueKind, text, unitPrice, uuid, version } from './schemas';

const idSchema = z.object({ id: uuid });
type IdInput = z.input<typeof idSchema>;

const usageSchema = z.object({
  id: uuid.nullable().optional(),
  jobId: uuid,
  usageDate: isoDate,
  itemId: uuid.nullable().optional(),
  itemSku: text(80).nullable().optional(),
  itemName: text(200).nullable().optional(),
  quantityUsed: quantity,
  quantityScrapped: quantity.optional(),
  quantityPlanned: quantity.nullable().optional(),
  unitCost: unitPrice.nullable().optional(),
  uom: text(20).nullable().optional(),
  lot: text(80).nullable().optional(),
  suppliedBy: partsOwner.nullable().optional(),
  note: text(1000).nullable().optional(),
  version,
});
export type SaveMaterialUsageActionInput = z.input<typeof usageSchema>;
export async function saveMaterialUsageAction(input: SaveMaterialUsageActionInput) {
  return runAction(usageSchema, input, (data, ctx) => saveMaterialUsage(ctx, data));
}
export async function deleteMaterialUsageAction(input: IdInput) {
  return runAction(idSchema, input, (data, ctx) => deleteMaterialUsage(ctx, data.id));
}
export async function restoreMaterialUsageAction(input: IdInput) {
  return runAction(idSchema, input, (data, ctx) => restoreMaterialUsage(ctx, data.id));
}

const costSchema = z.object({
  id: uuid.nullable().optional(),
  jobId: uuid.nullable().optional(),
  clientId: uuid.nullable().optional(),
  siteId: uuid.nullable().optional(),
  costDate: isoDate,
  category: costCategory,
  amountCents: cents,
  vendor: text(200).nullable().optional(),
  reference: text(120).nullable().optional(),
  note: text(1000).nullable().optional(),
  version,
});
export type SaveCostActionInput = z.input<typeof costSchema>;
/** A job cost, a client cost (no job) or a company cost (neither). */
export async function saveCostAction(input: SaveCostActionInput) {
  return runAction(costSchema, input, (data, ctx) => saveCost(ctx, data));
}
export async function deleteCostAction(input: IdInput) {
  return runAction(idSchema, input, (data, ctx) => deleteCost(ctx, data.id));
}
export async function restoreCostAction(input: IdInput) {
  return runAction(idSchema, input, (data, ctx) => restoreCost(ctx, data.id));
}

const revenueSchema = z
  .object({
    id: uuid.nullable().optional(),
    jobId: uuid.nullable().optional(),
    clientId: uuid.nullable().optional(),
    revenueDate: isoDate,
    kind: revenueKind,
    description: text(500).nullable().optional(),
    quantity: quantity.nullable().optional(),
    unitPrice: unitPrice.nullable().optional(),
    amountCents: cents.nullable().optional(),
    invoiceNumber: text(80).nullable().optional(),
    vasServiceId: uuid.nullable().optional(),
    serviceLabel: text(120).nullable().optional(),
    approved: z.boolean().optional(),
    note: text(1000).nullable().optional(),
    version,
  })
  .refine((data) => Boolean(data.jobId) || Boolean(data.clientId), { message: 'Pick a job or a client.', path: ['jobId'] });
export type SaveRevenueActionInput = z.input<typeof revenueSchema>;
/** An invoice (billed memo), a fee, an adjustment or a credit. */
export async function saveRevenueAction(input: SaveRevenueActionInput) {
  return runAction(revenueSchema, input, (data, ctx) => saveRevenue(ctx, data));
}
export async function deleteRevenueAction(input: IdInput) {
  return runAction(idSchema, input, (data, ctx) => deleteRevenue(ctx, data.id));
}
export async function restoreRevenueAction(input: IdInput) {
  return runAction(idSchema, input, (data, ctx) => restoreRevenue(ctx, data.id));
}

const vasSchema = z
  .object({
    id: uuid.nullable().optional(),
    vasServiceId: uuid,
    jobId: uuid.nullable().optional(),
    clientId: uuid.nullable().optional(),
    siteId: uuid.nullable().optional(),
    workDate: isoDate,
    quantity,
    unitPrice: unitPrice.nullable().optional(),
    amountCents: cents.nullable().optional(),
    laborClassId: uuid.nullable().optional(),
    headcount: headcount.nullable().optional(),
    hours: hours.optional(),
    overtimeHours: hours.optional(),
    materialCents: positiveCents.nullable().optional(),
    note: text(1000).nullable().optional(),
    version,
  })
  .refine((data) => Boolean(data.jobId) || Boolean(data.clientId), { message: 'Pick a job or a client.', path: ['jobId'] });
export type SaveVasEntryActionInput = z.input<typeof vasSchema>;
/** One extra service entry: quantity, price, and the labor it took. */
export async function saveVasEntryAction(input: SaveVasEntryActionInput) {
  return runAction(vasSchema, input, (data, ctx) => saveVasEntry(ctx, data));
}
export async function deleteVasEntryAction(input: IdInput) {
  return runAction(idSchema, input, (data, ctx) => deleteVasEntry(ctx, data.id));
}
export async function restoreVasEntryAction(input: IdInput) {
  return runAction(idSchema, input, (data, ctx) => restoreVasEntry(ctx, data.id));
}
