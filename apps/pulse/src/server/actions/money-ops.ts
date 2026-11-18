'use server';
/**
 * Actions of the money ops screens: calculator scenarios, alert rules with quiet hours, bulk
 * alert changes, bulk adds for the cost, material and money in ledgers, and the warehouse pull.
 */
import { z } from 'zod';
import {
  bulkUpdateAlerts,
  createJobFromScenario,
  deleteQuoteScenario,
  pullWmsUsage,
  restoreQuoteScenario,
  saveAlertRuleFull,
  saveCostsBulk,
  saveMaterialUsageBulk,
  saveQuoteScenario,
  saveRevenueBulk,
  saveVasEntriesBulk,
  setQuoteScenarioStatus,
} from '@/server/domain';
import { runAction } from './_action';
import { alertKind, alertSeverity, cents, costCategory, headcount, hours, isoDate, name, nullableDate, partsOwner, positiveCents, pulseRole, quantity, revenueKind, text, unitPrice, uuid } from './schemas';

/* ---------------------------------------------------------------- calculator */

const line = z.record(z.string(), z.unknown());
const calcInputs = z
  .object({
    clientId: z.string().nullable().optional(),
    jobTypeId: z.string().nullable().optional(),
    jobId: z.string().nullable().optional(),
    unitLabel: z.string().max(40).optional(),
    units: z.string().max(40).optional(),
    standardUph: z.string().max(40).optional(),
    crew: z.array(line).max(20).optional(),
    shiftHours: z.string().max(20).optional(),
    setupHours: z.string().max(20).optional(),
    partsOwner: z.string().max(10).optional(),
    materialPerUnit: z.string().max(40).optional(),
    services: z.array(line).max(30).optional(),
    otherCosts: z.array(line).max(30).optional(),
    sharedPct: z.string().max(20).optional(),
    targetMarginPct: z.string().max(20).optional(),
    pricePerUnit: z.string().max(40).optional(),
    startDate: z.string().nullable().optional(),
  })
  .passthrough();

const scenarioSchema = z.object({ id: uuid.nullable().optional(), name: name(120), inputs: calcInputs, status: z.enum(['draft', 'sent', 'won', 'lost']).optional() });
export type SaveQuoteScenarioActionInput = z.input<typeof scenarioSchema>;
/** Saves a calculator scenario. The answer is worked out again on the server. */
export async function saveQuoteScenarioAction(input: SaveQuoteScenarioActionInput) {
  return runAction(scenarioSchema, input, (data, ctx) => saveQuoteScenario(ctx, data));
}

const scenarioStatusSchema = z.object({ id: uuid, status: z.enum(['draft', 'sent', 'won', 'lost']) });
export async function setQuoteScenarioStatusAction(input: z.input<typeof scenarioStatusSchema>) {
  return runAction(scenarioStatusSchema, input, (data, ctx) => setQuoteScenarioStatus(ctx, data.id, data.status));
}

const idSchema = z.object({ id: uuid });
export async function deleteQuoteScenarioAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteQuoteScenario(ctx, data.id));
}
export async function restoreQuoteScenarioAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => restoreQuoteScenario(ctx, data.id));
}

const jobFromScenarioSchema = z.object({
  scenarioId: uuid,
  name: name(200),
  clientId: uuid.nullable().optional(),
  clientName: text(200).nullable().optional(),
  startDate: nullableDate.optional(),
  dueDate: nullableDate.optional(),
});
/** Makes a planned job from a scenario, with the scenario as its quote. */
export async function createJobFromScenarioAction(input: z.input<typeof jobFromScenarioSchema>) {
  return runAction(jobFromScenarioSchema, input, (data, ctx) => createJobFromScenario(ctx, data));
}

/* ---------------------------------------------------------------- alerts */

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a time.');
const ruleSchema = z.object({
  id: uuid.nullable().optional(),
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
  quiet: z.object({ from: clock, to: clock, weekends: z.boolean().optional() }).nullable().optional(),
});
export type SaveAlertRuleFullActionInput = z.input<typeof ruleSchema>;
/** Creates or changes an alert rule: what it watches, the line, who gets told and quiet hours. */
export async function saveAlertRuleFullAction(input: SaveAlertRuleFullActionInput) {
  return runAction(ruleSchema, input, (data, ctx) => saveAlertRuleFull(ctx, data));
}

