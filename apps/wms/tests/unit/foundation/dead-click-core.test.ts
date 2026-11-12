import { describe, expect, it } from 'vitest';
import {
  applyRouteFilter,
  clickEffects,
  controlSignature,
  extractHrefs,
  formatOffenders,
  isDeadClick,
  isNoiseRequest,
  parseRouteFilter,
  shouldSkipControl,
  toAuditRoute,
  uniqueRoutes,
  type ClickSignals,
  type ControlDescriptor,
} from '../../e2e/fixtures/dead-click-core';

const ORIGIN = 'http://localhost:3000';

const quiet: ClickSignals = {
  navigated: false,
  requests: 0,
  overlaysBefore: 1,
  overlaysAfter: 1,
  mutations: 0,
  downloads: 0,
  popups: 0,
};

const control = (overrides: Partial<ControlDescriptor> = {}): ControlDescriptor => ({
  auditId: 0,
  tag: 'button',
  role: null,
  label: 'Save view',
  href: null,
  inShell: false,
  ...overrides,
});

describe('clickEffects / isDeadClick', () => {
  it('treats a click with no observable effect as dead', () => {
    expect(clickEffects(quiet)).toEqual([]);
    expect(isDeadClick(quiet)).toBe(true);
  });

  it.each([
    [{ navigated: true }, 'navigation'],
    [{ requests: 2 }, 'request'],
    [{ overlaysAfter: 2 }, 'overlay'],
    [{ downloads: 1 }, 'download'],
    [{ popups: 1 }, 'popup'],
    [{ mutations: 3 }, 'mutation'],
  ] as const)('detects %o as %s', (patch, effect) => {
    const signals = { ...quiet, ...patch };
    expect(clickEffects(signals)).toContain(effect);
    expect(isDeadClick(signals)).toBe(false);
  });

  it('does not count an overlay that closed as a new overlay', () => {
    expect(clickEffects({ ...quiet, overlaysAfter: 0 })).toEqual([]);
  });
});

describe('isNoiseRequest', () => {
  it('ignores dev-server and static asset traffic', () => {
    expect(isNoiseRequest(`${ORIGIN}/_next/webpack-hmr?page=/orders`)).toBe(true);
    expect(isNoiseRequest(`${ORIGIN}/_next/static/chunks/app.js`)).toBe(true);
    expect(isNoiseRequest(`${ORIGIN}/__nextjs_original-stack-frame`)).toBe(true);
    expect(isNoiseRequest(`${ORIGIN}/favicon.ico`)).toBe(true);
  });

  it('keeps API and RSC navigation requests', () => {
    expect(isNoiseRequest(`${ORIGIN}/api/orders?page=1`)).toBe(false);
    expect(isNoiseRequest(`${ORIGIN}/orders/shipped?_rsc=abc`)).toBe(false);
  });
});

describe('toAuditRoute / uniqueRoutes', () => {
  it('normalizes same-origin links to path + query without hash', () => {
    expect(toAuditRoute('/orders?tab=shipped#top', ORIGIN)).toBe('/orders?tab=shipped');
    expect(toAuditRoute(`${ORIGIN}/products`, ORIGIN)).toBe('/products');
  });

  it('rejects external, api, login, logout and non-http links', () => {
    expect(toAuditRoute('https://logiwa.com/x', ORIGIN)).toBeNull();
    expect(toAuditRoute('/api/orders', ORIGIN)).toBeNull();
    expect(toAuditRoute('/login', ORIGIN)).toBeNull();
    expect(toAuditRoute('/logout', ORIGIN)).toBeNull();
    expect(toAuditRoute('mailto:a@b.co', ORIGIN)).toBeNull();
    expect(toAuditRoute('http://[bad', ORIGIN)).toBeNull();
  });

  it('dedupes and sorts routes', () => {
    expect(uniqueRoutes(['/b', '/a', '/b#x', '/api/x'], ORIGIN)).toEqual(['/a', '/b']);
  });
});

describe('extractHrefs', () => {
  it('walks nested nav config exports', () => {
    const mod = {
      NAV_MENUS: [{ label: 'A', sections: [{ links: [{ href: '/a' }, { href: '/b', label: 'B' }] }] }],
      TOP: { href: '/top' },
      other: 3,
      bad: { href: 5 },
    };
    expect(extractHrefs(mod)).toEqual(['/a', '/b', '/top']);
    expect(extractHrefs(null)).toEqual([]);
  });
});

describe('control filtering', () => {
  it('skips log out / sign out controls', () => {
    expect(shouldSkipControl(control({ label: 'Log out' }))).toBe(true);
    expect(shouldSkipControl(control({ label: 'Sign Out' }))).toBe(true);
    expect(shouldSkipControl(control({ tag: 'a', label: 'Bye', href: '/logout' }))).toBe(true);
    expect(shouldSkipControl(control())).toBe(false);
  });

  it('skips controls that already represent the current state', () => {
    expect(shouldSkipControl(control({ role: 'tab', label: 'Priority', isCurrent: true }))).toBe(true);
    expect(shouldSkipControl(control({ role: 'tab', label: 'Status', isCurrent: false }))).toBe(false);
  });

  it('builds a stable signature independent of audit id', () => {
    expect(controlSignature(control({ auditId: 1 }))).toBe(controlSignature(control({ auditId: 9 })));
    expect(controlSignature(control({ href: '/a' }))).not.toBe(controlSignature(control({ href: '/b' })));
  });
});

describe('formatOffenders', () => {
  it('reports success when nothing is dead', () => {
    expect(formatOffenders([])).toBe('No dead clicks found.');
  });

  it('groups offenders by route', () => {
    const text = formatOffenders([
      { route: '/orders', control: control({ label: 'Export' }) },
      { route: '/orders', control: control({ tag: 'a', label: '', href: '/x', role: 'menuitem' }) },
      { route: '/products', control: control({ label: 'Refresh' }) },
    ]);
    expect(text).toContain('3 dead click(s):');
    expect(text).toContain('/orders (2)');
    expect(text).toContain('<button> "Export"');
    expect(text).toContain('<a[role=menuitem]> (no accessible label) -> /x');
    expect(text).toContain('/products (1)');
  });
});

describe('route filter', () => {
  it('parses a comma list and ignores junk', () => {
    expect(parseRouteFilter(undefined)).toEqual([]);
    expect(parseRouteFilter(' /orders, products ,/jobs')).toEqual(['/orders', '/jobs']);
  });

  it('fails fast when a filter was given but no route survived (shell path mangling)', () => {
    expect(() => parseRouteFilter('C:/Program Files/Git/orders')).toThrow(/no routes/);
  });

  it('keeps matching routes and their sub-routes', () => {
    const routes = ['/orders', '/orders/shipped', '/orders?tab=x', '/ordersx', '/jobs'];
    expect(applyRouteFilter(routes, [])).toEqual(routes);
    expect(applyRouteFilter(routes, ['/orders'])).toEqual(['/orders', '/orders/shipped', '/orders?tab=x']);
  });
});
