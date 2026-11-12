import { describe, expect, it } from 'vitest';
import { isSafeMethod, isSameOriginRequest, verifyOrigin } from '@/server/auth/origin';

const ORIGIN = 'http://localhost:3000';

interface ReqOptions {
  readonly origin?: string;
  readonly site?: string;
}

function req(method: string, opts: ReqOptions = {}): Request {
  const headers = new Headers({ host: 'localhost:3000' });
  if (opts.origin !== undefined) headers.set('origin', opts.origin);
  if (opts.site !== undefined) headers.set('sec-fetch-site', opts.site);
  return new Request(`${ORIGIN}/api/x`, { method, headers });
}

describe('verifyOrigin (mutation same-origin guard — the CSRF token is retired, §1.4)', () => {
  it('lets safe methods through', () => {
    expect(verifyOrigin(req('GET', { origin: 'https://evil.example' }))).toEqual({ ok: true });
    expect(verifyOrigin(req('HEAD'))).toEqual({ ok: true });
    expect(isSafeMethod('options')).toBe(true);
    expect(isSafeMethod('POST')).toBe(false);
  });

  it('accepts same-origin and headerless (non-browser) mutations', () => {
    expect(verifyOrigin(req('POST', { origin: ORIGIN }))).toEqual({ ok: true });
    expect(verifyOrigin(req('DELETE'))).toEqual({ ok: true });
  });

  it('rejects cross-origin, null-origin and cross-site mutations', () => {
    expect(verifyOrigin(req('POST', { origin: 'https://evil.example' }))).toEqual({
      ok: false,
      reason: 'cross_origin',
    });
    expect(verifyOrigin(req('POST', { origin: 'null' }))).toEqual({ ok: false, reason: 'cross_origin' });
    expect(verifyOrigin(req('PATCH', { origin: ORIGIN, site: 'cross-site' }))).toEqual({
      ok: false,
      reason: 'cross_origin',
    });
  });

  it('same-origin check details', () => {
    expect(isSameOriginRequest(req('POST', { origin: ORIGIN }))).toBe(true);
    expect(isSameOriginRequest(req('POST'))).toBe(true);
    expect(isSameOriginRequest(req('POST', { origin: 'null' }))).toBe(false);
    expect(isSameOriginRequest(req('POST', { origin: 'http://localhost:4000' }))).toBe(false);
  });
});
