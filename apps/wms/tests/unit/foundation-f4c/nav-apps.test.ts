import { describe, expect, it } from 'vitest';
import { NAV_MENUS } from '@/config/nav-config';
import { isAppEnabled, visibleMenus } from '@/config/nav-access';

const granted = new Set(['analytics.labor_analytics.view', 'analytics.operational_analytics.view']);

function analyticsHrefs(menus: ReturnType<typeof visibleMenus>): string[] {
  return menus.find((m) => m.key === 'analytics')?.columns.flatMap((c) => c.items.map((i) => i.href)) ?? [];
}

describe('nav app gating', () => {
  it('tags every analytics item with its add-on app', () => {
    const items = NAV_MENUS.find((m) => m.key === 'analytics')?.columns.flatMap((c) => c.items) ?? [];
    expect(items.length).toBeGreaterThan(0);
    for (const i of items)
      expect(i.app === 'labor-analytics' || i.app === 'operational-analytics').toBe(true);
  });

  it('shows app items when apps are not gated (null / undefined)', () => {
    expect(analyticsHrefs(visibleMenus(NAV_MENUS, granted)).length).toBe(9);
    expect(analyticsHrefs(visibleMenus(NAV_MENUS, granted, null)).length).toBe(9);
  });

  it('hides the items of inactive apps and drops the menu when none remain', () => {
    const laborOnly = analyticsHrefs(visibleMenus(NAV_MENUS, granted, new Set(['labor-analytics'])));
    expect(laborOnly.every((h) => h.startsWith('/analytics/labor/'))).toBe(true);
    expect(laborOnly.length).toBe(5);
    expect(visibleMenus(NAV_MENUS, granted, new Set()).some((m) => m.key === 'analytics')).toBe(false);
  });

  it('never gates items without an app', () => {
    expect(isAppEnabled({}, new Set())).toBe(true);
    expect(isAppEnabled({ app: 'x' }, new Set(['x']))).toBe(true);
    expect(isAppEnabled({ app: 'x' }, new Set())).toBe(false);
  });
});
