import { describe, expect, it } from 'vitest';
import { authorizeTick } from './auth';

describe('who may call the billing tick (CONTRACTS section 14)', () => {
  it('with a secret set, only the right bearer token gets in', () => {
    const cronSecret = 'a-long-random-secret-value';
    expect(authorizeTick({ cronSecret, nodeEnv: 'production', authorization: `Bearer ${cronSecret}` })).toEqual({ ok: true });
    expect(authorizeTick({ cronSecret, nodeEnv: 'development', authorization: `bearer ${cronSecret}` })).toEqual({ ok: true });
    for (const authorization of [null, '', 'Bearer', 'Bearer wrong', `Basic ${cronSecret}`, cronSecret, `Bearer ${cronSecret}x`, `Bearer ${cronSecret.slice(0, -1)}`]) {
      expect(authorizeTick({ cronSecret, nodeEnv: 'production', authorization })).toEqual({ ok: false, status: 401, message: 'Not allowed.' });
      expect(authorizeTick({ cronSecret, nodeEnv: 'development', authorization })).toMatchObject({ ok: false, status: 401 });
    }
  });

  it('with no secret, local dev may call it and production answers 503', () => {
    expect(authorizeTick({ cronSecret: undefined, nodeEnv: 'development', authorization: null })).toEqual({ ok: true });
    expect(authorizeTick({ cronSecret: '   ', nodeEnv: 'test', authorization: null })).toEqual({ ok: true });
    for (const authorization of [null, 'Bearer anything', 'Bearer ']) {
      expect(authorizeTick({ cronSecret: undefined, nodeEnv: 'production', authorization })).toEqual({
        ok: false,
        status: 503,
        message: 'The billing job is not set up. Set CRON_SECRET.',
      });
    }
  });
});
