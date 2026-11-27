'use server';
import { z } from 'zod';
import {
  addJobLink,
  addNote,
  archiveJob,
  bulkUpdateJobs,
  createJob,
  deleteJob,
  deleteJobPrice,
  deletePlan,
  duplicateJob,
  makeBudgetFromQuote,
  quickAddJob,
  removeJobLink,
  restoreJob,
  savePlan,
  setJobPrice,
  setJobStatus,
  updateJob,
  linkProgramToJob,
} from '@/server/domain';
import { runAction } from './_action';
import {
  bp,
  code,
  isoDate,
  jobKind,
  jobLink,
  jobStatus,
  materialMethod,
  name,
  nullableDate,
  pace,
  partsOwner,
  planInput,
  planKind,
  positiveCents,
  pricingModel,
  quantity,
  rateCents,
  text,
  unitPrice,
  usualCrew,
  uuid,
  version,
} from './schemas';

const jobFields = {
  number: code.nullable().optional(),
  name: name(200),
  clientId: uuid.nullable().optional(),
  clientName: z.string().trim().max(200).nullable().optional(),
  jobTypeId: uuid.nullable().optional(),
  siteId: uuid.nullable().optional(),
  kind: jobKind.optional(),
  status: jobStatus.optional(),
  pricingModel: pricingModel.optional(),
  unitLabel: z.string().trim().max(30).nullable().optional(),
  plannedUnits: quantity.optional(),
  unitPrice: unitPrice.nullable().optional(),
  fixedPriceCents: positiveCents.nullable().optional(),
  billRateCents: rateCents.nullable().optional(),
  materialMethod: materialMethod.optional(),
  materialCostPerUnit: unitPrice.optional(),
  partsOwner: partsOwner.nullable().optional(),
  defaultLaborClassId: uuid.nullable().optional(),
  usualCrew: usualCrew.optional(),
  standardUph: pace.nullable().optional(),
  targetMarginBp: bp.nullable().optional(),
  startDate: nullableDate.optional(),
  dueDate: nullableDate.optional(),
  completedDate: nullableDate.optional(),
  poNumber: text(80).nullable().optional(),
  ownerId: uuid.nullable().optional(),
  description: text(5000).nullable().optional(),
  kitSku: text(80).nullable().optional(),
  kitName: text(200).nullable().optional(),
  pinnedNote: text(1000).nullable().optional(),
};

const createJobSchema = z.object({ ...jobFields, createClient: z.boolean().optional(), quote: planInput.nullable().optional(), budget: planInput.nullable().optional(), links: z.array(jobLink).max(10).optional(), linkProgramId: uuid.nullable().optional() }).refine((data) => Boolean(data.clientId) || Boolean(data.clientName), { message: 'Pick a client or type a new client name.', path: ['clientId'] });
export type CreateJobActionInput = z.input<typeof createJobSchema>;
/** The "More options" new job form: basics, price and plan, links. */
export async function createJobAction(input: CreateJobActionInput) {
  return runAction(createJobSchema, input, (data, ctx) => createJob(ctx, data, { guardLookAlike: true }));
}

const quickAddSchema = z
  .object({ clientId: uuid.nullable().optional(), clientName: z.string().trim().max(200).nullable().optional(), createClient: z.boolean().optional(), name: name(200), plannedUnits: quantity.nullable().optional(), unitPrice: unitPrice.nullable().optional(), siteId: uuid.nullable().optional() })
  .refine((data) => Boolean(data.clientId) || Boolean(data.clientName), { message: 'Pick a client or type a new client name.', path: ['clientId'] });
export type QuickAddJobActionInput = z.input<typeof quickAddSchema>;
/** The quick add row: client, job name, units, price per unit. Active at once, General job type, quote from the price. */
export async function quickAddJobAction(input: QuickAddJobActionInput) {
  return runAction(quickAddSchema, input, (data, ctx) => quickAddJob(ctx, data));
}

const { clientName: _clientName, status: _status, unitPrice: _unitPrice, billRateCents: _billRate, materialCostPerUnit: _material, completedDate: _completed, ...editable } = jobFields;
void [_clientName, _status, _unitPrice, _billRate, _material, _completed];
const updateJobSchema = z.object({ jobId: uuid, patch: z.object(editable).partial(), version });
export type UpdateJobActionInput = z.input<typeof updateJobSchema>;
/** Edits a job. Prices go through `setJobPriceAction` and status through `setJobStatusAction`. */
export async function updateJobAction(input: UpdateJobActionInput) {
  return runAction(updateJobSchema, input, (data, ctx) => updateJob(ctx, data.jobId, data.patch, data.version));
}

const statusSchema = z.object({ jobId: uuid, status: jobStatus, completedDate: nullableDate.optional(), version });
export async function setJobStatusAction(input: z.input<typeof statusSchema>) {
  return runAction(statusSchema, input, (data, ctx) => setJobStatus(ctx, data.jobId, data.status, { completedDate: data.completedDate, version: data.version }));
}