const bulkAlertSchema = z.object({
  alertIds: z.array(uuid).min(1).max(500),
  change: z.discriminatedUnion('action', [
    z.object({ action: z.literal('snooze'), until: isoDate }),
    z.object({ action: z.literal('unsnooze') }),
    z.object({ action: z.literal('dismiss') }),
    z.object({ action: z.literal('resolve') }),
    z.object({ action: z.literal('reopen') }),
    z.object({ action: z.literal('assign'), userId: uuid.nullable() }),
  ]),
});
export type BulkUpdateAlertsActionInput = z.input<typeof bulkAlertSchema>;
/** The same change on many alerts at once. */
export async function bulkUpdateAlertsAction(input: BulkUpdateAlertsActionInput) {
  return runAction(bulkAlertSchema, input, (data, ctx) => bulkUpdateAlerts(ctx, data.alertIds, data.change));
}

/* ---------------------------------------------------------------- ledgers: many rows at once */

const costRow = z.object({
  jobId: uuid.nullable().optional(),
  clientId: uuid.nullable().optional(),
  siteId: uuid.nullable().optional(),
  costDate: isoDate,
  category: costCategory,
  amountCents: cents,
  vendor: text(200).nullable().optional(),
  reference: text(120).nullable().optional(),
  note: text(1000).nullable().optional(),
});
const costsSchema = z.object({ rows: z.array(costRow).min(1).max(200) });
export type SaveCostsBulkActionInput = z.input<typeof costsSchema>;
export async function saveCostsBulkAction(input: SaveCostsBulkActionInput) {
  return runAction(costsSchema, input, (data, ctx) => saveCostsBulk(ctx, data.rows));
}

const usageRow = z.object({
  jobId: uuid,
  usageDate: isoDate,
  itemId: uuid.nullable().optional(),
  itemSku: text(80).nullable().optional(),
  itemName: text(200).nullable().optional(),
  quantityUsed: quantity,
  quantityScrapped: quantity.optional(),
  unitCost: unitPrice.nullable().optional(),
  uom: text(20).nullable().optional(),
  lot: text(80).nullable().optional(),
  suppliedBy: partsOwner.nullable().optional(),
  note: text(1000).nullable().optional(),
});
const usageSchema = z.object({ rows: z.array(usageRow).min(1).max(200) });
export type SaveMaterialUsageBulkActionInput = z.input<typeof usageSchema>;
export async function saveMaterialUsageBulkAction(input: SaveMaterialUsageBulkActionInput) {
  return runAction(usageSchema, input, (data, ctx) => saveMaterialUsageBulk(ctx, data.rows));
}

const revenueRow = z
  .object({
    jobId: uuid.nullable().optional(),
    clientId: uuid.nullable().optional(),
    revenueDate: isoDate,
    kind: revenueKind,
    description: text(500).nullable().optional(),
    amountCents: cents.nullable().optional(),
    invoiceNumber: text(80).nullable().optional(),
    note: text(1000).nullable().optional(),
  })
  .refine((data) => Boolean(data.jobId) || Boolean(data.clientId), { message: 'Pick a job or a client.', path: ['jobId'] });
const revenuesSchema = z.object({ rows: z.array(revenueRow).min(1).max(200) });
export type SaveRevenueBulkActionInput = z.input<typeof revenuesSchema>;
export async function saveRevenueBulkAction(input: SaveRevenueBulkActionInput) {
  return runAction(revenuesSchema, input, (data, ctx) => saveRevenueBulk(ctx, data.rows));
}

const vasRow = z
  .object({
    vasServiceId: uuid,
    jobId: uuid.nullable().optional(),
    clientId: uuid.nullable().optional(),
    workDate: isoDate,
    quantity,
    unitPrice: unitPrice.nullable().optional(),
    laborClassId: uuid.nullable().optional(),
    headcount: headcount.nullable().optional(),
    hours: hours.optional(),
    materialCents: positiveCents.nullable().optional(),
    note: text(1000).nullable().optional(),
  })
  .refine((data) => Boolean(data.jobId) || Boolean(data.clientId), { message: 'Pick a job or a client.', path: ['jobId'] });
const vasRowsSchema = z.object({ rows: z.array(vasRow).min(1).max(200) });
export type SaveVasEntriesBulkActionInput = z.input<typeof vasRowsSchema>;
export async function saveVasEntriesBulkAction(input: SaveVasEntriesBulkActionInput) {
  return runAction(vasRowsSchema, input, (data, ctx) => saveVasEntriesBulk(ctx, data.rows));
}

const pullSchema = z.object({ job: z.string().trim().min(1).max(80) });
/** Adds the parts a linked warehouse work order used since the last pull. */
export async function pullWmsUsageAction(input: z.input<typeof pullSchema>) {
  return runAction(pullSchema, input, (data, ctx) => pullWmsUsage(ctx, data.job));
}
