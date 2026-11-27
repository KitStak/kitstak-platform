import { z } from 'zod';
import { apiRoute, readJson } from '@/server/http/api';
import { invalid } from '@/server/errors';
import { trackProgram } from '@/server/domain';

const body = z.object({
  programId: z.guid('That id is not valid.'),
  clientId: z.guid('That id is not valid.').nullable().optional(),
  jobRef: z.string().trim().min(1).max(64).nullable().optional(),
});

/**
 * "Track in Pulse" (`TrackedProgramDTO`): `{ programId, clientId?, jobRef? }`. Makes the program
 * job (or links the job `jobRef`), writes the link and queues a program sync. Needs `job:manage`.
 */
export const POST = apiRoute(async ({ ctx, request }) => {
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) throw invalid('Some fields need another look.', Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.') || 'form', issue.message])));
  return trackProgram(ctx, parsed.data.programId, { clientId: parsed.data.clientId ?? null, jobRef: parsed.data.jobRef ?? null });
});
