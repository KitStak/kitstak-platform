/**
 * Export providers for the M14 admin grids ("users", "roles", "audit-log"), wired by
 * `src/server/exports/providers/<gridKey>.ts`. They read the same repository queries as the
 * list endpoints, so Export As Excel matches the filtered, sorted grid exactly.
 */
import type { ExportProvider } from '@/server/exports/types';
import { listAuditLog } from './audit';
import { listRoles } from './roles';
import { listUsers } from './users';

export const usersExport: ExportProvider = {
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'roleNames', label: 'Role' },
    { key: 'warehouseCodes', label: 'Warehouse' },
    { key: 'userType', label: 'User Type' },
    { key: 'status', label: 'Status' },
    { key: 'isApiUser', label: 'API User', type: 'boolean' },
    { key: 'lastLoginAt', label: 'Last Sign-in', type: 'datetime' },
    { key: 'createdAt', label: 'Created Date', type: 'datetime' },
  ],
  async fetchPage(ctx, page, pageSize) {
    const { rows, total } = await listUsers(ctx.db, ctx.auth, { ...ctx.query, page, pageSize });
    return { rows: rows.map((r) => ({ ...r })), total };
  },
};

export const rolesExport: ExportProvider = {
  columns: [
    { key: 'name', label: 'Role Name' },
    { key: 'description', label: 'Description' },
    { key: 'category', label: 'Role Category' },
    { key: 'restrictionLabels', label: 'Restrictions' },
    { key: 'userCount', label: 'Users', type: 'integer' },
    { key: 'permissionCount', label: 'Permissions', type: 'integer' },
    { key: 'isSystem', label: 'System Role', type: 'boolean' },
  ],
  async fetchPage(ctx, page, pageSize) {
    const { rows, total } = await listRoles(ctx.db, { ...ctx.query, page, pageSize });
    return {
      rows: rows.map((r) => ({
        ...r,
        restrictionLabels: r.restrictions.map((k) => k.replace(/_/g, ' ')).join(', '),
      })),
      total,
    };
  },
};

export const auditExport: ExportProvider = {
  columns: [
    { key: 'at', label: 'Date', type: 'datetime' },
    { key: 'category', label: 'Event Type' },
    { key: 'actionLabel', label: 'Action' },
    { key: 'outcome', label: 'Outcome' },
    { key: 'userName', label: 'User' },
    { key: 'userEmail', label: 'User Email' },
    { key: 'entityLabel', label: 'Target' },
    { key: 'summary', label: 'Details' },
    { key: 'ip', label: 'IP Address' },
    { key: 'userAgent', label: 'Device' },
  ],
  async fetchPage(ctx, page, pageSize) {
    const { rows, total } = await listAuditLog(ctx.db, { ...ctx.query, page, pageSize });
    return { rows: rows.map((r) => ({ ...r })), total };
  },
};
