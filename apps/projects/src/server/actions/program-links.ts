'use server';
import { z } from 'zod';
import { linkPulseJob, linkRecord, unlinkPulseJob, unlinkRecord } from '@/server/domain/programs';
import { runAction } from './_action';
import { programKey, uuid } from './program-schemas';

const TYPES = ['core_customer', 'core_item', 'crm_deal', 'crm_account', 'pm_project', 'pm_program', 'pm_task', 'pm_build', 'pm_variant', 'pulse_job', 'wms_work_order', 'wms_shipment_order', 'wms_client', 'wms_product'] as const;
const ref = z.object({ type: z.enum(TYPES), id: z.string().trim().min(1).max(200) });
const linkSchema = z.object({
  from: ref,
  to: ref,
  relation: z.enum(['related', 'belongs_to', 'uses_kit', 'created_from']).default('related'),
  cache: z.object({ title: z.string().max(500).optional(), status: z.string().max(120).optional(), url: z.string().max(2000).optional() }).optional(),
});
export async function linkRecordAction(input: z.input<typeof linkSchema>) {
  return runAction(linkSchema, input, (data, ctx) => linkRecord(ctx, data.from, data.to, data.relation, data.cache), { revalidate: false });
}

const unlinkSchema = z.object({ linkId: z.string().min(1).max(200) });
export async function unlinkRecordAction(input: z.input<typeof unlinkSchema>) {
  return runAction(unlinkSchema, input, async (data, ctx) => {
    await unlinkRecord(ctx, data.linkId);
    return {};
  }, { revalidate: false });
}

const targetSchema = z.union([z.object({ programKey, jobId: uuid }), z.object({ buildId: uuid, jobId: uuid })]);
export async function linkPulseJobAction(input: z.input<typeof targetSchema>) {
  return runAction(targetSchema, input, (data, ctx) => linkPulseJob(ctx, 'programKey' in data ? { programKey: data.programKey } : { buildId: data.buildId }, data.jobId), { revalidate: false });
}

const unlinkJobSchema = z.union([z.object({ programKey }), z.object({ buildId: uuid })]);
export async function unlinkPulseJobAction(input: z.input<typeof unlinkJobSchema>) {
  return runAction(unlinkJobSchema, input, (data, ctx) => unlinkPulseJob(ctx, 'programKey' in data ? { programKey: data.programKey } : { buildId: data.buildId }), { revalidate: false });
}
