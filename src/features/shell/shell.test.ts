import { describe, expect, it } from 'vitest';
import { entityHref, routes, safeNextPath } from './routes';
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, clampSidebarWidth } from './store';
import { THEME_COOKIE, parseThemeCookie, themeCookieString } from './theme-script';

describe('safeNextPath', () => {
  it('accepts same-origin relative paths', () => {
    expect(safeNextPath('/acme/boards/1?view=kanban')).toBe('/acme/boards/1?view=kanban');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '/login',
    '/signup?next=/x',
  ])('rejects %s', (value) => {
    expect(safeNextPath(value, '/home')).toBe('/home');
  });

  it('falls back for empty input', () => {
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined, '/x')).toBe('/x');
  });
});

describe('routes', () => {
  it('builds entity links', () => {
    expect(entityHref('acme', 'board', 'b1')).toBe(routes.board('acme', 'b1'));
    expect(entityHref('acme', 'dashboard', 'd1')).toBe('/acme/dashboards/d1');
    expect(entityHref('acme', 'item', 'i1')).toBeNull();
  });
});

describe('clampSidebarWidth', () => {
  it('clamps to the allowed range and rounds', () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_WIDTH_MAX);
    expect(clampSidebarWidth(300.6)).toBe(301);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT);
  });
});

describe('theme cookie', () => {
  it('parses only light or dark', () => {
    expect(parseThemeCookie('dark')).toBe('dark');
    expect(parseThemeCookie('light')).toBe('light');
    expect(parseThemeCookie('system')).toBeNull();
    expect(parseThemeCookie(undefined)).toBeNull();
    expect(parseThemeCookie('<script>')).toBeNull();
  });

  it('builds a long-lived cookie, or an expiring one to follow the system', () => {
    expect(themeCookieString('dark')).toMatch(new RegExp(`^${THEME_COOKIE}=dark; Path=/; Max-Age=\\d+; SameSite=Lax$`));
    expect(themeCookieString(null)).toContain('Max-Age=0');
  });
});
