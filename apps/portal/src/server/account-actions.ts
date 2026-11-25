'use server';
/**
 * "My account" writes (review round 4): the person's name, and a first password for an account
 * that has none ("Email me a code instead", or an account whose never confirmed password was
 * removed at the first code sign in). Every action works on the signed in person only.
 */
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { APIError } from 'better-auth/api';
import { DEFAULT_PASSWORD_POLICY, validatePassword } from '@kitstak/auth/password-policy';
import { enforceRateLimit } from '@kitstak/billing/server';
import { nameIssue } from '@/features/signup/fields';
import { passwordIssue } from '@/features/signup/password-rules';
import { getAccountFacts, isFreshSession } from '@/server/account';
import { auth } from '@/server/auth';
import { db } from '@/server/db';
import { getSession } from '@/server/session';

export interface AccountActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly field?: 'name' | 'password';
  /** 'sign_in_again': the session is too old for this step. The page offers "Sign in again". */
  readonly code?: 'sign_in_again' | 'has_password';
}

const SIGN_IN_AGAIN = 'Please sign in again.';
const TOO_MANY_TRIES = 'Too many tries. Wait 10 minutes and try again.';
/** Said when the session is older than 15 minutes. */
const NEEDS_FRESH_SIGN_IN = 'To keep your account safe, sign in again first. Then set your password.';

function fail(error: string, extra: Partial<AccountActionResult> = {}): AccountActionResult {
  return { ok: false, error, ...extra };
}

const nameSchema = z.object({ name: z.string().max(200) });

/** Changes the name shown on the account, in every KitStak app. */
export async function updateNameAction(input: unknown): Promise<AccountActionResult> {
  const session = await getSession();
  if (!session) return fail(SIGN_IN_AGAIN);
  const parsed = nameSchema.safeParse(input);
  const name = parsed.success ? parsed.data.name.trim() : '';
  const issue = nameIssue(name);
  if (issue) return fail(issue, { field: 'name' });
  if (!(await enforceRateLimit(db, { key: `portal:account:name:${session.user.id}`, windowSeconds: 600, max: 10 }))) {
    return fail(TOO_MANY_TRIES);
  }
  try {
    await auth.api.updateUser({ body: { name }, headers: await headers() });
  } catch (error: unknown) {
    console.error('[portal] updateNameAction failed', error instanceof APIError ? error.message : error);
    return fail('We could not save your name. Try again.');
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

const passwordSchema = z.object({ password: z.string().max(200) });

/**
 * Sets the first password of an account that has none. The same password rules as signup.
 *
 * Only in a session that is at most 15 minutes old. A person who just signed in with an emailed
 * code has such a session. An old session, such as one left open on a shared computer, can not
 * give the account a password: it is asked to sign in again first. An account that already has a
 * password changes it with "Forgot password", which asks for a code from the mailbox.
 */
export async function setPasswordAction(input: unknown): Promise<AccountActionResult> {
  const session = await getSession();
  if (!session) return fail(SIGN_IN_AGAIN);
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return fail('Enter a password.', { field: 'password' });
  const password = parsed.data.password;

  const facts = await getAccountFacts(session.user.id);
  if (!facts) return fail(SIGN_IN_AGAIN);
  if (facts.hasPassword) return fail('This account already has a password. Use "Forgot password" to change it.', { code: 'has_password' });

  const issue = passwordIssue(password, { email: facts.email });
  if (issue) return fail(issue, { field: 'password' });
  // The shared rules, checked on the server too: this endpoint has no address, so the shared
  // password policy hooks do not see it.
  const issues = validatePassword(password, DEFAULT_PASSWORD_POLICY, { email: facts.email, name: facts.name });
  if (issues.length > 0) return fail(issues.join(' '), { field: 'password' });

  if (!isFreshSession(session.session.createdAt)) return fail(NEEDS_FRESH_SIGN_IN, { code: 'sign_in_again' });
  if (!(await enforceRateLimit(db, { key: `portal:account:set-password:${session.user.id}`, windowSeconds: 600, max: 5 }))) {
    return fail(TOO_MANY_TRIES);
  }

  try {
    await auth.api.setPassword({ body: { newPassword: password }, headers: await headers() });
  } catch (error: unknown) {
    const code = error instanceof APIError ? ((error.body as { code?: unknown } | undefined)?.code ?? null) : null;
    if (code === 'PASSWORD_ALREADY_SET') return fail('This account already has a password. Use "Forgot password" to change it.', { code: 'has_password' });
    console.error('[portal] setPasswordAction failed', error instanceof APIError ? error.message : error);
    return fail('We could not save your password. Try again.');
  }
  revalidatePath('/settings/account');
  return { ok: true };
}
