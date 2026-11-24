/**
 * What the password meter and the live warning say while a person types (review round 3). PURE.
 *
 * The rule: the screen never says something that is not true. A password the server would refuse
 * is never "Good" or "Strong", and the reason is said while typing, not only after the button.
 * The checks themselves live in `password-rules.ts` (the mirror of the server policy). This file
 * only decides what to show.
 */
import {
  COMPANY_NAME_MESSAGE,
  PASSWORD_MAX_LENGTH,
  PRODUCT_NAME_MESSAGE,
  missingRuleWords,
  usesCompanyName,
  usesProductName,
  weakPasswordMessage,
  passwordStrength,
  type PasswordContext,
  type PasswordStrength,
} from './password-rules';

export const EMAIL_NAME_MESSAGE = 'Do not use your email name in your password.';

/** True when the password holds the part of the email before the "@" (3 characters or more). */
export function usesEmailName(password: string, email: string | undefined): boolean {
  const localPart = email?.split('@')[0]?.trim().toLowerCase();
  return Boolean(localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart));
}

/**
 * The sentence for a password that is refused for a reason the checklist does not show, or null.
 *   - A name (the email name, the company name, the product name): said as soon as it is typed,
 *     whatever else is missing, and it names the cause. It is the one thing a person can fix at
 *     once, and no number of extra characters makes that password pass (review round 4).
 *   - Easy to guess in another way (`passwordpassword`, `123456789012345`): said once the
 *     checklist is met, which is when the form would say it. Before that the checklist is the
 *     thing to fix.
 * The company comes from the form, so the answer follows it: fill the company in after the
 * password and the line appears; change the company and it goes away.
 */
export function passwordWarning(password: string, context: PasswordContext = {}): string | null {
  if (password.length === 0) return null;
  if (usesEmailName(password, context.email)) return EMAIL_NAME_MESSAGE;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) return `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  if (usesCompanyName(password, { names: [context.company] })) return COMPANY_NAME_MESSAGE;
  if (usesProductName(password)) return PRODUCT_NAME_MESSAGE;
  if (missingRuleWords(password).length === 0) return weakPasswordMessage(password, { names: [context.company] });
  return null;
}

/** The meter: "Too weak" for every password the server would refuse for one of the reasons above. */
export function meterStrength(password: string, context: PasswordContext = {}): PasswordStrength {
  if (!password) return { score: 0, label: '' };
  if (passwordWarning(password, context) !== null) return { score: 0, label: 'Too weak' };
  return passwordStrength(password);
}
