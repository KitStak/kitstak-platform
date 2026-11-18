'use server';
import { z } from 'zod';
import { createLaborClass, createLaborRate, deleteLaborClass, deleteLaborRate, previewLaborRate, updateLaborClass, updateLaborRate } from '@/server/domain';
import { runAction } from './_action';
import { code, color, isoDate, laborClassKind, multiplier, name, positiveBp, rateCents, text, uuid, version } from './schemas';

const classFields = { code: code.nullable().optional(), name: name(120), kind: laborClassKind.optional(), isDefault: z.boolean().optional(), color: color.optional() };
const createClassSchema = z.object(classFields);
export async function createLaborClassAction(input: z.input<typeof createClassSchema>) {
  return runAction(createClassSchema, input, (data, ctx) => createLaborClass(ctx, data));
}

const updateClassSchema = z.object({ laborClassId: uuid, patch: z.object({ ...classFields, archived: z.boolean() }).partial() });
export async function updateLaborClassAction(input: z.input<typeof updateClassSchema>) {
  return runAction(updateClassSchema, input, (data, ctx) => updateLaborClass(ctx, data.laborClassId, data.patch));
}

const classIdSchema = z.object({ laborClassId: uuid });
export async function deleteLaborClassAction(input: z.input<typeof classIdSchema>) {
  return runAction(classIdSchema, input, (data, ctx) => deleteLaborClass(ctx, data.laborClassId));
}

const rateFields = {
  laborClassId: uuid,
  siteId: uuid.nullable().optional(),
  effectiveFrom: isoDate,
  wageCents: rateCents,
  payrollTaxBp: positiveBp.optional(),
  benefitsBp: positiveBp.optional(),
  otherBurdenBp: positiveBp.optional(),
  overheadPerHourCents: rateCents.optional(),
  overtimeMultiplier: multiplier.optional(),
  billRateCents: rateCents.nullable().optional(),
  note: text(500).nullable().optional(),
};
const createRateSchema = z.object(rateFields);
export type CreateLaborRateActionInput = z.input<typeof createRateSchema>;
/** Adds a dated rate row and restamps the entries it now applies to (open months only). */
export async function createLaborRateAction(input: CreateLaborRateActionInput) {
  return runAction(createRateSchema, input, (data, ctx) => createLaborRate(ctx, data));
}

const { laborClassId: _classId, ...rateEditable } = rateFields;
void _classId;
const updateRateSchema = z.object({ rateId: uuid, patch: z.object(rateEditable).partial(), version });
export async function updateLaborRateAction(input: z.input<typeof updateRateSchema>) {
  return runAction(updateRateSchema, input, (data, ctx) => updateLaborRate(ctx, data.rateId, data.patch, data.version));
}

const rateIdSchema = z.object({ rateId: uuid });
export async function deleteLaborRateAction(input: z.input<typeof rateIdSchema>) {
  return runAction(rateIdSchema, input, (data, ctx) => deleteLaborRate(ctx, data.rateId));
}

const previewSchema = z.object({ ...rateFields, rateId: uuid.nullable().optional() });
/** "This changes 212 entries and lowers profit by $1,430 across 9 jobs." Saves nothing. */
export async function previewLaborRateAction(input: z.input<typeof previewSchema>) {
  return runAction(previewSchema, input, (data, ctx) => previewLaborRate(ctx, data), { revalidate: false });
}
