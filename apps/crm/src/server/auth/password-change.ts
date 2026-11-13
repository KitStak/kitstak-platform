/**
 * Forced password change (CRM side). The rule lives in @kitstak/db and the screen lives in
 * the portal, so the CRM only decides whether to send the user there.
 */
import 'server-only';
import { isPasswordChangeRequired } from '@kitstak/db/password-change';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { portalChangePasswordUrl } from './password-change-url';

const DEFAULT_PORTAL_URL = 'http://localhost:3300';

/** True while the user still has an administrator-set password. */
export function mustChangePassword(userId: string): Promise<boolean> {
  return isPasswordChangeRequired(db, userId);
}

/**
 * The URL to redirect to when the user still has an administrator-set password, else null.
 * The portal validates the return address against its own list of sibling apps.
 */
export async function passwordChangeRedirect(userId: string, orgSlug: string): Promise<string | null> {
  if (!(await mustChangePassword(userId))) return null;
  const configured = process.env.NEXT_PUBLIC_PORTAL_URL?.trim();
  // 9: never send a production user to a localhost default; fail loudly instead.
  if (!configured && env.NODE_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_PORTAL_URL must be set: it hosts the change-password screen.');
  }
  const portalUrl = configured || DEFAULT_PORTAL_URL;
  const crmUrl = env.NEXT_PUBLIC_APP_URL ?? env.BETTER_AUTH_URL;
  return portalChangePasswordUrl(portalUrl, crmUrl, orgSlug);
}
