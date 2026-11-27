import { z } from 'zod';
import { apiRoute } from '@/server/http/api';
import { previewSchedule } from '@/server/domain/programs';
import { DomainError } from '@/server/errors';
import { scheduleInputSchema } from '@/lib/program-types';

const body = z.object({ input: scheduleInputSchema, from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** POST /api/v1/programs/:key/schedules/preview (read only). */
export const POST = apiRoute<{ key: string }>(async ({ ctx, params, request }) => {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new DomainError('VALIDATION', 'Some fields need another look.');
  return previewSchedule(ctx, decodeURIComponent(params.key), parsed.data.input, { from: parsed.data.from, to: parsed.data.to });
});
