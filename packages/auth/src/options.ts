/**
 * Database-agnostic Better Auth options shared by every KitStak app's runtime instance
 * (via `createAuth` in `./create-auth.ts`) and the schema generator config. Keeping these
 * in one place guarantees the generated Drizzle schema matches runtime behaviour.
 *
 * Extracted from `apps/crm/src/server/auth/options.ts` (blueprint §1.1).
 */
import type { BetterAuthOptions } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { orgAccessControl, orgRoles } from './access-control';

export const SESSION_COOKIE_PREFIX = 'kitstak';
/** Name of the session cookie (with `__Secure-` prefix when secure cookies are on). */
export const SESSION_COOKIE_NAMES = [
  `${SESSION_COOKIE_PREFIX}.session_token`,
  `__Secure-${SESSION_COOKIE_PREFIX}.session_token`,
] as const;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const organizationPlugin = () =>
  organization({
    ac: orgAccessControl,
    roles: orgRoles,
    creatorRole: 'owner',
    allowUserToCreateOrganization: true,
    membershipLimit: 1000,
    invitationExpiresIn: 60 * 60 * 24 * 7,
    cancelPendingInvitationsOnReInvite: true,
    teams: { enabled: true, defaultTeam: { enabled: false } },
  });

export const sharedAuthOptions = {
  appName: 'KitStak',
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 15,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  user: {
    additionalFields: {
      title: { type: 'string', required: false, input: true },
      timezone: { type: 'string', required: false, input: true },
    },
  },
  advanced: {
    cookiePrefix: SESSION_COOKIE_PREFIX,
    database: { generateId: 'uuid' },
    defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
  },
  plugins: [organizationPlugin()],
} satisfies Partial<BetterAuthOptions>;
