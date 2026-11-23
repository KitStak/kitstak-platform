import { describe, expect, test } from 'vitest';
import { TRUSTED_LINK_PROVIDERS } from '@kitstak/auth/create-auth';
import { microsoft } from 'better-auth/social-providers';
import { SOCIAL_LABELS, enabledSocialProviders, microsoftEmailVerified, socialProviderConfig } from './social';

/** An id token as the provider reads it. The signature is checked elsewhere; `getUserInfo` only decodes. */
function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(claims)}.`;
}

describe('social sign in providers (SPEC 5.1, must have 21)', () => {
  test('with no keys there is no provider and no button', () => {
    expect(socialProviderConfig({})).toBeUndefined();
    expect(enabledSocialProviders({})).toEqual([]);
  });

  test('a provider needs both its id and its secret', () => {
    expect(enabledSocialProviders({ GOOGLE_CLIENT_ID: 'id' })).toEqual([]);
    expect(enabledSocialProviders({ GOOGLE_CLIENT_SECRET: 'secret' })).toEqual([]);
    expect(enabledSocialProviders({ MICROSOFT_CLIENT_ID: 'id', MICROSOFT_TENANT_ID: 'tenant' })).toEqual([]);
    expect(enabledSocialProviders({ GOOGLE_CLIENT_ID: '  ', GOOGLE_CLIENT_SECRET: 'secret' })).toEqual([]);
  });

  test('Google alone', () => {
    const env = { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' };
    expect(enabledSocialProviders(env)).toEqual(['google']);
    expect(socialProviderConfig(env)).toEqual({ google: { clientId: 'gid', clientSecret: 'gsecret' } });
  });

  test('Microsoft alone, tenant defaults to common', () => {
    const env = { MICROSOFT_CLIENT_ID: 'mid', MICROSOFT_CLIENT_SECRET: 'msecret' };
    expect(enabledSocialProviders(env)).toEqual(['microsoft']);
    expect(socialProviderConfig(env)?.microsoft).toMatchObject({ clientId: 'mid', clientSecret: 'msecret', tenantId: 'common' });
    expect(socialProviderConfig({ ...env, MICROSOFT_TENANT_ID: 'contoso' })?.microsoft?.tenantId).toBe('contoso');
  });

  test('both, Google first', () => {
    expect(
      enabledSocialProviders({
        GOOGLE_CLIENT_ID: 'gid',
        GOOGLE_CLIENT_SECRET: 'gsecret',
        MICROSOFT_CLIENT_ID: 'mid',
        MICROSOFT_CLIENT_SECRET: 'msecret',
      }),
    ).toEqual(['google', 'microsoft']);
  });

  test('Microsoft proves an email only with the xms_edov claim', () => {
    expect(microsoftEmailVerified({ email: 'maya@northwind.example', xms_edov: true })).toBe(true);
    expect(microsoftEmailVerified({ email: 'maya@northwind.example', xms_edov: 'true' })).toBe(true);
    expect(microsoftEmailVerified({ email: 'maya@northwind.example' })).toBe(false);
    expect(microsoftEmailVerified({ email: 'maya@northwind.example', xms_edov: false })).toBe(false);
    // A tenant admin can set these. They prove nothing.
    expect(microsoftEmailVerified({ email: 'maya@northwind.example', email_verified: true })).toBe(false);
    expect(microsoftEmailVerified({ email: 'maya@northwind.example', verified_primary_email: ['maya@northwind.example'] })).toBe(false);
    expect(microsoftEmailVerified({ xms_edov: true })).toBe(false);
    expect(microsoftEmailVerified(null)).toBe(false);
  });

  test('a Microsoft profile without a verified email does not link to an existing account', async () => {
    // Better Auth links an OAuth sign in to an existing account only when the provider is in the
    // trusted list OR its profile says the email is verified (oauth2/link-account.mjs). So two facts
    // must hold: Microsoft is not trusted, and a forged token comes out as not verified.
    expect(TRUSTED_LINK_PROVIDERS as readonly string[]).not.toContain('microsoft');
    expect(TRUSTED_LINK_PROVIDERS as readonly string[]).toEqual(['google']);

    const config = socialProviderConfig({ MICROSOFT_CLIENT_ID: 'mid', MICROSOFT_CLIENT_SECRET: 'msecret' })?.microsoft;
    expect(config).toBeDefined();
    const provider = microsoft({ ...config!, disableProfilePhoto: true });

    // The attacker's own tenant: the victim's address in `email`, and every claim an admin can add.
    const forged = await provider.getUserInfo({
      idToken: idToken({
        oid: '11111111-2222-3333-4444-555555555555',
        tid: 'attacker-tenant',
        name: 'Not Maya',
        email: 'maya@northwind.example',
        email_verified: true,
        verified_primary_email: ['maya@northwind.example'],
      }),
    });
    expect(forged?.user.email).toBe('maya@northwind.example');
    expect(forged?.user.emailVerified).toBe(false);

    // A tenant that owns the domain: Microsoft itself adds xms_edov.
    const proven = await provider.getUserInfo({
      idToken: idToken({ oid: '99999999-2222-3333-4444-555555555555', name: 'Maya', email: 'maya@northwind.example', xms_edov: true }),
    });
    expect(proven?.user.emailVerified).toBe(true);
  });

  test('button words', () => {
    expect(SOCIAL_LABELS).toEqual({ google: 'Continue with Google', microsoft: 'Continue with Microsoft' });
  });
});
