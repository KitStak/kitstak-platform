'use client';
import { authClient } from '@/lib/auth-client';

/** Re-read the session from the database so the shell (name, avatar) reflects a profile change. */
export async function refreshSessionCache(): Promise<void> {
  try {
    await authClient.getSession({ query: { disableCookieCache: true } });
  } catch {
    /* non-fatal: the cookie cache expires on its own within minutes */
  }
}
