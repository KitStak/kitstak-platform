'use server';
import { z } from 'zod';
import type { AutomationAction, AutomationCondition, AutomationTrigger } from '@/lib/automation-types';
import { createAutomation, deleteAutomation, describeAutomationRule, restoreAutomation, sweepAutomations, updateAutomation } from '@/server/domain';
import { runAction } from './_action';
import { name, uuid } from './schemas';

// Rule shapes are checked structurally here and semantically by the engine; types are the contract.
const trigger = z.object({ type: z.string().min(1) }).passthrough();
const condition = z.object({ field: z.string().min(1), op: z.string().min(1), value: z.union([z.string(), z.boolean(), z.null()]).optional() });
const action = z.object({ type: z.string().min(1) }).passthrough();

const ruleFields = {
  name: name(120),
  description: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  trigger,
  conditions: z.array(condition).max(10).optional(),
  actions: z.array(action).min(1, 'Add at least one thing for the automation to do.').max(10),
};

const createSchema = z.object({ projectId: uuid.nullable(), ...ruleFields });
export async function createAutomationAction(input: z.input<typeof createSchema>) {
  return runAction(createSchema, input, (data, ctx) =>
    createAutomation(ctx, {
      ...data,
      trigger: data.trigger as unknown as AutomationTrigger,
      conditions: data.conditions as AutomationCondition[] | undefined,
      actions: data.actions as unknown as AutomationAction[],
    }),
  );
}

const updateSchema = z.object({
  automationId: uuid,
  patch: z.object({ ...ruleFields, name: name(120).optional(), trigger: trigger.optional(), actions: ruleFields.actions.optional() }),
});
export async function updateAutomationAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) =>
    updateAutomation(ctx, data.automationId, {
      ...data.patch,
      trigger: data.patch.trigger as unknown as AutomationTrigger | undefined,
      conditions: data.patch.conditions as AutomationCondition[] | undefined,
      actions: data.patch.actions as unknown as AutomationAction[] | undefined,
    }),
  );
}

const idSchema = z.object({ automationId: uuid });
export async function deleteAutomationAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteAutomation(ctx, data.automationId));
}
export async function restoreAutomationAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => restoreAutomation(ctx, data.automationId));
}

const describeSchema = z.object({ trigger, conditions: z.array(condition).max(10), actions: z.array(action).max(10) });
/** Live sentence preview for the builder ("When a task is marked done, notify the project owner."). */
export async function describeAutomationAction(input: z.input<typeof describeSchema>) {
  return runAction(
    describeSchema,
    input,
    (data, ctx) =>
      describeAutomationRule(ctx, {
        trigger: data.trigger as unknown as AutomationTrigger,
        conditions: data.conditions as AutomationCondition[],
        actions: data.actions as unknown as AutomationAction[],
      }),
    { revalidate: false, read: true },
  );
}

/** "Check now" on the Automations page: runs due-date and CRM/WMS triggers right away. */
export async function runScheduledAutomationsAction() {
  return runAction(z.object({}), {}, async (_data, ctx) => ({ checked: await sweepAutomations(ctx, { force: true }) }));
}
