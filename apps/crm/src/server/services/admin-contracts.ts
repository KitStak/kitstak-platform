/**
 * Admin center, profile settings and trash: Zod inputs + DTO types. Client-safe (no server
 * imports) so feature code can share the exact shapes the API validates.
 */
import { z } from 'zod';
import { ORG_ROLES, type OrgRole } from '@/server/rbac/permissions';

// ---------------------------------------------------------------------------------------------
// Organization settings (stored in `organization.metadata` JSON under `kitstak`)
// ---------------------------------------------------------------------------------------------

export const CREATION_POLICIES = ['members', 'admins'] as const;
export type CreationPolicy = (typeof CREATION_POLICIES)[number];

const DOMAIN_RE = /^(?=.{3,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export const emailDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^@/, ''))
  .refine((value) => DOMAIN_RE.test(value), 'Enter a domain like example.com');

/** IPv4 / IPv6 address or CIDR range. Detailed parsing lives in admin-policy. */
export const ipRuleSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, 'Enter an IP address or CIDR range like 203.0.113.0/24');

export const orgSettingsSchema = z.object({
  defaultWorkspaceId: z.uuid().nullable().catch(null),
  workspaceCreation: z.enum(CREATION_POLICIES).catch('members'),
  boardCreation: z.enum(CREATION_POLICIES).catch('members'),
  allowedEmailDomains: z.array(z.string()).max(50).catch([]),
  ipAllowListEnabled: z.boolean().catch(false),
  ipAllowList: z.array(z.string()).max(100).catch([]),
  /** teamId → user ids of team owners. */
  teamOwners: z.record(z.string(), z.array(z.string()).max(50)).catch({}),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export const DEFAULT_ORG_SETTINGS: OrgSettings = orgSettingsSchema.parse({});

export const updateOrgGeneralSchema = z
  .object({
    name: z.string().trim().min(2, 'Use at least 2 characters').max(80).optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'Use at least 3 characters')
      .max(48)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers and dashes')
      .optional(),
    logo: z
      .string()
      .max(200)
      .regex(/^\/api\/v1\/assets\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/, 'Upload the logo first')
      .nullable()
      .optional(),
    defaultWorkspaceId: z.uuid().nullable().optional(),
  })
  .strict();
export type UpdateOrgGeneralInput = z.infer<typeof updateOrgGeneralSchema>;

export const updateOrgPolicySchema = z
  .object({
    workspaceCreation: z.enum(CREATION_POLICIES).optional(),
    boardCreation: z.enum(CREATION_POLICIES).optional(),
    allowedEmailDomains: z.array(emailDomainSchema).max(50).optional(),
    ipAllowListEnabled: z.boolean().optional(),
    ipAllowList: z.array(ipRuleSchema).max(100).optional(),
  })
  .strict();
export type UpdateOrgPolicyInput = z.infer<typeof updateOrgPolicySchema>;

export const teamOwnersSchema = z.object({ userIds: z.array(z.uuid()).max(50) });

export interface OrgAdminDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo: string | null;
  readonly createdAt: string;
  /** Data region (display only). */
  readonly region: string;
  readonly settings: OrgSettings;
  /** Workspaces available as the default landing workspace. */
  readonly workspaces: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** The caller's IP as seen by the server (for the allow-list self-lockout guard). */
  readonly requesterIp: string | null;
}

// ---------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------

export type MemberStatus = 'active' | 'deactivated';

export interface AdminUserDto {
  readonly memberId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
  readonly title: string | null;
  readonly role: OrgRole;
  readonly status: MemberStatus;
  readonly teamIds: readonly string[];
  readonly joinedAt: string;
  readonly lastActiveAt: string | null;
}

export interface AdminInvitationDto {
  readonly id: string;
  readonly email: string;
  readonly role: OrgRole;
  readonly inviterName: string | null;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly expired: boolean;
}

export interface AdminUsersDto {
  readonly users: readonly AdminUserDto[];
  readonly invitations: readonly AdminInvitationDto[];
}

export const BULK_USER_ACTIONS = ['set_role', 'deactivate', 'reactivate'] as const;
export const bulkUsersSchema = z
  .object({
    action: z.enum(BULK_USER_ACTIONS),
    memberIds: z.array(z.uuid()).min(1).max(200),
    role: z.enum(ORG_ROLES).optional(),
  })
  .refine((input) => input.action !== 'set_role' || input.role !== undefined, {
    message: 'Choose a role',
    path: ['role'],
  });
export type BulkUsersInput = z.infer<typeof bulkUsersSchema>;

export interface BulkResultDto {
  readonly updated: readonly string[];
  readonly failed: ReadonlyArray<{ readonly id: string; readonly reason: string }>;
}

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

export interface DeviceInfo {
  readonly browser: string;
  readonly os: string;
  readonly kind: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
}

export interface AdminSessionDto {
  readonly id: string;
  readonly userId: string;
  readonly userName: string;
  readonly userEmail: string;
  readonly image: string | null;
  readonly ipAddress: string | null;
  readonly device: DeviceInfo;
  readonly createdAt: string;
  readonly lastActiveAt: string;
  readonly expiresAt: string;
  readonly current: boolean;
}

