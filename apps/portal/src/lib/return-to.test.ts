/**
 * Review round 3: a signed out visit goes to sign in and back to the page that was asked for, with
 * its query. The proxy notes the page; the guards check it with `safeNextPath`.
 */
import { describe, expect, test } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { RETURN_TO_HEADER, returnToOf } from './return-to';
import { safeNextPath } from './routes';

/** The request headers the proxy hands on to the page (Next.js carries them in `x-middleware-request-*`). */
function forwarded(url: string, init?: { method?: string; headers?: Record<string, string> }): string | null {
  const response = proxy(new NextRequest(`http://localhost:3300${url}`, { method: init?.method ?? 'GET', headers: init?.headers }));
  return response.headers.get(`x-middleware-request-${RETURN_TO_HEADER}`);
}

describe('returnToOf', () => {
  test('keeps the path and the whole query', () => {
    expect(returnToOf('/billing', '?fix=payment')).toBe('/billing?fix=payment');
    expect(returnToOf('/billing/plan', 'add=projects&from=crm')).toBe('/billing/plan?add=projects&from=crm');
    expect(returnToOf('/billing/invoices/in_123', '')).toBe('/billing/invoices/in_123');
    expect(returnToOf('/', '')).toBe('/');
  });

  test('drops the query the framework adds to its own page fetches', () => {
    expect(returnToOf('/billing', '?fix=payment&_rsc=1a2b3')).toBe('/billing?fix=payment');
    expect(returnToOf('/billing', '?_rsc=1a2b3')).toBe('/billing');
  });

  test('gives up on an address that is too long, so the page falls back to its own default', () => {
    expect(returnToOf('/billing', `?x=${'a'.repeat(1200)}`)).toBeNull();
    expect(returnToOf('billing', '')).toBeNull();
  });
});

describe('the proxy notes the page that was asked for', () => {
  test('the links in the billing emails keep their page and query', () => {
    expect(forwarded('/billing?fix=payment')).toBe('/billing?fix=payment');
    expect(forwarded('/billing/plan?add=projects')).toBe('/billing/plan?add=projects');
    expect(forwarded('/billing/invoices/in_test_1')).toBe('/billing/invoices/in_test_1');
    expect(forwarded('/settings/organization')).toBe('/settings/organization');
  });

  test('a header a browser sends under this name never gets through', () => {
    expect(forwarded('/billing', { headers: { [RETURN_TO_HEADER]: 'https://evil.example/' } })).toBe('/billing');
    expect(forwarded('/billing', { headers: { [RETURN_TO_HEADER]: '//evil.example' } })).toBe('/billing');
    // Not a page request: the header is removed, not passed on.
    const post = proxy(new NextRequest('http://localhost:3300/billing', { method: 'POST', headers: { [RETURN_TO_HEADER]: '//evil.example' } }));
    expect(post.headers.get(`x-middleware-request-${RETURN_TO_HEADER}`)).toBeNull();
    expect(post.headers.get('x-middleware-override-headers') ?? '').not.toContain(RETURN_TO_HEADER);
  });

  test('what it notes always passes the same origin check used at sign in', () => {
    for (const url of ['/billing?fix=payment', '/billing/plan?add=projects&from=crm', '/settings/organization']) {
      const noted = forwarded(url);
      expect(safeNextPath(noted, 'REFUSED')).toBe(noted);
    }
    // A sign in or signup page is never a place to come back to.
    expect(safeNextPath(forwarded('/login?next=/billing'), 'REFUSED')).toBe('REFUSED');
  });
});
