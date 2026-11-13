'use server';
import { z } from 'zod';
import {
  createRecordTrigger,
  deleteRecordTrigger,
  runRecordTriggers,
  updateRecordTrigger,
} from '@/server/integrations/record-triggers';
import { runAction } from './_action';
import { name, uuid } from './schemas';

const kind = z.enum(['crm_deal_won', 'wms_receipt_discrepancy', 'wms_count_variance']);
const config = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

const createSchema = z.object({
  kind,
  name: name(120),
  config,
  lookbackDays: z.number().int().min(0).max(30).optional(),
});
/** Adds a cross-app recipe (CRM deal won, WMS receipt discrepancy, cycle count variance). */
export async function createRecordTriggerAction(input: z.input<typeof createSchema>) {
  return runAction(createSchema, input, (data, ctx) => createRecordTrigger(ctx, data));
}

const updateSchema = z.object({
  triggerId: uuid,
  patch: z.object({ enabled: z.boolean().optional(), name: name(120).optional(), config: config.optional() }),
});
export async function updateRecordTriggerAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => updateRecordTrigger(ctx, data.triggerId, data.patch));
}

const idSchema = z.object({ triggerId: uuid });
export async function deleteRecordTriggerAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteRecordTrigger(ctx, data.triggerId));
}

/** "Check now": looks at CRM and WMS for new matches right away (all recipes, or one). */
export async function runRecordTriggersAction(input: { readonly triggerId?: string } = {}) {
  return runAction(z.object({ triggerId: uuid.optional() }), input, async (data, ctx) => ({
    started: await runRecordTriggers(ctx, { force: true, triggerId: data.triggerId }),
  }));
}
