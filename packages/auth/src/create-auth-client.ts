'use client';
/**
 * Browser auth client factory (blueprint §1.1 `create-auth-client.ts`; extracted from
 * `apps/crm/src/lib/auth-client.ts`). Each app creates its client once:
 *   export const authClient = createKitstakAuthClient();
 *   const { data: session, isPending } = authClient.useSession();
 *   await authClient.signIn.email({ email, password });
 *   await authClient.organization.setActive({ organizationId });
 */
import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, organizationClient } from 'better-auth/client/plugins';
import { orgAccessControl, orgRoles } from './access-control';

export interface CreateKitstakAuthClientOptions {
  /** Another origin's auth endpoint; omit for same-origin (`/api/auth`). */
  readonly baseURL?: string;
}

export function createKitstakAuthClient(options: CreateKitstakAuthClientOptions = {}) {
  return createAuthClient({
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
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
}

export type KitstakAuthClient = ReturnType<typeof createKitstakAuthClient>;
