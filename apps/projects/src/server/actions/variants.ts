'use server';
import { z } from 'zod';
import { createVariants, deleteVariant, linkVariantKit, reorderVariants, restoreVariant, retireVariant, saveAttributes, setVariantRate, updateVariant } from '@/server/domain/programs';
import { runAction } from './_action';
import { axes, isoDate, price, programKey, qty, uuid, version } from './program-schemas';

const row = z.object({
  name: z.string().trim().min(1).max(80),
  key: z.string().trim().min(1).max(16),
  sku: z.string().trim().max(64).nullable().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  defaultQty: qty.nullable().optional(),
  packQty: qty.nullable().optional(),
  stdMinutesPerUnit: z.string().regex(/^\d{1,6}(\.\d{1,3})?$/).nullable().optional(),
  materialCostPerUnit: price.nullable().optional(),
  color: z.string().max(24).nullable().optional(),
  coreItemId: uuid.nullable().optional(),
  unitPrice: price.nullable().optional(),
});
const createSchema = z.object({ key: programKey, rows: z.array(row).min(1).max(200) });
export async function createVariantsAction(input: z.input<typeof createSchema>) {
  return runAction(createSchema, input, (data, ctx) => createVariants(ctx, data.key, data.rows.map((r) => ({ ...r, unitPrice: r.unitPrice ? r.unitPrice.replace('$', '') : null }))), { revalidate: false });
}

const updateSchema = z.object({ id: uuid, expectedVersion: version, patch: row.omit({ coreItemId: true, unitPrice: true }).partial() });
export async function updateVariantAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => updateVariant(ctx, data.id, data.patch, data.expectedVersion), { revalidate: false });
}

const reorderSchema = z.object({ key: programKey, ids: z.array(uuid).max(500) });
export async function reorderVariantsAction(input: z.input<typeof reorderSchema>) {
  return runAction(reorderSchema, input, async (data, ctx) => {
    await reorderVariants(ctx, data.key, data.ids);
    return {};
  }, { revalidate: false });
}

const idOnly = z.object({ id: uuid });
export async function retireVariantAction(input: z.input<typeof idOnly>) {
  return runAction(idOnly, input, async (data, ctx) => {
    await retireVariant(ctx, data.id);
    return {};
  }, { revalidate: false });
}
export async function restoreVariantAction(input: z.input<typeof idOnly>) {
  return runAction(idOnly, input, async (data, ctx) => {
    await restoreVariant(ctx, data.id);
    return {};
  }, { revalidate: false });
}
export async function deleteVariantAction(input: z.input<typeof idOnly>) {
  return runAction(idOnly, input, async (data, ctx) => {
    await deleteVariant(ctx, data.id);
    return {};
  }, { revalidate: false });
}

const kitSchema = z.object({ id: uuid, coreItemId: uuid.nullable().optional(), wmsProductId: z.string().max(64).nullable().optional(), title: z.string().max(200).optional(), sku: z.string().max(64).nullable().optional() });
export async function linkVariantKitAction(input: z.input<typeof kitSchema>) {
  return runAction(kitSchema, input, (data, ctx) => linkVariantKit(ctx, data.id, data), { revalidate: false });
}

const attributesSchema = z.object({ key: programKey, axes, valuesForExisting: z.record(z.string(), z.string()).optional() });
export async function saveAttributesAction(input: z.input<typeof attributesSchema>) {
  return runAction(attributesSchema, input, (data, ctx) => saveAttributes(ctx, data.key, data.axes, { valuesForExisting: data.valuesForExisting }), { revalidate: false });
}

const rateSchema = z.object({ variantId: uuid, unitPrice: price.nullable(), startsOn: isoDate.nullable().optional() });
export async function setVariantRateAction(input: z.input<typeof rateSchema>) {
  return runAction(rateSchema, input, (data, ctx) => setVariantRate(ctx, data.variantId, { unitPrice: data.unitPrice ? data.unitPrice.replace('$', '') : null, startsOn: data.startsOn }), { revalidate: false });
}
