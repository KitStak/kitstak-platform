'use server';
import { z } from 'zod';
import { closePeriod, deleteStandard, deleteTarget, reopenPeriod, saveStandard, saveTarget } from '@/server/domain';
import { runAction } from './_action';
import { isoDate, pace, standardBasis, targetMetric, targetScope, text, uuid, version } from './schemas';

const standardSchema = z
  .object({
    id: uuid.nullable().optional(),
    jobTypeId: uuid.nullable().optional(),
    vasServiceId: uuid.nullable().optional(),
    clientId: uuid.nullable().optional(),
    laborClassId: uuid.nullable().optional(),
    unitsPerLaborHour: pace,
    effectiveFrom: isoDate,
    basis: standardBasis.optional(),
    note: text(500).nullable().optional(),
    version,
  })
  .refine((data) => Boolean(data.jobTypeId) !== Boolean(data.vasServiceId), { message: 'Pick a job type or a service.', path: ['jobTypeId'] });
export type SaveStandardActionInput = z.input<typeof standardSchema>;
/** Adds or edits a target pace row. */
export async function saveStandardAction(input: SaveStandardActionInput) {
  return runAction(standardSchema, input, (data, ctx) => saveStandard(ctx, data));
}

const idSchema = z.object({ id: uuid });
export async function deleteStandardAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteStandard(ctx, data.id));
}

const targetSchema = z.object({
  scope: targetScope,
  scopeId: uuid.nullable().optional(),
  metric: targetMetric,
  periodMonth: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Pick a month.').nullable().optional(),
  value: z.union([z.string(), z.number()]).transform((value) => String(value).trim()).refine((value) => /^-?\d{1,12}(\.\d{1,4})?$/.test(value), 'Type a number.'),
});
export type SaveTargetActionInput = z.input<typeof targetSchema>;
/** Sets a goal (one per scope, measure and month). */
export async function saveTargetAction(input: SaveTargetActionInput) {
  return runAction(targetSchema, input, (data, ctx) => saveTarget(ctx, data));
}
export async function deleteTargetAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteTarget(ctx, data.id));
}

const monthSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Pick a month.') });
/** Closes a month: snapshot, then lock. */
export async function closePeriodAction(input: z.input<typeof monthSchema>) {
  return runAction(monthSchema, input, (data, ctx) => closePeriod(ctx, data.month));
}

const reopenSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Pick a month.'), reason: z.string().trim().min(1, 'Say why the month is being reopened.').max(500) });
/** Reopens a closed month. Owner only, with a reason. */
export async function reopenPeriodAction(input: z.input<typeof reopenSchema>) {
  return runAction(reopenSchema, input, (data, ctx) => reopenPeriod(ctx, data.month, data.reason));
}
