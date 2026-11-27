import { z } from 'zod';
import { apiRoute } from '@/server/http/api';
import { previewVersion } from '@/server/domain/programs';
import { DomainError } from '@/server/errors';
import { cardLineInputSchema, rateRuleInputSchema } from '@/lib/program-types';

const body = z.object({
  versionId: z.uuid(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lines: z.array(cardLineInputSchema).max(250).optional(),
  rules: z.array(rateRuleInputSchema).max(120).optional(),
});

/** POST /api/v1/programs/:key/price-card/preview (read only, CSRF checked, the body is a draft). */
export const POST = apiRoute<{ key: string }>(async ({ ctx, request }) => {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new DomainError('VALIDATION', 'Some fields need another look.');
  return previewVersion(ctx, parsed.data.versionId, parsed.data);
});
