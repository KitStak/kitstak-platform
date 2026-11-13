/**
 * Pure helpers for the admin module: org metadata (de)serialization, deactivated-member role
 * encoding, IP allow-list matching, email-domain policy, user-agent parsing and CSV output.
 * No I/O; safe on client and server; fully unit tested (admin-policy.test.ts).
 */
import { isOrgRole, type OrgRole } from '@/server/rbac/permissions';
import {
  DEFAULT_ORG_SETTINGS,
  DEFAULT_PROFILE_PREFS,
  orgSettingsSchema,
  profilePrefsSchema,
  type DeviceInfo,
  type OrgSettings,
  type ProfilePrefs,
} from './admin-contracts';

// ---------------------------------------------------------------------------------------------
// Organization metadata: a JSON string owned by several writers. KitStak settings live under
// the `kitstak` key; every other key is preserved untouched on write.
// ---------------------------------------------------------------------------------------------

export interface KitstakMetadata {
  readonly settings: OrgSettings;
  readonly profiles: Readonly<Record<string, ProfilePrefs>>;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseMetadataJson(raw: string | null | undefined): JsonObject {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function readKitstakMetadata(raw: string | null | undefined): KitstakMetadata {
  const root = parseMetadataJson(raw);
  const section = isObject(root.kitstak) ? root.kitstak : {};
  const settings = orgSettingsSchema.parse(isObject(section.settings) ? section.settings : {});
  const profiles: Record<string, ProfilePrefs> = {};
  if (isObject(section.profiles)) {
    for (const [userId, value] of Object.entries(section.profiles)) {
      profiles[userId] = profilePrefsSchema.parse(isObject(value) ? value : {});
    }
  }
  return { settings, profiles };
}

/** Returns the new metadata JSON string with the `kitstak` section replaced. */
export function writeKitstakMetadata(raw: string | null | undefined, next: KitstakMetadata): string {
  const root = parseMetadataJson(raw);
  return JSON.stringify({ ...root, kitstak: { settings: next.settings, profiles: next.profiles } });
}

/** Key under which KitStak keeps its private org settings and member preferences. */
export const KITSTAK_METADATA_KEY = 'kitstak';

function withoutKitstak(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== KITSTAK_METADATA_KEY));
}

function redactMetadataValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const root = parseMetadataJson(value);
    if (!(KITSTAK_METADATA_KEY in root)) return value;
    return JSON.stringify(withoutKitstak(root));
  }
  if (isObject(value) && KITSTAK_METADATA_KEY in value) return withoutKitstak(value);
  return value;
}

/**
 * Deep copy of an auth API payload with the private `kitstak` section removed from every
 * `metadata` field (string or parsed object). Used by the Better Auth after-hook so organization
 * endpoints never expose security policy or other members' preferences.
 */
export function redactOrgMetadata<T>(payload: T, depth = 0): T {
  if (depth > 6 || payload === null || typeof payload !== 'object') return payload;
  if (payload instanceof Date) return payload;
  if (Array.isArray(payload)) return payload.map((entry) => redactOrgMetadata(entry, depth + 1)) as T;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(payload as JsonObject)) {
    out[key] = key === 'metadata' ? redactMetadataValue(value) : redactOrgMetadata(value, depth + 1);
  }
  return out as T;
}

/** True when a metadata write would touch the private `kitstak` section. */
export function metadataTouchesKitstak(metadata: unknown): boolean {
  if (typeof metadata === 'string') return KITSTAK_METADATA_KEY in parseMetadataJson(metadata);
  return isObject(metadata) && KITSTAK_METADATA_KEY in metadata;
}

export function mergeSettings(current: OrgSettings, patch: Partial<OrgSettings>): OrgSettings {
  return orgSettingsSchema.parse({ ...DEFAULT_ORG_SETTINGS, ...current, ...patch });
}

export function profileFor(meta: KitstakMetadata, userId: string): ProfilePrefs {
  return meta.profiles[userId] ?? DEFAULT_PROFILE_PREFS;
}

// ---------------------------------------------------------------------------------------------
// Deactivated members: `member.role` becomes `deactivated:<previous role>`. `parseRoles` drops
// unknown role strings, so a deactivated member resolves to no role and every org-scoped
// request fails closed (no membership) without touching the auth layer.
// ---------------------------------------------------------------------------------------------

