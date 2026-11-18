import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from '@/proxy';
import { API_CONTENT_SECURITY_POLICY, buildContentSecurityPolicy, createNonce, NONCE_HEADER } from './csp';

const directives = (policy: string): Map<string, string[]> =>
  new Map(
    policy.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name!, values] as const;
    }),
  );

describe('Content-Security-Policy builder', () => {
  it('locks production down: nonce scripts, no eval, no frames, own origin only', () => {
    const policy = directives(buildContentSecurityPolicy('abc123', false));
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('script-src')).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('connect-src')).toEqual(["'self'"]);
    expect(policy.get('img-src')).toEqual(["'self'", 'blob:', 'data:', 'https:']);
    expect(policy.get('font-src')).toEqual(["'self'", 'data:']);
    expect(policy.has('upgrade-insecure-requests')).toBe(true);
    const text = buildContentSecurityPolicy('abc123', false);
    expect(text).not.toContain('unsafe-eval');
    expect(text).not.toMatch(/\bws:|\bwss:/);
    // Inline scripts are never allowed by a blanket rule, only by the nonce.
    expect(policy.get('script-src')).not.toContain("'unsafe-inline'");
  });

  it('adds eval and websockets for next dev only', () => {
    const policy = directives(buildContentSecurityPolicy('abc123', true));
    expect(policy.get('script-src')).toContain("'unsafe-eval'");
    expect(policy.get('connect-src')).toEqual(["'self'", 'ws:', 'wss:']);
    expect(policy.has('upgrade-insecure-requests')).toBe(false);
  });

  it('makes a new nonce every time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => createNonce()));
    expect(seen.size).toBe(200);
    for (const nonce of seen) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe('proxy sends the header on every page', () => {
  afterEach(() => vi.unstubAllEnvs());

  const PAGES = ['/login', '/', '/jobs', '/jobs/J-1026', '/jobs/J-1026/work', '/jobs/J.10.26', '/log', '/profit', '/reports/job-profit', '/alerts', '/alerts/rules', '/labor', '/settings/close', '/welcome', '/kiosk/t/some-device-secret', '/wall', '/no-such-page'];

  it.each(PAGES)('%s carries the policy with a fresh nonce, and hands the same nonce to the page', (path) => {
    const response = proxy(new NextRequest(`http://localhost:3500${path}`));
    const policy = response.headers.get('content-security-policy') ?? '';
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    expect(nonce, path).toBeTruthy();
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    // Next reads the policy and the nonce from the request it renders (forwarded request headers).
    expect(response.headers.get(`x-middleware-request-${NONCE_HEADER}`)).toBe(nonce);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    const again = proxy(new NextRequest(`http://localhost:3500${path}`)).headers.get('content-security-policy') ?? '';
    expect(/'nonce-([^']+)'/.exec(again)?.[1]).not.toBe(nonce);
  });

  it('has no eval and no websockets in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const policy = proxy(new NextRequest('https://pulse.kitstak.app/jobs')).headers.get('content-security-policy') ?? '';
    expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic';/);
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toMatch(/\bws:|\bwss:/);
    expect(policy).toContain('upgrade-insecure-requests');
  });

  it('never trusts a nonce sent by the caller', () => {
    const response = proxy(new NextRequest('http://localhost:3500/jobs', { headers: { [NONCE_HEADER]: 'picked-by-caller' } }));
    expect(response.headers.get(`x-middleware-request-${NONCE_HEADER}`)).not.toBe('picked-by-caller');
    const api = proxy(new NextRequest('http://localhost:3500/api/v1/me', { headers: { [NONCE_HEADER]: 'picked-by-caller' } }));
    expect(api.headers.get(`x-middleware-request-${NONCE_HEADER}`)).toBeNull();
  });

  it('gives API answers a policy that allows nothing', () => {
    const response = proxy(new NextRequest('http://localhost:3500/api/v1/jobs'));
    expect(response.headers.get('content-security-policy')).toBe(API_CONTENT_SECURITY_POLICY);
    expect(API_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(API_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });

  it('keeps the theme handoff redirect and the path header', () => {
    const response = proxy(new NextRequest('http://localhost:3500/jobs?tab=open'));
    expect(response.headers.get('x-middleware-request-x-ks-path')).toBe('/jobs?tab=open');
  });

  it('runs on pages and API routes, and skips static files', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of [...PAGES, '/api/v1/jobs', '/api/auth/sign-in/email']) expect(matcher.test(path), path).toBe(true);
    for (const path of ['/_next/static/chunks/app.js', '/_next/image', '/icon.svg', '/brand/kitstak-loader-pulse.svg', '/apple-icon.png', '/robots.txt']) expect(matcher.test(path), path).toBe(false);
  });
});
