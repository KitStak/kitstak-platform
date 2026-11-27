/**
 * Which "Continue with ..." buttons exist (docs/billing/SPEC.md section 5.1). PURE.
 * A button is shown only when both its id and its secret are set. With no keys, no button is
 * rendered at all, so there is never a dead button.
 */

export type SocialProviderId = 'google' | 'microsoft';

export interface SocialEnv {
  readonly GOOGLE_CLIENT_ID?: string | undefined;
  readonly GOOGLE_CLIENT_SECRET?: string | undefined;
  readonly MICROSOFT_CLIENT_ID?: string | undefined;
  readonly MICROSOFT_CLIENT_SECRET?: string | undefined;
  readonly MICROSOFT_TENANT_ID?: string | undefined;
}

export interface SocialProviderConfig {
  readonly google?: { readonly clientId: string; readonly clientSecret: string };
  readonly microsoft?: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly tenantId: string;
    /** Decides whether Microsoft proved the email. See `microsoftEmailVerified`. */
    readonly mapProfileToUser: (profile: Record<string, unknown>) => { emailVerified: boolean };
  };
}

/**
 * Did Microsoft prove that this person owns the email in the token? Only the `xms_edov` claim says
 * so ("email domain owner verified"). The tenant admin cannot set it; Microsoft sets it when the
 * domain of the address is verified in that tenant.
 *
 * Everything else is treated as not proven, also an `email_verified` claim: with the multi tenant
 * `common` endpoint anyone can make a tenant and put a customer's address in a user's `email`. A
 * sign in that is not proven never joins an existing account (Microsoft is not a trusted provider in
 * `@kitstak/auth`); the person is told to sign in with their password. A brand new account made
 * this way starts unverified and gets the 6 digit code like any other.
 *
 * The app registration must ask for the optional claim `xms_edov` (docs/billing/GO-LIVE.md).
 */
export function microsoftEmailVerified(profile: Record<string, unknown> | null | undefined): boolean {
  if (!profile || typeof profile.email !== 'string' || profile.email.trim() === '') return false;
  const proven = profile.xms_edov;
  return proven === true || proven === 'true' || proven === 1 || proven === '1';
}

function set(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** The Better Auth `socialProviders` option, or undefined when no provider is fully set. */
export function socialProviderConfig(env: SocialEnv): SocialProviderConfig | undefined {
  const config: {
    google?: SocialProviderConfig['google'];
    microsoft?: SocialProviderConfig['microsoft'];
  } = {};
  if (set(env.GOOGLE_CLIENT_ID) && set(env.GOOGLE_CLIENT_SECRET)) {
    config.google = { clientId: env.GOOGLE_CLIENT_ID.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET.trim() };
  }
  if (set(env.MICROSOFT_CLIENT_ID) && set(env.MICROSOFT_CLIENT_SECRET)) {
    config.microsoft = {
      clientId: env.MICROSOFT_CLIENT_ID.trim(),
      clientSecret: env.MICROSOFT_CLIENT_SECRET.trim(),
      tenantId: set(env.MICROSOFT_TENANT_ID) ? env.MICROSOFT_TENANT_ID.trim() : 'common',
      // Overrides the provider's own guess. Without this an unproven address could join an account.
      mapProfileToUser: (profile) => ({ emailVerified: microsoftEmailVerified(profile) }),
    };
  }
  return config.google || config.microsoft ? config : undefined;
}

/** The buttons to render, in order. */
export function enabledSocialProviders(env: SocialEnv): readonly SocialProviderId[] {
  const config = socialProviderConfig(env);
  const list: SocialProviderId[] = [];
  if (config?.google) list.push('google');
  if (config?.microsoft) list.push('microsoft');
  return list;
}

export const SOCIAL_LABELS: Readonly<Record<SocialProviderId, string>> = {
  google: 'Continue with Google',
  microsoft: 'Continue with Microsoft',
};
