/**
 * Pure option lists + zod schemas for the account screens (My Profile, Change Password,
 * Preferences). Shared by the client forms and unit tests; no React, no db.
 */
import { z } from "zod";
import { formatDateTime, type FormatPreferences } from "@/lib/format";
import { passwordMeetsPolicy, type PasswordPolicyHints } from "../password-checks";

export const DATE_FORMAT_OPTIONS = [
  { value: "M/D/YYYY h:mm:ss A", label: "M/D/YYYY h:mm:ss A (default)" },
  { value: "MM/DD/YYYY h:mm A", label: "MM/DD/YYYY h:mm A" },
  { value: "DD/MM/YYYY h:mm A", label: "DD/MM/YYYY h:mm A" },
  { value: "YYYY-MM-DD h:mm A", label: "YYYY-MM-DD h:mm A (ISO)" },
  { value: "D MMM YYYY h:mm A", label: "D MMM YYYY h:mm A" },
] as const;

export const TIME_FORMAT_OPTIONS = [
  { value: "12h", label: "12-hour (4:05 PM)" },
  { value: "24h", label: "24-hour (16:05)" },
] as const;

export const NUMBER_FORMAT_OPTIONS = [
  { value: "1,025.00", label: "1,025.00" },
  { value: "1.025,00", label: "1.025,00" },
] as const;

export const preferencesFormSchema = z.object({
  dateFormat: z.string().trim().min(1, "Choose a date format").max(40),
  timeFormat: z.enum(["12h", "24h"]),
  numberFormat: z.enum(["1,025.00", "1.025,00"]),
});
export type PreferencesFormValues = z.infer<typeof preferencesFormSchema>;

/** Includes the user's current pattern when it is not one of the presets (set via API). */
export function dateFormatOptions(current: string): readonly { readonly value: string; readonly label: string }[] {
  const presets: readonly { readonly value: string; readonly label: string }[] = DATE_FORMAT_OPTIONS;
  return presets.some((o) => o.value === current) ? presets : [...presets, { value: current, label: `${current} (custom)` }];
}

/** Sample line for the live preview card. */
export function preferencesPreview(values: FormatPreferences, at: Date): { readonly dateTime: string; readonly number: string } {
  const locale = values.numberFormat === "1.025,00" ? "de-DE" : "en-US";
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1025);
  return { dateTime: formatDateTime(at, values), number };
}

export function changePasswordSchema(policy: PasswordPolicyHints) {
  return z
    .object({
      currentPassword: z.string().min(1, "Enter your current password").max(200),
      newPassword: z.string().max(200).refine((v) => passwordMeetsPolicy(v, policy), "Your new password does not meet the requirements below"),
      confirmPassword: z.string().min(1, "Confirm your new password").max(200),
    })
    .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" })
    .refine((v) => v.currentPassword === "" || v.newPassword !== v.currentPassword, { path: ["newPassword"], message: "Must differ from the current password" });
}
export type ChangePasswordValues = z.infer<ReturnType<typeof changePasswordSchema>>;
