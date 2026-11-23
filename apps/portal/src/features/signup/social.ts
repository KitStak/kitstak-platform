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
  readonly microsoft?: { readonly clientId: string; readonly clientSecret: string; readonly tenantId: string };
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
