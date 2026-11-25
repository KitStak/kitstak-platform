'use server';
import { z } from 'zod';
import { archiveNotifications, markAllNotificationsRead, markNotificationsRead } from '@/server/domain';
import { runAction } from './_action';
import { uuid } from './schemas';

const idsSchema = z.object({ ids: z.array(uuid).min(1).max(500), value: z.boolean().optional() });

export async function markNotificationsReadAction(input: z.input<typeof idsSchema>) {
  return runAction(idsSchema, input, (data, ctx) => markNotificationsRead(ctx, data.ids, data.value ?? true), { read: true });
}

export async function markAllNotificationsReadAction() {
  return runAction(z.object({}), {}, (_data, ctx) => markAllNotificationsRead(ctx), { read: true });
}

export async function archiveNotificationsAction(input: z.input<typeof idsSchema>) {
  return runAction(idsSchema, input, (data, ctx) => archiveNotifications(ctx, data.ids, data.value ?? true));
}
