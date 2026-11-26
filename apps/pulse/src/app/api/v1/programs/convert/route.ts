import { z } from 'zod';
import { apiRoute, readJson } from '@/server/http/api';
import { invalid } from '@/server/errors';
import { convertToProgramJob } from '@/server/domain';

const body = z.object({ jobRef: z.string().trim().min(1).max(64) });

/** `{ jobRef }`: makes a job a program link already points at a program job (`TrackedProgramDTO`). Safe to call twice. Needs `job:manage`. */
export const POST = apiRoute(async ({ ctx, request }) => {
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) throw invalid('Say which job: send { jobRef }.', { jobRef: 'Say which job.' });
  return convertToProgramJob(ctx, parsed.data.jobRef);
});
