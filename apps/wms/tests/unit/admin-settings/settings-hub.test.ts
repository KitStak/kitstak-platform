import { describe, expect, it } from 'vitest';
import { settingsHubPermissions, settingsHubSections } from '@/components/admin/settings-hub-data';

describe('settings hub', () => {
  it('shows only sections the user can open', () => {
    const sections = settingsHubSections(new Set(['settings.users.view']));
    expect(sections.map((s) => s.heading)).toEqual(['Users']);
    expect(sections[0]?.items.map((i) => i.href)).toEqual(['/settings/users', '/settings/audit']);
  });

  it('adds Account cards for company settings and apps', () => {
    const sections = settingsHubSections(
      new Set(['settings.company_settings.view', 'settings.add_ons.view']),
    );
    const account = sections.find((s) => s.heading === 'Account');
    expect(account?.items.map((i) => i.label)).toEqual(['Company Settings', 'Apps', 'Custom Fields']);
  });

  it('returns nothing for a user without settings permissions', () => {
    expect(settingsHubSections(new Set(['inventory.view']))).toEqual([]);
  });

  it('describes every mega-menu settings item', () => {
    const all = new Set(settingsHubPermissions());
    for (const s of settingsHubSections(all))
      for (const i of s.items) expect(i.description, i.href).not.toBe('');
  });
});

import { roleTone } from '@/components/admin/users/role-tone';

describe('roleTone', () => {
  it('marks privileged roles as info and keeps every other role neutral (roles are identities)', () => {
    expect(roleTone({ key: 'admin', name: 'Admin' })).toBe('info');
    expect(roleTone({ name: 'Owner' })).toBe('info');
    expect(roleTone({ name: 'Client' })).toBe('neutral');
    expect(roleTone({ key: 'viewer', name: 'Viewer' })).toBe('neutral');
    expect(roleTone({ key: 'manager', name: 'Warehouse Manager' })).toBe('neutral');
    expect(roleTone({ key: 'operator', name: 'Warehouse Clerk' })).toBe('neutral');
    expect(roleTone({ name: 'Custom' })).toBe('neutral');
    expect(roleTone({ name: 'KS-CRIT Role A' })).toBe('neutral');
  });
});
