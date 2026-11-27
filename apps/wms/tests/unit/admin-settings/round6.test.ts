/** M14 round 6: Settings nav highlight on every settings route; custom roles render neutral. */
import { describe, expect, it } from 'vitest';
import { activeMenuKey } from '@/config/nav-access';
import { NAV_MENUS } from '@/config/nav-config';
import { roleTone } from '@/components/admin/users/role-tone';

describe('settings nav active state', () => {
  it.each([
    '/settings',
    '/settings/company',
    '/settings/apps',
    '/settings/users',
    '/settings/audit',
    '/settings/roles',
  ])('%s highlights Settings', (path) => {
    expect(activeMenuKey(NAV_MENUS, path)).toBe('settings');
  });
});

describe('role tone', () => {
  it('never paints custom roles with a danger tone', () => {
    expect(roleTone({ name: 'Night shift QA' })).toBe('neutral');
    expect(roleTone({ key: 'client', name: 'Client', category: 'Client' })).toBe('neutral');
  });
});
