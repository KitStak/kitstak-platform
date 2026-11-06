/** Human labels for the RBAC permission matrix (pure; unit tested for completeness). */
import { PERMISSIONS, type Permission } from '@/server/rbac/permissions';

export const PERMISSION_LABEL: Readonly<Record<Permission, string>> = {
  'org:read': 'See the organization',
  'org:update': 'Change organization settings',
  'org:delete': 'Delete the organization',
  'org:billing': 'Manage billing & plan',
  'member:read': 'See members',
  'member:invite': 'Invite people',
  'member:update': 'Change roles & deactivate',
  'member:remove': 'Remove members',
  'team:read': 'See teams',
  'team:write': 'Create & manage teams',
  'workspace:read': 'See workspaces',
  'workspace:write': 'Create & edit workspaces',
  'workspace:delete': 'Delete workspaces',
  'board:read': 'See boards',
  'board:create': 'Create boards',
  'board:write': 'Edit board structure',
  'board:delete': 'Delete boards',
  'board:share': 'Share boards',
  'item:read': 'See items',
  'item:write': 'Create & edit items',
  'item:delete': 'Delete items',
  'update:read': 'Read updates',
  'update:write': 'Write updates',
  'update:moderate': 'Moderate anyone’s updates',
  'file:read': 'Download files',
  'file:write': 'Upload files',
  'dashboard:read': 'See dashboards',
  'dashboard:write': 'Build dashboards',
  'automation:read': 'See automations',
  'automation:write': 'Build automations',
  'data:import': 'Import data',
  'data:export': 'Export data',
  'audit:read': 'Read the audit log',
  'api_token:manage': 'Create API tokens',
  'webhook:manage': 'Manage webhooks',
};

const GROUP_LABEL: Readonly<Record<string, string>> = {
  org: 'Organization',
  member: 'People',
  team: 'People',
  workspace: 'Workspaces',
  board: 'Boards',
  item: 'Items',
  update: 'Collaboration',
  file: 'Collaboration',
  dashboard: 'Dashboards & automations',
  automation: 'Dashboards & automations',
  data: 'Data',
  audit: 'Security',
  api_token: 'Security',
  webhook: 'Security',
};

export function permissionGroups(): { group: string; permissions: Permission[] }[] {
  const groups: { group: string; permissions: Permission[] }[] = [];
  for (const permission of PERMISSIONS) {
    const group = GROUP_LABEL[permission.split(':')[0] ?? ''] ?? 'Other';
    const existing = groups.find((entry) => entry.group === group);
    if (existing) existing.permissions.push(permission);
    else groups.push({ group, permissions: [permission] });
  }
  return groups;
}
