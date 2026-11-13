import { describe, expect, test } from 'vitest';
import { safeNextPath, safeReturnUrl } from './routes';

const SIBLINGS = ['https://crm.kitstak.app', 'https://wms.kitstak.app'];

describe('safeNextPath', () => {
  test('keeps a portal path', () => {
    expect(safeNextPath('/billing')).toBe('/billing');
  });

  test('rejects control characters and backslashes that browsers would turn into another host', () => {
    expect(safeNextPath('/\t/evil.example')).toBe('/');
    expect(safeNextPath('/\n/evil.example')).toBe('/');
    expect(safeNextPath('/\t\\evil.example')).toBe('/');
    expect(safeNextPath('/a\\b')).toBe('/');
    expect(safeNextPath('/ /evil.example')).toBe('/');
  });

  test('rejects protocol-relative and auth-page targets', () => {
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('/login')).toBe('/');
  });
});

describe('safeReturnUrl', () => {
  test('falls back when nothing is given', () => {
    expect(safeReturnUrl(null, SIBLINGS)).toBe('/');
  });

  test('keeps a portal path', () => {
    expect(safeReturnUrl('/billing', SIBLINGS)).toBe('/billing');
  });

  test('keeps a URL on a sibling app', () => {
    expect(safeReturnUrl('https://crm.kitstak.app/midland', SIBLINGS)).toBe('https://crm.kitstak.app/midland');
  });

  test('rejects an outside site', () => {
    expect(safeReturnUrl('https://evil.example/crm.kitstak.app', SIBLINGS)).toBe('/');
  });

  test('rejects look-alike hosts and credentials in the URL', () => {
    expect(safeReturnUrl('https://crm.kitstak.app.evil.example/', SIBLINGS)).toBe('/');
    expect(safeReturnUrl('https://crm.kitstak.app@evil.example/', SIBLINGS)).toBe('/');
    expect(safeReturnUrl('https://user:pw@crm.kitstak.app/', SIBLINGS)).toBe('/');
  });

  test('rejects a different scheme or port on an allowed host', () => {
    expect(safeReturnUrl('http://crm.kitstak.app/midland', SIBLINGS)).toBe('/');
    expect(safeReturnUrl('https://crm.kitstak.app:8443/midland', SIBLINGS)).toBe('/');
  });

  test('rejects script and protocol-relative targets', () => {
    expect(safeReturnUrl('javascript:alert(1)', SIBLINGS)).toBe('/');
    expect(safeReturnUrl('//evil.example', SIBLINGS)).toBe('/');
    expect(safeReturnUrl('/\\evil.example', SIBLINGS)).toBe('/');
  });

  test('rejects a path that hides another host behind a tab', () => {
    expect(safeReturnUrl('/\t/evil.example', SIBLINGS)).toBe('/');
  });

  test('never returns to the change-password screen itself', () => {
    expect(safeReturnUrl('/change-password?next=/x', SIBLINGS)).toBe('/');
  });

  test('ignores a malformed entry in the allow-list', () => {
    expect(safeReturnUrl('https://crm.kitstak.app/a', ['not a url', 'https://crm.kitstak.app'])).toBe(
      'https://crm.kitstak.app/a',
    );
  });
});
