/** Identity & access: users, roles, scopes, sessions, preferences, security audit log. */
import { index, integer, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { wmsSchema } from './_schema';
import type { UserPreferences } from '../../../lib/domain-types';
import {
  AUDIT_OUTCOMES,
  DENSITIES,
  LEGACY_USER_ROLES,
  NOTIFICATION_SEVERITIES,
  ROLE_CATEGORIES,
  USER_TYPES,
} from '../../../lib/enums';
import type { ROLE_RESTRICTIONS } from '../../../lib/enums';
import { bool, EMPTY_JSON_ARRAY, json, nowIso, pk, stamps } from '../columns';
import { clients, warehouses } from './org';

export const users = wmsSchema.table(
  'users',
  {
    id: pk(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: LEGACY_USER_ROLES }).notNull(),
    isActive: bool('is_active').notNull().default(true),
    firstName: text('first_name'),
    lastName: text('last_name'),
    userType: text('user_type', { enum: USER_TYPES }).notNull().default('Operation'),
    isApiUser: bool('is_api_user').notNull().default(false),
    allClients: bool('all_clients').notNull().default(true),
    sessionVersion: integer('session_version').notNull().default(1),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: text('locked_until'),
    lastLoginAt: text('last_login_at'),
    passwordChangedAt: text('password_changed_at'),
    preferences: json<UserPreferences>('preferences'),
    ...stamps(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

export const roles = wmsSchema.table(
  'roles',
  {
    id: pk(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category', { enum: ROLE_CATEGORIES }).notNull().default('Operation'),
    isSystem: bool('is_system').notNull().default(false),
    restrictions: json<(typeof ROLE_RESTRICTIONS)[number][]>('restrictions')
      .notNull()
      .default(EMPTY_JSON_ARRAY),
    ...stamps(),
  },
  (t) => [uniqueIndex('roles_key_idx').on(t.key)],
);

export const rolePermissions = wmsSchema.table(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(), // key from the PERMISSIONS catalog
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const userRoles = wmsSchema.table(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const userWarehouses = wmsSchema.table(
  'user_warehouses',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    warehouseId: text('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.warehouseId] })],
);

export const userClients = wmsSchema.table(
  'user_clients',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.clientId] })],
);

export const userSessions = wmsSchema.table(
  'user_sessions',
  {
    id: pk(), // == JWT jti
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionVersion: integer('session_version').notNull(),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
    lastSeenAt: text('last_seen_at'),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('user_sessions_user_idx').on(t.userId)],
);

export const passwordResetTokens = wmsSchema.table(
  'password_reset_tokens',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
  },
  (t) => [uniqueIndex('password_reset_token_idx').on(t.tokenHash)],
);

export const rateLimits = wmsSchema.table('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStart: text('window_start').notNull(),
});

export const userPrinters = wmsSchema.table(
  'user_printers',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    warehouseId: text('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    barcodePrinter: text('barcode_printer'),
    laserPrinter: text('laser_printer'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.warehouseId] })],
);

export interface GridPrefs {
  visible: string[];
  order: string[];
  widths: Record<string, number>;
  density: (typeof DENSITIES)[number];
  pageSize: number;
  /** Columns frozen to the left edge (optional; older rows omit it). */
  pinned?: string[];
}

export const userGridPrefs = wmsSchema.table(
  'user_grid_prefs',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gridKey: text('grid_key').notNull(),
    prefs: json<GridPrefs>('prefs').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gridKey] })],
);

export const savedViews = wmsSchema.table(
  'saved_views',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gridKey: text('grid_key').notNull(),
    name: text('name').notNull(),
    query: text('query').notNull(), // grid-query string
    isShared: bool('is_shared').notNull().default(false),
    isDefault: bool('is_default').notNull().default(false),
    pinnedFields: json<string[]>('pinned_fields'),
    ...stamps(),
  },
  (t) => [index('saved_views_grid_idx').on(t.gridKey, t.userId)],
);

export interface CompanyDefaults {
  currency: string;
  dateFormat: string;
  weightUnit: string;
  dimensionUnit: string;
}

export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  maxAgeDays?: number;
  lockoutThreshold: number;
  lockoutMinutes: number;
}

export const companySettings = wmsSchema.table('company_settings', {
  id: text('id').primaryKey().default('company'),
  displayName: text('display_name').notNull(),
  fullName: text('full_name').notNull(),
  logoFileId: text('logo_file_id'),
  defaults: json<CompanyDefaults>('defaults'),
  passwordPolicy: json<PasswordPolicy>('password_policy'),
  ...stamps(),
});

export const apps = wmsSchema.table('apps', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull(),
  isActive: bool('is_active').notNull().default(false),
  settings: json<Record<string, unknown>>('settings'),
  activatedAt: text('activated_at'),
  activatedBy: text('activated_by'),
});

export const notifications = wmsSchema.table(
  'notifications',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // "wave.completed" | "import.failed" | "shortage.created" | ...
    title: text('title').notNull(),
    body: text('body'),
    href: text('href'),
    severity: text('severity', { enum: NOTIFICATION_SEVERITIES }).notNull().default('info'),
    readAt: text('read_at'),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt)],
);

/** Security events (logins, permission changes). Business edits go to `change_log`. */
export const auditLog = wmsSchema.table(
  'audit_log',
  {
    id: pk(),
    userId: text('user_id').references(() => users.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    detail: text('detail'),
    at: text('at').notNull().$defaultFn(nowIso),
    ip: text('ip'),
    userAgent: text('user_agent'),
    outcome: text('outcome', { enum: AUDIT_OUTCOMES }).notNull().default('success'),
  },
  (t) => [index('audit_at_idx').on(t.at)],
);
