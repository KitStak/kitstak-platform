'use client';
import { z } from 'zod';
import { apiRequest } from '@/lib/api';
import type { OnboardingResultDto } from '@/server/services/contracts/dto';

export const ORG_NAME_MAX = 80;

export const onboardingSchema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(2, 'Enter at least 2 characters.')
    .max(ORG_NAME_MAX, `Use ${ORG_NAME_MAX} characters or fewer.`),
  workspaceName: z.string().trim().min(1).max(120).optional(),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;

/**
 * Creates the user's organization plus the default CRM workspace (POST /api/v1/onboarding,
 * owned by the backend services). Resolves with the new org slug to navigate to.
 */
export async function runOnboarding(input: OnboardingInput): Promise<OnboardingResultDto> {
  return apiRequest<OnboardingResultDto>('/onboarding', { method: 'POST', body: input });
}
