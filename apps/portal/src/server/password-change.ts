/**
 * Forced password change (portal side). The rule itself lives in @kitstak/db so the CRM
 * guard reads exactly the same thing.
 */
import 'server-only';
import { cache } from 'react';
import { isPasswordChangeRequired } from '@kitstak/db/password-change';
import { getDb } from '@/server/db';

/** True while the user still has the administrator-set password. Memoized per render. */
export const mustChangePassword = cache(
  async (userId: string): Promise<boolean> => isPasswordChangeRequired(getDb(), userId),
);
