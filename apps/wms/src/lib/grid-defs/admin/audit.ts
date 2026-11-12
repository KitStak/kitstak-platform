/** Audit Log grid (security events) definitions (M14). PURE. */
import { AUDIT_OUTCOMES } from '@/lib/enums';
import type { GridFilter } from '@/server/query/grid-query';
import type { AdminField } from './common';

export const AUDIT_GRID_KEY = 'audit-log';

export const AUDIT_CATEGORIES = [
  'Sign-in',
  'Session',
  'Password',
  'CSRF rejected',
  'Permission denied',
  'User change',
  'Role change',
  'Settings change',
  'Other',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** Maps an action key to its category (mirrors the SQL CASE in the repository). */
export function auditCategory(action: string): AuditCategory {
  if (action.startsWith('auth.login')) return 'Sign-in';
  if (action.startsWith('auth.logout') || action.startsWith('session.')) return 'Session';
  if (action.startsWith('auth.password') || action === 'user.password_reset') return 'Password';
  if (action.startsWith('security.csrf')) return 'CSRF rejected';
  if (action.startsWith('security.permission')) return 'Permission denied';
  if (action.startsWith('user.')) return 'User change';
  if (action.startsWith('role.')) return 'Role change';
  if (
    action.startsWith('company.') ||
    action.startsWith('app.') ||
    action.startsWith('printout.') ||
    action.startsWith('screen_config.') ||
    action.startsWith('lookup.') ||
    action.startsWith('sequence.')
  )
    return 'Settings change';
  return 'Other';
}

const ACTION_LABELS: Readonly<Record<string, string>> = {
  'auth.login': 'Sign in',
  'auth.login.rate_limited': 'Sign in blocked (too many attempts)',
  'auth.logout': 'Sign out',
  'auth.logout_all': 'Signed out of all devices',
  'auth.password_change': 'Password changed',
  'auth.password_change_rejected': 'Password change rejected',
  'auth.password_reset.request': 'Password reset requested',
  'auth.password_reset.complete': 'Password reset completed',
  'security.csrf_rejected': 'Request blocked (CSRF)',
  'security.permission_denied': 'Permission denied',
  'session.revoke': 'Session revoked',
  'session.revoke_all': 'All sessions revoked',
  'user.create': 'User created',
  'user.invite_sent': 'Invite email',
  'user.update': 'User updated',
  'user.activate': 'User activated',
  'user.deactivate': 'User deactivated',
  'user.password_reset': 'Password reset by administrator',
  'user.profile_update': 'Profile updated',
  'role.create': 'Role created',
  'role.update': 'Role permissions updated',
  'role.duplicate': 'Role duplicated',
  'role.delete': 'Role deleted',
  'role.restrictions': 'Role restrictions changed',
  'company.update': 'Company settings updated',
  'company.security': 'Password policy changed',
  'app.activate': 'App activated',
  'app.deactivate': 'App deactivated',
  'app.settings': 'App settings changed',
  'company.mail': 'Email delivery changed',
  'company.mail_test': 'Test email',
  'lookup.create': 'Data Setup value created',
  'lookup.update': 'Data Setup value updated',
  'lookup.delete': 'Data Setup value deleted',
  'lookup.zone_product_groups': 'Zone product groups matched',
  'sequence.update': 'Number sequence changed',
  'return_rules.update': 'Return process changed',
  'printout.create': 'Printout created',
  'printout.update': 'Printout updated',
  'printout.delete': 'Printout deleted',
  'printout.duplicate': 'Printout duplicated',
  'screen_config.create': 'Screen configuration created',
  'screen_config.update': 'Screen configuration updated',
  'screen_config.delete': 'Screen configuration deleted',
  'feedback.submitted': 'Feedback sent',
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export const AUDIT_FIELDS: readonly AdminField[] = [
  { field: 'at', label: 'Date', type: 'date' },
  { field: 'category', label: 'Event type', type: 'enum', options: AUDIT_CATEGORIES },
  { field: 'action', label: 'Action', type: 'text' },
  { field: 'outcome', label: 'Outcome', type: 'enum', options: AUDIT_OUTCOMES },
  { field: 'userId', label: 'User', type: 'enum' },
  { field: 'userEmail', label: 'User email', type: 'text' },
  { field: 'ip', label: 'IP address', type: 'text' },
  { field: 'entityLabel', label: 'Target', type: 'text' },
];

export const AUDIT_SORT_FIELDS = ['at', 'category', 'action', 'outcome', 'userName', 'ip'] as const;
export const AUDIT_SEARCH_FIELDS = ['userEmail', 'action', 'ip', 'entityLabel'] as const;

/**
 * Filters for a KPI tile click: replaces any category / outcome filter with the tile's, keeps
 * every other filter (date range, user). One list, applied in a single grid update.
 */
export function kpiFilters(
  current: readonly GridFilter[],
  category: AuditCategory,
  outcome?: 'failure',
): GridFilter[] {
  const kept = current.filter((f) => f.field !== 'category' && f.field !== 'outcome');
  return [
    ...kept,
    { field: 'category', op: 'in', values: [category] },
    ...(outcome ? [{ field: 'outcome', op: 'in', values: [outcome] } as const] : []),
  ];
}
