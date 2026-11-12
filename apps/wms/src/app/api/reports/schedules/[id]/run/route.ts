/** `POST /api/reports/schedules/[id]/run` — "Send now": deliver once without moving the next run. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { RATE_LIMITS } from '@/server/auth/rate-limit';
import { runScheduleNow } from '@/server/repositories/reports-schedules';

export const POST = defineRoute({
  name: 'POST /api/reports/schedules/[id]/run',
  transaction: false,
  rateLimit: RATE_LIMITS.bulkIo,
  params: z.object({ id: z.string().uuid() }),
  handler: ({ db, auth, params }) => runScheduleNow(db, auth, params.id),
});
