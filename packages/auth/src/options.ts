/**
 * Database-agnostic Better Auth options shared by every KitStak app's runtime instance
 * (via `createAuth` in `./create-auth.ts`) and the schema generator config. Keeping these
 * in one place guarantees the generated Drizzle schema matches runtime behaviour.
 *
 * Extracted from `apps/crm/src/server/auth/options.ts` (blueprint §1.1).
 */
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { orgAccessControl, orgRoles } from './access-control';

export const SESSION_COOKIE_PREFIX = 'kitstak';
/** Name of the session cookie (with `__Secure-` prefix when secure cookies are on). */
export const SESSION_COOKIE_NAMES = [
  `${SESSION_COOKIE_PREFIX}.session_token`,
  `__Secure-${SESSION_COOKIE_PREFIX}.session_token`,
] as const;

export const PASSWORD_MIN_LENGTH = 10;
/**
 * 72, not 128: migrated WMS credentials are bcrypt hashes, and bcrypt silently ignores
 * every byte after the 72nd — a longer password would authenticate with any suffix
 * (auth review 2026-11-11, L3). The cap is enforced in the shared options so NO instance
 * (CRM included) can set a password the compat verifier would later truncate. Better
 * Auth's `maxPasswordLength` counts characters; the password-policy plugin additionally
 * enforces the 72-BYTE rule for multi-byte passwords on every password-setting path.
 */
export const PASSWORD_MAX_LENGTH = 72;

/**
 * The parts of the organization plugin an app may add to (docs/billing/CONTRACTS.md section 15.1):
 * the invite email sender and the organization hooks. Billing passes its seat checks, invite email
 * and delete guard through here (`billingOrganizationOptions` in `@kitstak/billing/server`).
 * Everything else about the plugin is shared and fixed.
 */
export type OrganizationPluginExtras = Pick<
  Parameters<typeof organization>[0] & object,
  'sendInvitationEmail' | 'organizationHooks'
> & {
  /**
   * Request guards that belong to the organization rules (billing review round 3). The organization
   * hooks are not told who is acting when a role is changed or a member is removed, so a rule about
   * the acting person ("only an owner can add or remove a billing manager") is a small plugin that
   * runs before the organization endpoints. `createAuth` mounts these on every instance, right
   * after the organization plugin, so the rule holds at every door without any app opting in.
   */
  readonly guardPlugins?: readonly BetterAuthPlugin[];
};

export const organizationPlugin = (extras?: OrganizationPluginExtras) =>
  organization({
    ac: orgAccessControl,
    roles: orgRoles,
    creatorRole: 'owner',
    allowUserToCreateOrganization: true,
    membershipLimit: 1000,
    invitationExpiresIn: 60 * 60 * 24 * 7,
    cancelPendingInvitationsOnReInvite: true,
    teams: { enabled: true, defaultTeam: { enabled: false } },
    ...(extras?.sendInvitationEmail ? { sendInvitationEmail: extras.sendInvitationEmail } : {}),
    ...(extras?.organizationHooks ? { organizationHooks: extras.organizationHooks } : {}),
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
    /**
     * No cookie cache (billing review round 4). With the cache on, a signed copy of the session
     * in the browser was believed for 5 minutes without a look at the database. So after a
     * password reset, which deletes every session row, the old browser could still open Billing,
     * download the activity file and cancel the plan for up to 5 minutes. A person resets their
     * password exactly when they think someone else is in their account.
     *
     * Off, every request reads the session row (one primary key lookup on `core.session`). A
     * session that was ended is refused on the very next request, in every app.
     */
    cookieCache: { enabled: false },
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
