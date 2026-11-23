/**
 * The password rules, as the browser shows them (docs/billing/SPEC.md section 5.1). PURE.
 *
 * The server is the judge: `passwordPolicyPlugin` in `@kitstak/auth` checks every new password.
 * This file mirrors its default policy. The four rules are on screen before the first key press,
 * each turns green as it is met, and a refusal names every missing rule at once. `password-rules.test.ts` proves the two agree.
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

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * Every checklist rule the password does not meet yet, in the words of one sentence:
 * ['10 or more characters', 'a number', 'a symbol, like ! or #']. Empty when all four are met.
 */
export function missingRuleWords(password: string): readonly string[] {
  const words: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) words.push(`${PASSWORD_MIN_LENGTH} or more characters`);
  const upper = /[A-Z]/.test(password);
  const lower = /[a-z]/.test(password);
  if (!upper && !lower) words.push('a capital and a small letter');
  else if (!upper) words.push('a capital letter');
  else if (!lower) words.push('a small letter');
  if (!/[0-9]/.test(password)) words.push('a number');
  if (!/[^A-Za-z0-9]/.test(password)) words.push('a symbol, like ! or #');
  return words;
}

/** True when what is wrong is on the checklist: the form marks the rules instead of adding a line. */
export function isRulesIssue(password: string): boolean {
  return password.length > 0 && password.length <= PASSWORD_MAX_LENGTH && missingRuleWords(password).length > 0;
}

/**
 * What is wrong with a password, as one full sentence, or null when it is fine. Every rule that is
 * still missing is named at once, so nobody fixes one thing only to be told about the next.
 */
export function passwordIssue(password: string, context: PasswordContext = {}): string | null {
  if (password.length === 0) return 'Enter a password.';
  if (password.length > PASSWORD_MAX_LENGTH || byteLength(password) > PASSWORD_MAX_LENGTH) {
    return `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  }
  const missing = missingRuleWords(password);
  if (missing.length > 0) return `Your password still needs ${joinWords(missing)}.`;
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
