'use server';
import { z } from 'zod';
import { runSync, setLinkImportsTime } from '@/server/domain';
import { runAction } from './_action';
import { uuid } from './schemas';

const syncSchema = z.object({ source: z.enum(['crm', 'wms', 'projects', 'all']) });
/** "Sync now": pulls one connected app, or all of them. Safe to run again: nothing is counted twice. */
export async function syncNowAction(input: z.input<typeof syncSchema>) {
  return runAction(syncSchema, input, (data, ctx) => runSync(ctx, data.source));
}

const importsTimeSchema = z.object({ linkId: uuid, importsTime: z.boolean() });
/** Count (or stop counting) a linked project's logged time as this job's labor hours. */
export async function setLinkImportsTimeAction(input: z.input<typeof importsTimeSchema>) {
  return runAction(importsTimeSchema, input, (data, ctx) => setLinkImportsTime(ctx, data.linkId, data.importsTime));
}
