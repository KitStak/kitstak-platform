'use client';
/**
 * Browser auth client, created by the shared `@kitstak/auth` factory (blueprint §1.3).
 */
import { createKitstakAuthClient } from '@kitstak/auth/client';

export const authClient = createKitstakAuthClient();

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  organization,
  useActiveOrganization,
  useListOrganizations,
} = authClient;
