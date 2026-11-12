/**
 * Wave Log "Run By" identity (critic R4): stored as a display name, never a raw email.
 * Scheduler runs are "Integration" (Logiwa); a user run stores the user's name (email only
 * when the user has no name). An email passed by an older caller is resolved to the name.
 */
import { eq, sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import * as schema from '@/server/db/schema';
import type { Tx } from '@/server/domain/types';

export const INTEGRATION_RUN_BY = 'Integration';

export async function runByDisplay(db: AppDb | Tx, runBy: string | null | undefined): Promise<string> {
  const value = (runBy ?? '').trim();
  if (!value) return INTEGRATION_RUN_BY;
  if (!value.includes('@')) return value;
  const user = (
    await db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(sql`lower(${schema.users.email})`, value.toLowerCase()))
      .limit(1)
  )[0];
  return user?.name?.trim() || value;
}
