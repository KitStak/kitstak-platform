/** My Profile / Change Password schemas (M14 account screens). PURE. */
import { z } from 'zod';
import { emailField, requiredText } from './common';

export const profileSchema = z.object({
  displayName: requiredText('Display name', 80),
  firstName: requiredText('First name', 60),
  lastName: requiredText('Last name', 60),
  email: emailField,
  /** Required only when the email changes (server re-checks). */
  currentPassword: z.string().max(200).default(''),
});

export type ProfileValues = z.input<typeof profileSchema>;

export const accountPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(200),
    newPassword: z.string().min(1, 'Enter a new password').max(200),
    confirmPassword: z.string().min(1, 'Re-enter the new password').max(200),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'Must differ from the current password',
  });

export type AccountPasswordValues = z.infer<typeof accountPasswordSchema>;

/** "Mike Lunsford" -> { first: "Mike", last: "Lunsford" } for users seeded without names. */
export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

/** "GMT-05:00 (America/New_York)" for the read-only timezone row. */
export function timezoneLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(
      at,
    );
    const offset = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const long = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'long' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    return `${offset === 'GMT' ? 'GMT+00:00' : offset} (${long ?? timeZone})`;
  } catch {
    return timeZone;
  }
}

/* ---------------- Help panel: Feedback & Updates ---------------- */

export const FEEDBACK_TYPES = ['idea', 'problem', 'praise'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export const FEEDBACK_TYPE_LABELS: Readonly<Record<FeedbackType, string>> = {
  idea: 'Idea or request',
  problem: "Something isn't working",
  praise: 'Something I like',
};

export const feedbackSchema = z.object({
  type: z.enum(FEEDBACK_TYPES, { error: 'Choose a feedback type' }),
  message: z
    .string()
    .trim()
    .min(10, 'Tell us a bit more (at least 10 characters)')
    .max(2000, 'At most 2000 characters'),
  /** In-app path the feedback is about (never a full URL, so no query strings or hosts leak). */
  page: z
    .string()
    .trim()
    .max(300)
    .regex(/^\/[A-Za-z0-9/_\-[\].]*$/, 'Must be an app path')
    .default('/'),
  rating: z.number().int().min(1).max(5).nullable().default(null),
});
export type FeedbackValues = z.input<typeof feedbackSchema>;

/** Strips the query string and hash from a path before it is sent as feedback context. PURE. */
export function feedbackPage(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? '/';
  return /^\/[A-Za-z0-9/_\-[\].]*$/.test(path) ? path.slice(0, 300) : '/';
}