const DEACTIVATED_PREFIX = 'deactivated:';

export function encodeDeactivatedRole(previous: OrgRole): string {
  return `${DEACTIVATED_PREFIX}${previous}`;
}

export function decodeMemberRole(raw: string): { role: OrgRole; deactivated: boolean } {
  if (raw.startsWith(DEACTIVATED_PREFIX)) {
    const previous = raw.slice(DEACTIVATED_PREFIX.length);
    return { role: isOrgRole(previous) ? previous : 'member', deactivated: true };
  }
  const roles = raw
    .split(',')
    .map((role) => role.trim())
    .filter(isOrgRole);
  const rank: Record<OrgRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1, guest: 0 };
  const role = [...roles].sort((a, b) => rank[b] - rank[a])[0] ?? 'guest';
  return { role, deactivated: false };
}

// ---------------------------------------------------------------------------------------------
// IP allow-list
// ---------------------------------------------------------------------------------------------

function parseIpv4(value: string): bigint | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let out = BigInt(0);
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = (out << BigInt(8)) | BigInt(n);
  }
  return out;
}

function parseIpv6(value: string): bigint | null {
  let input = value.toLowerCase();
  // IPv4-mapped / embedded tail (::ffff:1.2.3.4)
  const v4Tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(input);
  if (v4Tail?.[1]) {
    const v4 = parseIpv4(v4Tail[1]);
    if (v4 === null) return null;
    const hi = Number((v4 >> BigInt(16)) & BigInt(0xffff)).toString(16);
    const lo = Number(v4 & BigInt(0xffff)).toString(16);
    input = `${input.slice(0, input.length - v4Tail[1].length)}${hi}:${lo}`;
  }
  const halves = input.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  let out = BigInt(0);
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    out = (out << BigInt(16)) | BigInt(parseInt(group, 16));
  }
  return out;
}

interface ParsedIp {
  readonly version: 4 | 6;
  readonly value: bigint;
}

/** Parses an address, unwrapping IPv4-mapped IPv6 (`::ffff:a.b.c.d`) to IPv4. */
export function parseIp(raw: string): ParsedIp | null {
  const value = raw.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const v4 = parseIpv4(value);
  if (v4 !== null) return { version: 4, value: v4 };
  const v6 = parseIpv6(value);
  if (v6 === null) return null;
  if (v6 >> BigInt(32) === BigInt(0xffff)) return { version: 4, value: v6 & BigInt(0xffffffff) };
  return { version: 6, value: v6 };
}

export interface ParsedRule {
  readonly version: 4 | 6;
  readonly network: bigint;
  readonly prefix: number;
}

export function parseIpRule(raw: string): ParsedRule | null {
  const [address, prefixText] = raw.trim().split('/');
  if (!address) return null;
  const ip = parseIp(address);
  if (!ip) return null;
  const bits = ip.version === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;
  if (prefixText !== undefined && !/^\d{1,3}$/.test(prefixText)) return null;
  const mask = prefix === 0 ? BigInt(0) : ((BigInt(1) << BigInt(prefix)) - BigInt(1)) << BigInt(bits - prefix);
  return { version: ip.version, network: ip.value & mask, prefix };
}

export function ipMatchesRule(ip: string, rule: string): boolean {
  const address = parseIp(ip);
  const parsed = parseIpRule(rule);
  if (!address || !parsed || address.version !== parsed.version) return false;
  const bits = parsed.version === 4 ? 32 : 128;
  const mask = parsed.prefix === 0 ? BigInt(0) : ((BigInt(1) << BigInt(parsed.prefix)) - BigInt(1)) << BigInt(bits - parsed.prefix);
  return (address.value & mask) === parsed.network;
}

export function ipAllowed(ip: string | null, rules: readonly string[]): boolean {
  if (!ip) return false;
  return rules.some((rule) => ipMatchesRule(ip, rule));
}

/** Rules that are syntactically valid; used to report bad entries back to the admin. */
export function invalidIpRules(rules: readonly string[]): string[] {
  return rules.filter((rule) => parseIpRule(rule) === null);
}

// ---------------------------------------------------------------------------------------------
// Email domain policy
// ---------------------------------------------------------------------------------------------

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase();
}

