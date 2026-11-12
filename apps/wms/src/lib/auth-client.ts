'use client';
/**
 * Browser auth client, created by the shared `@kitstak/auth` factory (blueprint §1.4).
 * Use from client components:
 *   await authClient.signIn.email({ email, password });
 *   await authClient.signOut();
 *   await authClient.revokeOtherSessions();
 */
import { createKitstakAuthClient } from '@kitstak/auth/client';

export const authClient = createKitstakAuthClient();

export const { signIn, signOut, useSession, getSession } = authClient;
