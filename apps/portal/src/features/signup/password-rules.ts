/**
 * The password rules, as the browser shows them (docs/billing/SPEC.md section 5.1). PURE.
 *
 * The server is the judge: `passwordPolicyPlugin` in `@kitstak/auth` checks every new password.
 * This file mirrors its default policy so a person sees each rule turn green while they type and
 * never has to guess. `password-rules.test.ts` proves the two agree.
 */

export const PASSWORD_MIN_LENGTH = 10;
/** 72, not more: older credentials are bcrypt hashes, and bcrypt ignores bytes after the 72nd. */
export const PASSWORD_MAX_LENGTH = 72;

export type PasswordRuleId = 'length' | 'case' | 'number' | 'symbol';

export interface PasswordRule {
  readonly id: PasswordRuleId;
  /** Short words for the live checklist. */
  readonly label: string;
  readonly met: boolean;
}

export interface PasswordContext {
  readonly email?: string;
}

/** The four rules a person can see and tick off, in the order they are shown. */
export function passwordRules(password: string): readonly PasswordRule[] {
  return [
    { id: 'length', label: `${PASSWORD_MIN_LENGTH} or more characters`, met: password.length >= PASSWORD_MIN_LENGTH },
    { id: 'case', label: 'A capital and a small letter', met: /[A-Z]/.test(password) && /[a-z]/.test(password) },
    { id: 'number', label: 'A number', met: /[0-9]/.test(password) },
    { id: 'symbol', label: 'A symbol, like ! or #', met: /[^A-Za-z0-9]/.test(password) },
  ];
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * The first thing wrong with a password, as a full sentence, or null when it is fine. The wording
 * for length follows the spec; the rest matches the shared policy so both say the same thing.
 */
export function passwordIssue(password: string, context: PasswordContext = {}): string | null {
  if (password.length === 0) return 'Enter a password.';
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH || byteLength(password) > PASSWORD_MAX_LENGTH) {
    return `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  }
  if (!/[A-Z]/.test(password)) return 'Include a capital letter.';
  if (!/[a-z]/.test(password)) return 'Include a small letter.';
  if (!/[0-9]/.test(password)) return 'Include a number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Include a symbol, like ! or #.';
  const localPart = context.email?.split('@')[0]?.trim().toLowerCase();
  if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    return 'Do not use your email name in your password.';
  }
  return null;
}

export interface PasswordStrength {
  readonly score: 0 | 1 | 2 | 3 | 4;
  readonly label: string;
}

/** A small strength meter: one point per rule met, with a bonus look at length. */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: '' };
  const met = passwordRules(password).filter((rule) => rule.met).length;
  // All four rules met reads "Good". A long password that meets them reads "Strong".
  const score = (met === 4 && password.length >= 14 ? 4 : met === 4 ? 3 : Math.min(met, 2)) as PasswordStrength['score'];
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;
  return { score, label: labels[score] };
}