/** An empty list allows every domain. Subdomains of an allowed domain are allowed. */
export function emailDomainAllowed(email: string, domains: readonly string[]): boolean {
  if (domains.length === 0) return true;
  const domain = emailDomain(email);
  if (!domain) return false;
  return domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

// ---------------------------------------------------------------------------------------------
// User agent → device
// ---------------------------------------------------------------------------------------------

export function parseUserAgent(ua: string | null | undefined): DeviceInfo {
  if (!ua) return { browser: 'Unknown browser', os: 'Unknown OS', kind: 'unknown' };
  const text = ua;
  let kind: DeviceInfo['kind'] = 'desktop';
  if (/bot|crawl|spider|headless|playwright|curl|wget|node/i.test(text)) kind = 'bot';
  else if (/ipad|tablet/i.test(text)) kind = 'tablet';
  else if (/mobi|iphone|android/i.test(text)) kind = 'mobile';

  let browser = 'Unknown browser';
  const match = (re: RegExp) => re.exec(text)?.[1];
  if (/playwright/i.test(text)) browser = `Playwright ${match(/Playwright\/(\d+)/i) ?? ''}`.trim();
  else if (/edg\//i.test(text)) browser = `Edge ${match(/Edg\/(\d+)/) ?? ''}`.trim();
  else if (/opr\//i.test(text)) browser = `Opera ${match(/OPR\/(\d+)/) ?? ''}`.trim();
  else if (/firefox\//i.test(text)) browser = `Firefox ${match(/Firefox\/(\d+)/) ?? ''}`.trim();
  else if (/chrome\//i.test(text)) browser = `Chrome ${match(/Chrome\/(\d+)/) ?? ''}`.trim();
  else if (/safari\//i.test(text) && /version\//i.test(text))
    browser = `Safari ${match(/Version\/(\d+)/) ?? ''}`.trim();
  else if (/curl\//i.test(text)) browser = 'curl';

  let os = 'Unknown OS';
  if (/windows nt/i.test(text)) os = 'Windows';
  else if (/iphone|ipad|ios/i.test(text)) os = 'iOS';
  else if (/mac os x|macintosh/i.test(text)) os = 'macOS';
  else if (/android/i.test(text)) os = 'Android';
  else if (/cros/i.test(text)) os = 'ChromeOS';
  else if (/linux/i.test(text)) os = 'Linux';
  return { browser, os, kind };
}

// ---------------------------------------------------------------------------------------------
// CSV (RFC 4180) with spreadsheet formula-injection protection
// ---------------------------------------------------------------------------------------------

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  // BOM so Excel detects UTF-8.
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------------------------
// Trash retention
// ---------------------------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export function purgeDate(deletedAt: Date, retentionDays: number): Date {
  return new Date(deletedAt.getTime() + retentionDays * DAY_MS);
}

export function daysUntil(target: Date | string, now: Date = new Date()): number {
  const time = typeof target === 'string' ? new Date(target).getTime() : target.getTime();
  return Math.max(0, Math.ceil((time - now.getTime()) / DAY_MS));
}

// ---------------------------------------------------------------------------------------------
// Audit categories
// ---------------------------------------------------------------------------------------------

export function auditCategoryPrefixes(category: string): string[] {
  switch (category) {
    case 'security':
      return ['security.', 'session.', 'auth.forbidden', 'org.policy'];
    case 'data':
      return ['data.', 'export.', 'import.'];
    default:
      return [`${category}.`];
  }
}

/** Curated, human labels for audit action keys (monday-style readable sentences). */
export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  'auth.forbidden': 'Access denied',
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'member.invited': 'Invited a member',
  'member.invited_bulk': 'Invited several members',
  'member.invitation_revoked': 'Revoked an invitation',
  'member.invitation_resent': 'Resent an invitation',
  'member.role_changed': 'Changed a role',
  'member.removed': 'Removed a member',
  'member.deactivated': 'Deactivated a member',
  'member.reactivated': 'Reactivated a member',
  'team.created': 'Created a team',
  'team.updated': 'Renamed a team',
  'team.deleted': 'Deleted a team',
  'team.owners_changed': 'Changed team owners',
  'org.updated': 'Updated organization settings',
  'org.policy_updated': 'Updated security & permission policy',
  'org.created': 'Created the organization',
  'api_token.created': 'Created an API token',
  'api_token.revoked': 'Revoked an API token',
  'session.revoked': 'Signed out a session',
  'board.created': 'Created a board',
  'board.deleted': 'Moved a board to trash',
  'board.lifecycle': 'Changed board lifecycle',
  'automation.created': 'Created an automation',
  'automation.updated': 'Edited an automation',
  'automation.deleted': 'Deleted an automation',
  'webhook.created': 'Added a webhook',
  'webhook.updated': 'Edited a webhook',
  'webhook.deleted': 'Removed a webhook',
  'webhook.delivery': 'Webhook delivery attempt',
  'data.exported': 'Exported data',
  'data.imported': 'Imported data',
  'data.import.prepared': 'Prepared an import',
  'data.import.batch': 'Imported a batch of rows',
  'data.import.completed': 'Finished an import',
  'data.import.undone': 'Undid an import',
  'crm.lead_converted': 'Lead converted to deal',
  'crm.pipeline_settings_updated': 'Updated pipeline settings',
  'form.publish_changed': 'Changed form publishing',
  'trash.restored': 'Restored from trash',
  'trash.purged': 'Permanently deleted from trash',
  'trash.retention_purged': 'Trash auto-emptied after 30 days',
  'profile.updated': 'Updated their profile',
};

/** Human sentence for an audit action (`member.role_changed` → "Changed a role"). */
export function describeAuditAction(action: string): string {
  const known = AUDIT_ACTION_LABELS[action];
  if (known) return known;
  // Unknown keys: drop the namespace and humanise the verb phrase ("crm.deal_won" → "Deal won").
  const tail = action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
  const words = tail.replace(/[._]+/g, ' ').trim() || action;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Readable labels for well-known audit metadata keys. */
export const AUDIT_DETAIL_LABELS: Readonly<Record<string, string>> = {
  ok: 'Succeeded',
  kind: 'Kind',
  error: 'Error',
  event: 'Event',
  status: 'HTTP status',
  attempt: 'Attempt',
  durationMs: 'Duration',
  method: 'Method',
  path: 'Path',
  role: 'Role',
  from: 'From',
  to: 'To',
  previousRole: 'Previous role',
  rows: 'Rows',
  count: 'Count',
  format: 'Format',
  filters: 'Filters',
  fileName: 'File',
  created: 'Created',
  updated: 'Updated',
  failed: 'Failed',
  batchId: 'Batch',
  scopes: 'Scopes',
  via: 'Via',
  tokenId: 'Token',
  entries: 'Entries',
  boards: 'Boards',
  groups: 'Groups',
  items: 'Items',
  retentionDays: 'Retention (days)',
  cutoff: 'Deleted before',
  email: 'Email',
  emails: 'Emails',
  name: 'Name',
  reason: 'Reason',
};

/** Raw payload keys that are hidden from the key/value list (still shown under "Raw payload"). */
const AUDIT_HIDDEN_DETAILS = new Set(['requestBody', 'responseBody', 'boardNames']);

function humanKey(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function humanValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'durationMs' && typeof value === 'number') return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === 'string' || typeof entry === 'number')) {
      return value.length === 0 ? 'None' : value.length > 5 ? `${value.length} entries` : value.join(', ');
    }
    return `${value.length} ${value.length === 1 ? 'entry' : 'entries'}`;
  }
  if (typeof value === 'object') {
    const pairs = Object.entries(value as Record<string, unknown>).filter(([, inner]) => inner !== undefined && inner !== null);
    if (pairs.length === 0) return 'None';
    return pairs.map(([innerKey, inner]) => `${AUDIT_DETAIL_LABELS[innerKey] ?? humanKey(innerKey)}: ${typeof inner === 'object' ? JSON.stringify(inner) : String(inner)}`).join(' · ');
  }
  return String(value);
}

/** Metadata → readable key/value rows (known keys translated, payload blobs hidden). */
export function humanizeAuditDetails(metadata: Record<string, unknown>): Array<{ key: string; label: string; value: string }> {
  return Object.entries(metadata)
    .filter(([key]) => !AUDIT_HIDDEN_DETAILS.has(key))
    .map(([key, value]) => ({ key, label: AUDIT_DETAIL_LABELS[key] ?? humanKey(key), value: humanValue(key, value) }));
}