const bulkSchema = z.object({ jobIds: z.array(uuid).min(1).max(500), status: jobStatus.optional(), ownerId: uuid.nullable().optional(), archived: z.boolean().optional() });
/** Bulk actions of the Jobs page. Jobs that cannot change are listed in `failed`. */
export async function bulkUpdateJobsAction(input: z.input<typeof bulkSchema>) {
  return runAction(bulkSchema, input, (data, ctx) => bulkUpdateJobs(ctx, data.jobIds, { status: data.status, ownerId: data.ownerId, archived: data.archived }));
}

const duplicateSchema = z.object({ jobId: uuid, name: z.string().trim().max(200).nullable().optional(), withPlans: z.boolean().optional(), startDate: nullableDate.optional(), dueDate: nullableDate.optional() });
/** "Copy this job". */
export async function duplicateJobAction(input: z.input<typeof duplicateSchema>) {
  return runAction(duplicateSchema, input, (data, ctx) => duplicateJob(ctx, data.jobId, data));
}

const archiveSchema = z.object({ jobId: uuid, archived: z.boolean().optional() });
export async function archiveJobAction(input: z.input<typeof archiveSchema>) {
  return runAction(archiveSchema, input, (data, ctx) => archiveJob(ctx, data.jobId, data.archived ?? true));
}

const jobIdSchema = z.object({ jobId: uuid });
const deleteJobSchema = z.object({ jobId: uuid, revalidate: z.boolean().optional() });
/**
 * Deletes a job. Pass `revalidate: false` when the person may be looking at that job's own page:
 * a revalidate would render that page again in the same answer, and it no longer exists, so the
 * screen would turn into "not found" before the client can move to the jobs list.
 */
export async function deleteJobAction(input: z.input<typeof deleteJobSchema>) {
  return runAction(deleteJobSchema, input, (data, ctx) => deleteJob(ctx, data.jobId), { revalidate: input?.revalidate !== false });
}
export async function restoreJobAction(input: z.input<typeof jobIdSchema>) {
  return runAction(jobIdSchema, input, (data, ctx) => restoreJob(ctx, data.jobId));
}

const priceSchema = z.object({ jobId: uuid, effectiveFrom: isoDate.nullable().optional(), unitPrice: unitPrice.nullable().optional(), billRateCents: rateCents.nullable().optional(), materialCostPerUnit: unitPrice.optional(), note: text(500).nullable().optional() });
export type SetJobPriceActionInput = z.input<typeof priceSchema>;
/** "From which day?" Adds or edits a dated price and restamps the open entries from that day. */
export async function setJobPriceAction(input: SetJobPriceActionInput) {
  return runAction(priceSchema, input, (data, ctx) => setJobPrice(ctx, data.jobId, data));
}

const priceIdSchema = z.object({ priceId: uuid });
export async function deleteJobPriceAction(input: z.input<typeof priceIdSchema>) {
  return runAction(priceIdSchema, input, (data, ctx) => deleteJobPrice(ctx, data.priceId));
}

const addLinkSchema = z.object({ jobId: uuid, link: jobLink });
export async function addJobLinkAction(input: z.input<typeof addLinkSchema>) {
  return runAction(addLinkSchema, input, (data, ctx) => addJobLink(ctx, data.jobId, data.link));
}

const linkProgramSchema = z.object({ jobId: uuid, programId: uuid, moveTypedUnits: z.boolean().optional() });
/** Links a KitStak program to the job (a `bills_to` edge plus its mirror), after the checks. */
export async function linkProgramAction(input: z.input<typeof linkProgramSchema>) {
  return runAction(linkProgramSchema, input, (data, ctx) => linkProgramToJob(ctx, data.jobId, data.programId, { moveTypedUnits: data.moveTypedUnits }));
}

const linkIdSchema = z.object({ linkId: uuid });
export async function removeJobLinkAction(input: z.input<typeof linkIdSchema>) {
  return runAction(linkIdSchema, input, (data, ctx) => removeJobLink(ctx, data.linkId));
}

const savePlanSchema = z.object({ jobId: uuid, plan: planKind, input: planInput });
export type SavePlanActionInput = z.input<typeof savePlanSchema>;
/** Saves the quote or the budget of a job: totals, or lines whose sum is the totals. */
export async function savePlanAction(input: SavePlanActionInput) {
  return runAction(savePlanSchema, input, (data, ctx) => savePlan(ctx, data.jobId, data.plan, data.input));
}

/** "Make my own budget": copies the quote. */
export async function makeBudgetFromQuoteAction(input: z.input<typeof jobIdSchema>) {
  return runAction(jobIdSchema, input, (data, ctx) => makeBudgetFromQuote(ctx, data.jobId));
}

const deletePlanSchema = z.object({ jobId: uuid, plan: planKind });
export async function deletePlanAction(input: z.input<typeof deletePlanSchema>) {
  return runAction(deletePlanSchema, input, (data, ctx) => deletePlan(ctx, data.jobId, data.plan));
}

const noteSchema = z.object({ jobId: uuid.nullable().optional(), clientId: uuid.nullable().optional(), body: z.string().trim().min(1, 'Write a note first.').max(4000) });
/** A note on a job or a client (the Activity tab composer). */
export async function addNoteAction(input: z.input<typeof noteSchema>) {
  return runAction(noteSchema, input, (data, ctx) => addNote(ctx, data));
}
