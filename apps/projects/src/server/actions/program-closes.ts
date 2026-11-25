'use server';
import { z } from 'zod';
import { closeMonth, reopenMonth } from '@/server/domain/programs';
import { runAction } from './_action';
import { isoMonth, programKey } from './program-schemas';

const closeSchema = z.object({ key: programKey, month: isoMonth, adjustmentsReviewed: z.boolean().optional() });
export async function closeMonthAction(input: z.input<typeof closeSchema>) {
  return runAction(closeSchema, input, (data, ctx) => closeMonth(ctx, data.key, data.month, { adjustmentsReviewed: data.adjustmentsReviewed }), { revalidate: false });
}

const reopenSchema = z.object({ key: programKey, month: isoMonth, reason: z.string().trim().min(1, 'Say why the month is reopened.').max(1000) });
export async function reopenMonthAction(input: z.input<typeof reopenSchema>) {
  return runAction(reopenSchema, input, (data, ctx) => reopenMonth(ctx, data.key, data.month, data.reason), { revalidate: false });
}
