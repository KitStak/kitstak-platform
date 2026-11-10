/**
 * Password policy from `company_settings.password_policy` (sparse JSON) merged with defaults.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { companySettings } from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { MAX_PASSWORD_BYTES } from "./password";

export const passwordPolicySchema = z.object({
  minLength: z.number().int().min(8).max(64).default(10),
  requireUpper: z.boolean().default(true),
  requireNumber: z.boolean().default(true),
  requireSymbol: z.boolean().default(true),
  maxAgeDays: z.number().int().min(1).max(3650).optional(),
  lockoutThreshold: z.number().int().min(3).max(50).default(5),
  lockoutMinutes: z.number().int().min(1).max(1440).default(15),
});

export type PasswordPolicy = z.infer<typeof passwordPolicySchema>;

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = passwordPolicySchema.parse({});

/** Reads the company policy; invalid stored JSON falls back to defaults. */
export function getPasswordPolicy(db: AppDb): PasswordPolicy {
  const row = db
    .select({ policy: companySettings.passwordPolicy })
    .from(companySettings)
    .where(eq(companySettings.id, "company"))
    .get();
  const parsed = passwordPolicySchema.safeParse(row?.policy ?? {});
  return parsed.success ? parsed.data : DEFAULT_PASSWORD_POLICY;
}

export interface PasswordContext {
  readonly email?: string;
  readonly name?: string;
}

/** Returns human-readable violations (empty when the password is acceptable). */
export function validatePassword(password: string, policy: PasswordPolicy, context: PasswordContext = {}): readonly string[] {
  const issues: string[] = [];
  if (password.length < policy.minLength) issues.push(`Use at least ${policy.minLength} characters.`);
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) issues.push(`Use at most ${MAX_PASSWORD_BYTES} bytes.`);
  if (policy.requireUpper && !/[A-Z]/.test(password)) issues.push("Include an uppercase letter.");
  if (policy.requireUpper && !/[a-z]/.test(password)) issues.push("Include a lowercase letter.");
  if (policy.requireNumber && !/[0-9]/.test(password)) issues.push("Include a number.");
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) issues.push("Include a symbol.");
  const lowered = password.toLowerCase();
  const localPart = context.email?.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && lowered.includes(localPart)) issues.push("Do not include your email name.");
  return issues;
}

/** True when the password is older than `maxAgeDays` (no max age → never expires). */
export function isPasswordExpired(passwordChangedAt: string | null, policy: PasswordPolicy, now: Date = new Date()): boolean {
  if (!policy.maxAgeDays || !passwordChangedAt) return false;
  return now.getTime() - Date.parse(passwordChangedAt) > policy.maxAgeDays * 86_400_000;
}

/** Lockout deadline after a failed attempt, or null while under the threshold. */
export function lockoutUntil(failedCount: number, policy: PasswordPolicy, now: Date = new Date()): string | null {
  return failedCount >= policy.lockoutThreshold ? new Date(now.getTime() + policy.lockoutMinutes * 60_000).toISOString() : null;
}
