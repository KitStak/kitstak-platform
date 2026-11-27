/**
 * What the "My account" page shows about the signed in person (review round 4): their name, their
 * email, whether it is confirmed, and the ways they can sign in. Server only.
 */
import 'server-only';
import { eq } from 'drizzle-orm';
import { account, user } from '@kitstak/db/schema';
import { db } from '@/server/db';

export interface AccountFacts {
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  /** The person has a password of their own. false for "Email me a code instead" accounts. */
  readonly hasPassword: boolean;
  /** 'google', 'microsoft': the other ways this account signs in. */
  readonly providers: readonly string[];
}

/** Read fresh from the database on every call. null when the account is gone. */
export async function getAccountFacts(userId: string): Promise<AccountFacts | null> {
  const [person] = await db
    .select({ name: user.name, email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId));
  if (!person) return null;
  const logins = await db
    .select({ providerId: account.providerId, password: account.password })
    .from(account)
    .where(eq(account.userId, userId));
  return {
    name: person.name,
    email: person.email,
    emailVerified: person.emailVerified === true,
    hasPassword: logins.some((login) => login.providerId === 'credential' && typeof login.password === 'string' && login.password !== ''),
    providers: logins.filter((login) => login.providerId !== 'credential').map((login) => login.providerId),
  };
}

/**
 * How long after signing in a person may set their first password without signing in again. The
 * same 15 minutes the shared sign in layer calls a fresh session.
 */
export const FRESH_SESSION_MINUTES = 15;

/** True when the session was made in the last `FRESH_SESSION_MINUTES`. */
export function isFreshSession(createdAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!createdAt) return false;
  const made = createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt);
  if (Number.isNaN(made)) return false;
  return now.getTime() - made <= FRESH_SESSION_MINUTES * 60_000;
}
