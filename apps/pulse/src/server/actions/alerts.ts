'use server';
import { z } from 'zod';
import { archiveNotifications, createAlertRule, deleteAlertRule, evaluateAlerts, markNotificationsRead, updateAlert, updateAlertRule } from '@/server/domain';
import { runAction } from './_action';
import { alertKind, alertSeverity, isoDate, name, pulseRole, uuid } from './schemas';

const ruleFields = {
  name: name(200),
  kind: alertKind,
  threshold: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => /^-?\d{1,12}(\.\d{1,4})?$/.test(value), 'Type a number.')
    .nullable()
    .optional(),
  scope: z.object({ clientId: uuid.nullable().optional(), jobTypeId: uuid.nullable().optional(), siteId: uuid.nullable().optional() }).optional(),
  severity: alertSeverity.optional(),
  notifyRoles: z.array(pulseRole).max(6).optional(),
  notifyUserIds: z.array(uuid).max(50).optional(),
  enabled: z.boolean().optional(),
};
const createRuleSchema = z.object(ruleFields);
export type CreateAlertRuleActionInput = z.input<typeof createRuleSchema>;
export async function createAlertRuleAction(input: CreateAlertRuleActionInput) {
  return runAction(createRuleSchema, input, (data, ctx) => createAlertRule(ctx, data));
}

const updateRuleSchema = z.object({ ruleId: uuid, patch: z.object(ruleFields).partial() });
export async function updateAlertRuleAction(input: z.input<typeof updateRuleSchema>) {
  return runAction(updateRuleSchema, input, (data, ctx) => updateAlertRule(ctx, data.ruleId, data.patch));
}

const ruleIdSchema = z.object({ ruleId: uuid });
export async function deleteAlertRuleAction(input: z.input<typeof ruleIdSchema>) {
  return runAction(ruleIdSchema, input, (data, ctx) => deleteAlertRule(ctx, data.ruleId));
}

const changeSchema = z.object({
  alertId: uuid,
  change: z.discriminatedUnion('action', [
    z.object({ action: z.literal('snooze'), until: isoDate }),
    z.object({ action: z.literal('unsnooze') }),
    z.object({ action: z.literal('dismiss') }),
    z.object({ action: z.literal('resolve') }),
    z.object({ action: z.literal('reopen') }),
    z.object({ action: z.literal('assign'), userId: uuid.nullable() }),
    z.object({ action: z.literal('link_task'), pmTaskId: uuid.nullable() }),
  ]),
});
export type UpdateAlertActionInput = z.input<typeof changeSchema>;
/** Snooze, assign, dismiss, resolve or reopen one alert. */
export async function updateAlertAction(input: UpdateAlertActionInput) {
  return runAction(changeSchema, input, (data, ctx) => updateAlert(ctx, data.alertId, data.change));
}

const emptySchema = z.object({}).optional();
/** "Check now": runs every enabled rule against the current numbers. */
export async function evaluateAlertsAction() {
  return runAction(emptySchema, {}, (_data, ctx) => evaluateAlerts(ctx));
}

const readSchema = z.object({ ids: z.array(uuid).max(500).optional() });
/** Marks notifications read: the given ids, or all when `ids` is left out. */
export async function markNotificationsReadAction(input: z.input<typeof readSchema> = {}) {
  return runAction(readSchema, input, (data, ctx) => markNotificationsRead(ctx, data.ids), { revalidate: false, read: true });
}

const archiveSchema = z.object({ ids: z.array(uuid).min(1).max(500) });
export async function archiveNotificationsAction(input: z.input<typeof archiveSchema>) {
  return runAction(archiveSchema, input, (data, ctx) => archiveNotifications(ctx, data.ids), { revalidate: false });
}
