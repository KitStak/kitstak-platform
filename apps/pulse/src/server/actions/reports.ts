'use server';
import { z } from 'zod';
import { deleteReportSchedule, restoreReportSchedule, runReportSchedule, saveReportSchedule, setReportScheduleEnabled } from '@/server/domain';
import { SCHEDULE_CADENCES, SCHEDULE_RANGES } from '@/lib/reports';
import { runAction } from './_action';
import { name, uuid } from './schemas';

const scheduleSchema = z.object({
  id: uuid.nullable().optional(),
  name: name(80),
  report: z.string().min(1).max(60),
  cadence: z.enum(SCHEDULE_CADENCES),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  hour: z.number().int().min(0).max(23),
  range: z.enum(SCHEDULE_RANGES),
  siteId: uuid.nullable().optional(),
  clientId: uuid.nullable().optional(),
  jobTypeId: uuid.nullable().optional(),
  recipientUserIds: z.array(uuid).max(50).optional(),
  includeMoney: z.boolean().optional(),
  enabled: z.boolean().optional(),
});
export type SaveReportScheduleInput = z.input<typeof scheduleSchema>;

/** Creates or edits a report schedule ("Build on a schedule"). */
export async function saveReportScheduleAction(input: SaveReportScheduleInput) {
  return runAction(scheduleSchema, input, (data, ctx) => saveReportSchedule(ctx, data), { revalidate: false });
}

const scheduleIdSchema = z.object({ scheduleId: uuid });
export async function deleteReportScheduleAction(input: z.input<typeof scheduleIdSchema>) {
  return runAction(scheduleIdSchema, input, (data, ctx) => deleteReportSchedule(ctx, data.scheduleId), { revalidate: false });
}

/** Undo of a deleted schedule. */
export async function restoreReportScheduleAction(input: z.input<typeof scheduleIdSchema>) {
  return runAction(scheduleIdSchema, input, (data, ctx) => restoreReportSchedule(ctx, data.scheduleId), { revalidate: false });
}

const enabledSchema = z.object({ scheduleId: uuid, enabled: z.boolean() });
export async function setReportScheduleEnabledAction(input: z.input<typeof enabledSchema>) {
  return runAction(enabledSchema, input, (data, ctx) => setReportScheduleEnabled(ctx, data.scheduleId, data.enabled), { revalidate: false });
}

/** "Build now": builds the schedule's report right away and tells its recipients. */
export async function runReportScheduleAction(input: z.input<typeof scheduleIdSchema>) {
  return runAction(scheduleIdSchema, input, (data, ctx) => runReportSchedule(ctx, data.scheduleId));
}
