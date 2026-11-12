import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkRequestOrigin, isMutatingMethod } from './origin';
import { buildContentSecurityPolicy, createNonce } from './csp';
import { clientIp, readJsonBody, searchParamsToObject, validate } from './request';
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  MethodNotAllowedError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitedError,
  toAppError,
  UnsupportedMediaTypeError,
  ValidationError,
} from './errors';

const URL_ = 'http://localhost:3100/api/v1/boards';
const TRUSTED = ['http://localhost:3100'];
const h = (init: Record<string, string>) => new Headers(init);

describe('checkRequestOrigin', () => {
  it('ignores safe methods', () => {
    expect(checkRequestOrigin('GET', h({ origin: 'https://evil.test' }), URL_, TRUSTED).ok).toBe(true);
    expect(isMutatingMethod('options')).toBe(false);
  });

  it('accepts trusted and same origins', () => {
    expect(checkRequestOrigin('POST', h({ origin: 'http://localhost:3100' }), URL_, TRUSTED).ok).toBe(true);
    expect(checkRequestOrigin('PATCH', h({ origin: 'http://localhost:3100' }), URL_, []).ok).toBe(true);
  });

  it('rejects foreign and opaque origins', () => {
    expect(checkRequestOrigin('POST', h({ origin: 'https://evil.test' }), URL_, TRUSTED).ok).toBe(false);
    expect(checkRequestOrigin('DELETE', h({ origin: 'null' }), URL_, TRUSTED).ok).toBe(false);
  });

  it('uses Sec-Fetch-Site when Origin is absent', () => {
    expect(checkRequestOrigin('POST', h({ 'sec-fetch-site': 'cross-site' }), URL_, TRUSTED).ok).toBe(false);
    expect(checkRequestOrigin('POST', h({ 'sec-fetch-site': 'same-origin' }), URL_, TRUSTED).ok).toBe(true);
    expect(checkRequestOrigin('POST', h({}), URL_, TRUSTED).ok).toBe(true);
  });

  it('rejects malformed request URLs', () => {
    expect(checkRequestOrigin('POST', h({}), 'not a url', TRUSTED).ok).toBe(false);
  });
});

describe('CSP', () => {
  it('creates unique base64 nonces', () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
    expect(createNonce()).not.toBe(a);
  });

  it('locks scripts to the nonce in production', () => {
    const csp = buildContentSecurityPolicy('abc', false);
    expect(csp).toContain(`script-src 'self' 'nonce-abc' 'strict-dynamic'`);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain(`frame-ancestors 'none'`);
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('allows eval and websockets only in development', () => {
    const csp = buildContentSecurityPolicy('abc', true);
    expect(csp).toContain('unsafe-eval');
    expect(csp).toContain('ws:');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});

const post = (body: string, type = 'application/json') =>
  new Request('http://localhost/x', { method: 'POST', body, headers: { 'content-type': type } });

describe('readJsonBody', () => {
  it('parses JSON and returns undefined for empty bodies', async () => {
    await expect(readJsonBody(post('{"a":1}'))).resolves.toEqual({ a: 1 });
    await expect(readJsonBody(post(''))).resolves.toBeUndefined();
  });

  it('rejects wrong content types, bad JSON and oversized bodies', async () => {
    await expect(readJsonBody(post('{}', 'text/plain'))).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
    await expect(readJsonBody(post('{nope'))).rejects.toBeInstanceOf(BadRequestError);
    await expect(readJsonBody(post(JSON.stringify({ a: 'x'.repeat(50) })), 10)).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
  });
});

describe('validate & helpers', () => {
  it('returns parsed output or throws ValidationError with prefixed paths', () => {
    const schema = z.object({ n: z.coerce.number().int() });
    expect(validate(schema, { n: '4' }, 'query')).toEqual({ n: 4 });
    let caught: unknown;
    try {
      validate(schema, { n: 'x' }, 'query');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const details = (caught as ValidationError).details as { issues: Array<{ path: string }> };
    expect(details.issues[0]?.path).toBe('query.n');
  });

  it('collects repeated search params into arrays', () => {
    expect(searchParamsToObject(new URLSearchParams('a=1&b=2&b=3'))).toEqual({ a: '1', b: ['2', '3'] });
  });

  it('resolves the client from the right-most trusted hop', () => {
    // One trusted proxy appended 10.0.0.1: the spoofed leftmost value is ignored.
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), 1)).toBe('10.0.0.1');
    // Two trusted proxies: the client is the entry left of both.
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.5, 198.51.100.7, 10.0.0.1' }), 2)).toBe(
      '198.51.100.7',
    );
    // A chain shorter than the declared hops falls back to the leftmost (set by our own proxy).
    expect(clientIp(new Headers({ 'x-forwarded-for': '9.9.9.9' }), 3)).toBe('9.9.9.9');
    // x-real-ip is client-controlled and never trusted; hops = 0 ignores forwarding headers.
    expect(clientIp(new Headers({ 'x-real-ip': '5.6.7.8' }), 1)).toBeNull();
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4' }), 0)).toBeNull();
    expect(clientIp(new Headers(), 1)).toBeNull();
  });
});

describe('errors', () => {
  it('maps codes to statuses and bodies', () => {
    expect(new NotFoundError('Board').toBody()).toEqual({ code: 'NOT_FOUND', message: 'Board not found' });
    expect(new ForbiddenError().status).toBe(403);
    expect(new ValidationError([{ path: 'name', message: 'Required' }]).toBody().details).toEqual({
      issues: [{ path: 'name', message: 'Required' }],
    });
  });

  it('carries response headers', () => {
    expect(new RateLimitedError(2.2).headers['Retry-After']).toBe('3');
    expect(new MethodNotAllowedError(['GET', 'POST']).headers.Allow).toBe('GET, POST');
  });

  it('passes AppErrors through and maps postgres errors (incl. wrapped causes)', () => {
    const conflict = new ConflictError();
    expect(toAppError(conflict)).toBe(conflict);
    expect(toAppError({ code: '23505' }).code).toBe('CONFLICT');
    expect(toAppError(new Error('wrapped', { cause: { code: '23503' } })).code).toBe('BAD_REQUEST');
    expect(toAppError({ code: '22P02' }).code).toBe('BAD_REQUEST');
    expect(toAppError({ code: '23514' }).code).toBe('BAD_REQUEST');
  });

  it('hides unknown errors behind a generic 500', () => {
    const mapped = toAppError(new Error('secret connection string leaked'));
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.status).toBe(500);
    expect(mapped.message).not.toContain('secret');
  });
});
