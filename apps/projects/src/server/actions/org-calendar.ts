'use server';
import { z } from 'zod';
import { updateOrgCalendar } from '@/server/domain/programs';
import { runAction } from './_action';
import { isoDate, version } from './program-schemas';

const schema = z.object({
  expectedVersion: version,
  patch: z.object({
    timezone: z.string().max(64).optional(),
    workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    holidays: z.array(z.object({ date: isoDate, name: z.string().trim().min(1).max(80) })).max(200).optional(),
    dailyCapacityHours: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/).nullable().optional(),
  }),
});
export async function updateOrgCalendarAction(input: z.input<typeof schema>) {
  return runAction(schema, input, (data, ctx) => updateOrgCalendar(ctx, data.patch, data.expectedVersion));
}
