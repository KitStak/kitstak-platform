/** Client-side login validation (BUILD_PLAN 0.3: inline field errors before any request). */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email address')),
  password: z.string().min(1, 'Password is required'),
});

export type LoginField = keyof z.input<typeof loginSchema>;
export type LoginFieldErrors = Partial<Record<LoginField, string>>;

/** First message per field, or an empty object when the input is valid. */
export function validateLogin(input: {
  readonly email: string;
  readonly password: string;
}): LoginFieldErrors {
  const parsed = loginSchema.safeParse(input);
  if (parsed.success) return {};
  const errors: LoginFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if ((field === 'email' || field === 'password') && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}
