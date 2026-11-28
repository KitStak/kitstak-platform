'use server';
/** The welcome claim step (docs/crew/SPEC.md 3.1 and 6.1 `/welcome`). */
import { z } from 'zod';
import { claimCrewOwnership } from '@/server/domain/roles';
import { runAction } from './_action';

const claimSchema = z.object({
  /** The browser's time zone, used for the first site (SPEC 6.1 `/welcome`). */
  timezone: z.string().trim().max(64).optional(),
});

export async function claimCrewAction(input: z.input<typeof claimSchema>) {
  return runAction(claimSchema, input, async (data, ctx) => {
    const access = await claimCrewOwnership(ctx, { timezone: data.timezone });
    return { role: access.role };
  });
}
