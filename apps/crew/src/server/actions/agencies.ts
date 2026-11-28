'use server';
/** Agency actions (docs/crew/SPEC.md 6.1 `/people/agencies`). */
import { z } from 'zod';
import { acceptSubmissions, archiveAgency, createAgency, createAgencyLink, rejectSubmissions, revokeAgencyLink, updateAgency } from '@/server/domain/agencies';
import { runAction } from './_action';

const id = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const agencySchema = z.object({ name: z.string().trim().min(1, 'Type a name.').max(120), email: text(254), phone: text(40), notes: text(2000) });

export async function createAgencyAction(input: z.input<typeof agencySchema>) {
  return runAction(agencySchema, input, (data, ctx) => createAgency(ctx, data));
}

const updateSchema = agencySchema.extend({ vendorId: id });
export async function updateAgencyAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => updateAgency(ctx, data.vendorId, data));
}

const vendorSchema = z.object({ vendorId: id });
export async function archiveAgencyAction(input: z.input<typeof vendorSchema>) {
  return runAction(vendorSchema, input, (data, ctx) => archiveAgency(ctx, data.vendorId));
}

const linkSchema = z.object({ vendorId: id, siteId: id, days: z.number().int().min(1).max(60).optional(), maxPeople: z.number().int().min(1).max(500).optional() });
/** The token comes back once; the page shows it and never again. */
export async function createAgencyLinkAction(input: z.input<typeof linkSchema>) {
  return runAction(linkSchema, input, (data, ctx) => createAgencyLink(ctx, data.vendorId, data));
}

const linkIdSchema = z.object({ linkId: id });
export async function revokeAgencyLinkAction(input: z.input<typeof linkIdSchema>) {
  return runAction(linkIdSchema, input, (data, ctx) => revokeAgencyLink(ctx, data.linkId));
}

const decideSchema = z.object({ submissionIds: z.array(id).min(1).max(500) });
export async function acceptSubmissionsAction(input: z.input<typeof decideSchema>) {
  return runAction(decideSchema, input, (data, ctx) => acceptSubmissions(ctx, data.submissionIds));
}
export async function rejectSubmissionsAction(input: z.input<typeof decideSchema>) {
  return runAction(decideSchema, input, (data, ctx) => rejectSubmissions(ctx, data.submissionIds));
}
