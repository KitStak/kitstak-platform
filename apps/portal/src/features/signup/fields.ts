/**
 * The signup field rules and their exact messages (docs/billing/SPEC.md section 5.1). PURE, shared by
 * the forms (checks on blur and on submit) and the server actions (the same checks again).
 */
import { passwordIssue } from './password-rules';

export const NAME_MIN = 2;
export const NAME_MAX = 100;
export const COMPANY_MIN = 2;
export const COMPANY_MAX = 80;
export const EMAIL_MAX = 254;

// One "@", something before it, a dot in the domain, no spaces. The server checks again.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function nameIssue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < NAME_MIN) return 'Enter your full name.';
  if (trimmed.length > NAME_MAX) return `Use ${NAME_MAX} characters or fewer.`;
  return null;
}

export function emailIssue(value: string, message = 'Enter a valid work email.'): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > EMAIL_MAX || !EMAIL_SHAPE.test(trimmed)) return message;
  return null;
}

export function companyIssue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < COMPANY_MIN) return 'Enter your company or team name.';
  if (trimmed.length > COMPANY_MAX) return `Use ${COMPANY_MAX} characters or fewer.`;
  return null;
}

export type SignupField = 'name' | 'email' | 'password' | 'company';
export const SIGNUP_FIELDS: readonly SignupField[] = ['name', 'email', 'password', 'company'];

export interface SignupValues {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly company: string;
}

export function signupFieldIssue(field: SignupField, values: SignupValues): string | null {
  switch (field) {
    case 'name':
      return nameIssue(values.name);
    case 'email':
      return emailIssue(values.email);
    case 'password':
      return passwordIssue(values.password, { email: values.email, company: values.company });
    case 'company':
      return companyIssue(values.company);
  }
}

/** Every problem on the form, keyed by field, in field order. Empty when the form is good. */
export function signupIssues(values: SignupValues): Partial<Record<SignupField, string>> {
  const issues: Partial<Record<SignupField, string>> = {};
  for (const field of SIGNUP_FIELDS) {
    const issue = signupFieldIssue(field, values);
    if (issue) issues[field] = issue;
  }
  return issues;
}

/** Keeps only digits and stops at `length`. "123 456", "123-456" and "Code: 123456" all work. */
export function cleanCode(value: string, length = 6): string {
  return value.replace(/\D/g, '').slice(0, length);
}

/** "maya chen" to "Maya". Used for greetings. */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}
