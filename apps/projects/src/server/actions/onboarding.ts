'use server';
import { z } from 'zod';
import { createSampleProject, getUserPrefs, updateUserPrefs } from '@/server/domain';
import { runAction } from './_action';
import { uuid } from './schemas';

const sampleSchema = z.object({ spaceId: uuid.nullable().optional() });
/** "Create sample project": a practice project from the Product launch template. Returns its key. */
export async function createSampleProjectAction(input: z.input<typeof sampleSchema> = {}) {
  return runAction(sampleSchema, input, async (data, ctx) => {
    const project = await createSampleProject(ctx, { spaceId: data.spaceId ?? null });
    return { id: project.id, key: project.key, name: project.name };
  });
}

const onboardingSchema = z.object({
  welcomeSeen: z.boolean().optional(),
  tourSeen: z.boolean().optional(),
  tourStep: z.number().int().min(0).max(20).optional(),
  dismissed: z.boolean().optional(),
});
/** Merges into prefs.onboarding (the welcome dialog and the guided tour remember where you are). */
export async function updateOnboardingAction(input: z.input<typeof onboardingSchema>) {
  return runAction(
    onboardingSchema,
    input,
    async (data, ctx) => {
      const prefs = await getUserPrefs(ctx);
      const onboarding = { ...(prefs.onboarding ?? {}), ...data };
      await updateUserPrefs(ctx, { onboarding });
      return onboarding;
    },
    { revalidate: false },
  );
}
