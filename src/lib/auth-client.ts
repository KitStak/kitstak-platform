'use client';
/**
 * Browser auth client. Use the hooks/actions exported here from client components:
 *   const { data: session, isPending } = useSession();
 *   await signIn.email({ email, password });
 *   await organization.setActive({ organizationId });
 */
import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, organizationClient } from 'better-auth/client/plugins';
import { orgAccessControl, orgRoles } from '@/server/auth/access-control';

export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [
    organizationClient({ ac: orgAccessControl, roles: orgRoles, teams: { enabled: true } }),
    inferAdditionalFields({
      user: {
        title: { type: 'string', required: false },
        timezone: { type: 'string', required: false },
      },
    }),
  ],
});

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
