/** `PATCH` / `DELETE /api/reports/schedules/[id]` — edit, pause or remove one of the caller's schedules. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { deleteSchedule, schedulePatchSchema, updateSchedule } from '@/server/repositories/reports-schedules';

const params = z.object({ id: z.string().uuid() });

export const PATCH = defineRoute({
  name: 'PATCH /api/reports/schedules/[id]',
  params,
  body: schedulePatchSchema,
  handler: async ({ db, auth, params: p, body }) => await updateSchedule(db, auth, p.id, body),
});

export const DELETE = defineRoute({
  name: 'DELETE /api/reports/schedules/[id]',
  params,
  handler: async ({ db, auth, params: p }) => await deleteSchedule(db, auth, p.id),
});