// ---------------------------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------------------------

export const AUDIT_CATEGORIES = [
  'auth',
  'member',
  'team',
  'board',
  'item',
  'org',
  'api_token',
  'security',
  'data',
  'trash',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** True for a real calendar day in YYYY-MM-DD form (rejects 2026-13-45, 2026-02-30). */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().startsWith(value);
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const isoDate = z.string().refine(isCalendarDay, 'Use a real date as YYYY-MM-DD');

export const AUDIT_ORDERS = ['desc', 'asc'] as const;

export const adminAuditQuerySchema = z
  .object({
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    category: z.enum(AUDIT_CATEGORIES).optional(),
    actorId: z.uuid().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    /** IANA time zone the from/to calendar days are interpreted in (default UTC). */
    tz: z.string().max(64).refine(isTimeZone, 'Unknown time zone').optional(),
    order: z.enum(AUDIT_ORDERS).default('desc'),
    q: z.string().trim().max(100).optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'The start date must be on or before the end date',
    path: ['to'],
  });
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

export interface AdminAuditEntryDto {
  readonly id: string;
  readonly action: string;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly actorEmail: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  /** Resolved display name of the target (board name, person, token name…). */
  readonly targetLabel: string | null;
  /** 'deleted' when the target id no longer resolves (deleted entity). */
  readonly targetState: 'resolved' | 'deleted' | 'none';
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------------------------
// API tokens
// ---------------------------------------------------------------------------------------------

export const API_TOKEN_SCOPES = [
  { value: 'boards:read', label: 'Read boards & items', group: 'Boards' },
  { value: 'boards:write', label: 'Create & edit boards and items', group: 'Boards' },
  { value: 'updates:write', label: 'Post updates', group: 'Collaboration' },
  { value: 'members:read', label: 'Read members & teams', group: 'Organization' },
  { value: 'webhooks:manage', label: 'Manage webhooks', group: 'Organization' },
  { value: 'audit:read', label: 'Read the audit log', group: 'Security' },
] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number]['value'];
const SCOPE_VALUES = API_TOKEN_SCOPES.map((scope) => scope.value) as [ApiTokenScope, ...ApiTokenScope[]];

export const TOKEN_EXPIRY_OPTIONS = [30, 90, 365] as const;

export const createApiTokenSchema = z.object({
  name: z.string().trim().min(2, 'Give the token a name').max(60),
  scopes: z.array(z.enum(SCOPE_VALUES)).min(1, 'Pick at least one scope').max(SCOPE_VALUES.length),
  expiresInDays: z
    .union([z.literal(30), z.literal(90), z.literal(365)])
    .nullable()
    .default(90),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

export const apiTokenListQuerySchema = z.object({ scope: z.enum(['mine', 'org']).default('mine') });

export type ApiTokenStatus = 'active' | 'expired' | 'revoked';

export interface ApiTokenDto {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly userId: string;
  readonly userName: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly status: ApiTokenStatus;
}

export interface CreatedApiTokenDto extends ApiTokenDto {
  /** Raw token. Returned exactly once; only a SHA-256 hash is stored. */
  readonly token: string;
}

// ---------------------------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------------------------

export interface UsageDto {
  readonly seats: {
    readonly active: number;
    readonly deactivated: number;
    readonly pendingInvites: number;
    readonly byRole: Readonly<Record<OrgRole, number>>;
    readonly limit: number;
  };
  readonly workspaces: number;
  readonly boards: number;
  readonly items: number;
  readonly dashboards: number;
  readonly automations: { readonly total: number; readonly enabled: number };
  readonly automationRuns: { readonly thisMonth: number; readonly limit: number; readonly failedThisMonth: number };
  readonly files: { readonly count: number; readonly bytes: number; readonly limitBytes: number };
  readonly apiTokens: number;
  readonly apiTokensRevokedThisMonth: number;
  readonly plan: { readonly name: string; readonly demo: true; readonly renewsAt: string | null };
}

// ---------------------------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------------------------

export const TRASH_TYPES = ['board', 'group', 'item'] as const;
export type TrashType = (typeof TRASH_TYPES)[number];
export const TRASH_RETENTION_DAYS = 30;

export const trashQuerySchema = z.object({
  type: z.enum(TRASH_TYPES).optional(),
  boardId: z.uuid().optional(),
});

export const trashEntriesSchema = z.object({
  entries: z
    .array(z.object({ type: z.enum(TRASH_TYPES), id: z.uuid() }))
    .min(1)
    .max(100),
});
export type TrashEntriesInput = z.infer<typeof trashEntriesSchema>;

export interface TrashEntryDto {
  readonly type: TrashType;
  readonly id: string;
  readonly name: string;
  readonly boardId: string;
  readonly boardName: string;
  readonly groupName: string | null;
  readonly workspaceName: string | null;
  readonly itemCount: number | null;
  readonly deletedAt: string;
  readonly deletedBy: { readonly id: string; readonly name: string } | null;
  readonly purgeAt: string;
  /** Whether the caller may permanently delete it. */
  readonly canPurge: boolean;
  /** Whether the caller may restore it (edit access to the board). */
  readonly canRestore: boolean;
}

export interface TrashResultDto {
  readonly done: ReadonlyArray<{ readonly type: TrashType; readonly id: string }>;
  readonly failed: ReadonlyArray<{ readonly type: TrashType; readonly id: string; readonly reason: string }>;
}

// ---------------------------------------------------------------------------------------------
// Profile & preferences (per member, stored in org metadata under `kitstak.profiles`)
// ---------------------------------------------------------------------------------------------

export const NOTIFICATION_EVENTS = [
  { key: 'mention', label: 'Someone @mentions me', description: 'In updates, replies and docs' },
  { key: 'assigned', label: 'I’m assigned to an item', description: 'People columns on any board' },
  { key: 'item_update', label: 'Updates on items I follow', description: 'New updates and replies' },
  { key: 'status_change', label: 'Status changes on my items', description: 'Stage, status and priority' },
  { key: 'due_date', label: 'Due date reminders', description: 'The day before and on the day' },
  { key: 'automation', label: 'Automation notifications', description: 'Sent by board automations' },
  { key: 'invitation', label: 'Invitations to boards & workspaces', description: 'When someone adds me' },
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]['key'];
const EVENT_KEYS = NOTIFICATION_EVENTS.map((event) => event.key) as [NotificationEvent, ...NotificationEvent[]];

export const NOTIFICATION_CHANNELS = ['inApp', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

const channelPrefSchema = z.object({ inApp: z.boolean(), email: z.boolean() });
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const DATE_FORMATS = ['MDY', 'DMY', 'YMD'] as const;
export const LOCALES = [
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'de-DE', label: 'Deutsch (Deutschland)' },
  { value: 'es-ES', label: 'Español (España)' },
  { value: 'fr-FR', label: 'Français (France)' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'ja-JP', label: '日本語 (日本)' },
] as const;
const LOCALE_VALUES = LOCALES.map((locale) => locale.value) as [string, ...string[]];

export const profilePrefsSchema = z.object({
  phone: z.string().trim().max(32).nullable().catch(null),
  location: z.string().trim().max(80).nullable().catch(null),
  locale: z.enum(LOCALE_VALUES).catch('en-US'),
  dateFormat: z.enum(DATE_FORMATS).catch('MDY'),
  weekStart: z.enum(['sunday', 'monday']).catch('sunday'),
  timeFormat: z.enum(['12h', '24h']).catch('12h'),
  theme: z.enum(['light', 'dark', 'system']).catch('system'),
  notifications: z
    .record(z.string(), channelPrefSchema)
    .catch({}),
  emailDigest: z.enum(['instant', 'daily', 'weekly', 'off']).catch('daily'),
  quietHours: z
    .object({ enabled: z.boolean(), from: timeOfDay, to: timeOfDay })
    .catch({ enabled: false, from: '19:00', to: '08:00' }),
});
export type ProfilePrefs = z.infer<typeof profilePrefsSchema>;

export const DEFAULT_PROFILE_PREFS: ProfilePrefs = profilePrefsSchema.parse({});

const PHONE_RE = /^[+()\d\s.-]{5,32}$/;

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80).optional(),
    title: z.string().trim().max(80).nullable().optional(),
    timezone: z.string().trim().max(64).nullable().optional(),
    image: z
      .string()
      .max(200)
      .regex(/^\/api\/v1\/assets\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/, 'Upload the photo first')
      .nullable()
      .optional(),
    phone: z
      .string()
      .trim()
      .max(32)
      .refine((value) => value === '' || PHONE_RE.test(value), 'Enter a valid phone number')
      .nullable()
      .optional(),
    location: z.string().trim().max(80).nullable().optional(),
    locale: z.enum(LOCALE_VALUES).optional(),
    dateFormat: z.enum(DATE_FORMATS).optional(),
    weekStart: z.enum(['sunday', 'monday']).optional(),
    timeFormat: z.enum(['12h', '24h']).optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    notifications: z.partialRecord(z.enum(EVENT_KEYS), channelPrefSchema.partial()).optional(),
    emailDigest: z.enum(['instant', 'daily', 'weekly', 'off']).optional(),
    quietHours: z.object({ enabled: z.boolean(), from: timeOfDay, to: timeOfDay }).optional(),
  })
  .strict();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export interface ProfileDto {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly image: string | null;
    readonly title: string | null;
    readonly timezone: string | null;
    readonly createdAt: string;
  };
  readonly role: OrgRole;
  readonly prefs: ProfilePrefs;
}

export interface UploadedAssetDto {
  readonly url: string;
  readonly mime: string;
  readonly size: number;
}

/** Mirrors `src/server/auth/options.ts` (kept client-safe; equality is unit tested). */
export const PASSWORD_POLICY = {
  minLength: 10,
  maxLength: 128,
  sessionDays: 14,
  refreshHours: 24,
  revokeOnReset: true,
} as const;
