/**
 * Forced password change: the one read every app guard uses.
 *
 * A user must change their password while a `core.password_change_required` row exists
 * AND their credential still carries the hash recorded on it. Comparing hashes (rather
 * than trusting the row alone) means the requirement lifts itself the moment the password
 * is changed by any route, with no second write to get wrong.
 */
import { and, eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { account } from './schema/core/auth';
import { passwordChangeRequired } from './schema/core/password-change';

/** Better Auth's provider id for email + password credentials. */
const CREDENTIAL_PROVIDER = 'credential';

/** `select` from any Drizzle Postgres database (node-postgres or postgres-js). */
export type PasswordChangeDb = Pick<PgDatabase<PgQueryResultHKT, Record<string, unknown>>, 'select'>;

export async function isPasswordChangeRequired(db: PasswordChangeDb, userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: passwordChangeRequired.userId })
    .from(passwordChangeRequired)
    .innerJoin(
      account,
      and(
        eq(account.userId, passwordChangeRequired.userId),
        eq(account.providerId, CREDENTIAL_PROVIDER),
        eq(account.password, passwordChangeRequired.credentialHash),
      ),
    )
    .where(eq(passwordChangeRequired.userId, userId))
    .limit(1);
  return rows.length > 0;
}
