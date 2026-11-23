import { describe, expect, test } from 'vitest';
import { SOCIAL_LABELS, enabledSocialProviders, socialProviderConfig } from './social';

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
    expect(socialProviderConfig(env)?.microsoft).toEqual({ clientId: 'mid', clientSecret: 'msecret', tenantId: 'common' });
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

  test('button words', () => {
    expect(SOCIAL_LABELS).toEqual({ google: 'Continue with Google', microsoft: 'Continue with Microsoft' });
  });
});
