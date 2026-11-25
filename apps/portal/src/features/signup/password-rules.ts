/**
 * The password rules, as the browser shows them (docs/billing/SPEC.md section 5.1). PURE.
 *
 * The server is the judge: `passwordPolicyPlugin` in `@kitstak/auth` checks every new password.
 * This file mirrors its default policy. The four rules are on screen before the first key press,
 * each turns green as it is met, and a refusal names every missing rule at once. `password-rules.test.ts` proves the two agree.
 *
 * One more way in (review round 2): a password of 15 characters or more needs nothing else. No
 * capital, no number, no symbol. "correct horse battery staple" is a good password.
 */

import {
  COMPANY_NAME_MESSAGE,
  EASY_TO_GUESS_MESSAGE,
  PRODUCT_NAME_MESSAGE,
  isEasyToGuess,
  usesCompanyName,
  usesProductName,
  weakPasswordMessage,
} from '@kitstak/auth/weak-passwords';

export { COMPANY_NAME_MESSAGE, EASY_TO_GUESS_MESSAGE, PRODUCT_NAME_MESSAGE, isEasyToGuess, usesCompanyName, usesProductName, weakPasswordMessage };

export const PASSWORD_MIN_LENGTH = 10;
/** From this length on, the password passes with no other rule. The same number as the shared policy. */
export const PASSWORD_PASSPHRASE_LENGTH = 15;
/** One plain line for the screens, so the easy way is said before the first key press. */
export const PASSPHRASE_HINT = `${PASSWORD_PASSPHRASE_LENGTH} or more characters is enough by itself. A few words work well.`;

/** True when the password is long enough to need no capital, number or symbol. */
export function isPassphrase(password: string): boolean {
  return password.length >= PASSWORD_PASSPHRASE_LENGTH;
}
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
  /** The person's own company name, when the form knows it. */
  readonly company?: string;
}

/** The four rules a person can see and tick off, in the order they are shown. */
export function passwordRules(password: string): readonly PasswordRule[] {
  // A long password has met them all: length stands in for the other three.
  const long = isPassphrase(password);
  return [
    { id: 'length', label: `${PASSWORD_MIN_LENGTH} or more characters`, met: password.length >= PASSWORD_MIN_LENGTH },
    { id: 'case', label: 'A capital and a small letter', met: long || (/[A-Z]/.test(password) && /[a-z]/.test(password)) },
    { id: 'number', label: 'A number', met: long || /[0-9]/.test(password) },
    { id: 'symbol', label: 'A symbol, like ! or #', met: long || /[^A-Za-z0-9]/.test(password) },
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
  if (isPassphrase(password)) return [];
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
  if (missing.length > 0) {
    // The easy way is named too, once the short rules are the only thing missing.
    const longer = password.length >= PASSWORD_MIN_LENGTH ? ` Or make it ${PASSWORD_PASSPHRASE_LENGTH} characters or longer.` : '';
    return `Your password still needs ${joinWords(missing)}.${longer}`;
  }
  const localPart = context.email?.split('@')[0]?.trim().toLowerCase();
  if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    return 'Do not use your email name in your password.';
  }
  // Length is not strength by itself (review round 3): the same check the server runs, so
  // `passwordpassword`, `aaaaaaaaaaaaaaaa`, `123456789012345` and `qwertyuiopasdfgh` are refused here too.
  // The line names the cause when the cause is a name (review round 4): "Do not use your company
  // name in your password." The same words the server answers with.
  return weakPasswordMessage(password, { names: [context.company] });
}

export interface PasswordStrength {
  readonly score: 0 | 1 | 2 | 3 | 4;
  readonly label: string;
}

/** A small strength meter: one point per rule met, with a bonus look at length. */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: '' };
  // A password a guessing program tries first is never "Good", however long it is.
  if (isEasyToGuess(password)) return { score: 0, label: 'Too weak' };
  const met = passwordRules(password).filter((rule) => rule.met).length;
  // All four rules met reads "Good". A long password reads "Good" at 15 characters and "Strong" at 20,
  // whatever it is made of, or at 14 when it also has a capital, a number and a symbol.
  const mixed = /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
  const strong = password.length >= 20 || (mixed && password.length >= 14);
  const score = (met === 4 && strong ? 4 : met === 4 ? 3 : Math.min(met, 2)) as PasswordStrength['score'];
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;
  return { score, label: labels[score] };
}
