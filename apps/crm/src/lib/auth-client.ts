'use client';
/**
 * Browser auth client, created by the shared `@kitstak/auth` factory (blueprint §1.3).
 * Use the hooks/actions exported here from client components:
 *   const { data: session, isPending } = useSession();
 *   await signIn.email({ email, password });
 *   await organization.setActive({ organizationId });
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
