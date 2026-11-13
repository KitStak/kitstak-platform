import { describe, expect, test } from 'vitest';
import { portalChangePasswordUrl } from './password-change-url';

describe('portalChangePasswordUrl', () => {
  test('points at the portal screen and returns to the org in the CRM', () => {
    const url = new URL(portalChangePasswordUrl('https://kitstak.app', 'https://crm.kitstak.app', 'midland'));

    expect(url.origin).toBe('https://kitstak.app');
    expect(url.pathname).toBe('/change-password');
    expect(url.searchParams.get('next')).toBe('https://crm.kitstak.app/midland');
  });

  test('ignores a trailing slash or path on the configured origins', () => {
    const url = new URL(portalChangePasswordUrl('https://kitstak.app/', 'https://crm.kitstak.app/some/page', 'midland'));

    expect(url.pathname).toBe('/change-password');
    expect(url.searchParams.get('next')).toBe('https://crm.kitstak.app/midland');
  });

  test('keeps an odd slug inside the path', () => {
    const next = new URL(portalChangePasswordUrl('https://kitstak.app', 'https://crm.kitstak.app', '../x?y')).searchParams.get('next');

    expect(new URL(next ?? '').origin).toBe('https://crm.kitstak.app');
    expect(next).toBe('https://crm.kitstak.app/..%2Fx%3Fy');
  });
});
