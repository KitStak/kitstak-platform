/** Admin center sections (route segment, label, required permission). Pure; unit tested. */
import type { Permission } from '@/server/rbac/permissions';

export interface AdminSection {
  readonly key: string;
  /** Path below `/<org>/admin` ('' = General). */
  readonly segment: string;
  readonly label: string;
  readonly description: string;
  readonly group: 'Organization' | 'Security' | 'Account';
  readonly icon: 'building' | 'users' | 'teams' | 'permissions' | 'security' | 'audit' | 'api' | 'usage';
  readonly permission: Permission;
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { key: 'general', segment: '', label: 'General', description: 'Name, URL, logo and defaults', group: 'Organization', icon: 'building', permission: 'org:update' },
  { key: 'users', segment: 'users', label: 'Users', description: 'Roles, invitations and status', group: 'Organization', icon: 'users', permission: 'member:update' },
  { key: 'teams', segment: 'teams', label: 'Teams', description: 'Groups of people and their owners', group: 'Organization', icon: 'teams', permission: 'team:write' },
  { key: 'permissions', segment: 'permissions', label: 'Permissions', description: 'Role matrix and creation rules', group: 'Organization', icon: 'permissions', permission: 'org:update' },
  { key: 'security', segment: 'security', label: 'Security', description: 'Sessions, sign-in and network rules', group: 'Security', icon: 'security', permission: 'org:update' },
  { key: 'audit', segment: 'audit-log', label: 'Audit log', description: 'Every security-relevant event', group: 'Security', icon: 'audit', permission: 'audit:read' },
  { key: 'api', segment: 'api', label: 'API', description: 'Personal API tokens', group: 'Security', icon: 'api', permission: 'api_token:manage' },
  { key: 'usage', segment: 'usage', label: 'Usage & billing', description: 'Seats, content and plan', group: 'Account', icon: 'usage', permission: 'org:update' },
];

export function adminHref(orgSlug: string, segment: string): string {
  return segment ? `/${orgSlug}/admin/${segment}` : `/${orgSlug}/admin`;
}

/** Which section a pathname belongs to (`/acme/admin/users/x` → users). */
export function activeSection(pathname: string, orgSlug: string): AdminSection {
  const base = `/${orgSlug}/admin`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\/+/, '') : '';
  const segment = rest.split('/')[0] ?? '';
  const normalized = segment === 'members' ? 'users' : segment;
  return ADMIN_SECTIONS.find((section) => section.segment === normalized) ?? (ADMIN_SECTIONS[0] as AdminSection);
}

export function sectionsByGroup(sections: readonly AdminSection[] = ADMIN_SECTIONS) {
  const groups: { group: AdminSection['group']; sections: AdminSection[] }[] = [];
  for (const section of sections) {
    const existing = groups.find((entry) => entry.group === section.group);
    if (existing) existing.sections.push(section);
    else groups.push({ group: section.group, sections: [section] });
  }
  return groups;
}
