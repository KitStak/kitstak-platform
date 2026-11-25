/**
 * Invite-members rules (pure): parse pasted address lists ("Ana <ana@x.com>, bo@y.io"),
 * validate, dedupe against existing invitees, and pick the roles the inviter may grant.
 */
import { z } from 'zod';
import type { OrgRole } from '@/server/rbac/permissions';

export const MAX_INVITEES = 50;
const emailSchema = z.email().max(320);

export type InviteRole = Exclude<OrgRole, 'owner'>;

export interface InviteRoleOption {
  readonly value: InviteRole;
  readonly label: string;
  readonly description: string;
}

export const INVITE_ROLES: readonly InviteRoleOption[] = [
  { value: 'member', label: 'Member', description: 'Create and edit boards' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access' },
  { value: 'guest', label: 'Guest', description: 'Only boards shared with them' },
  { value: 'admin', label: 'Admin', description: 'Manage members and settings' },
];

/** Roles the current user can hand out (admins and owners can invite admins). */
export function grantableRoles(myRole: OrgRole): readonly InviteRoleOption[] {
  const canGrantAdmin = myRole === 'owner' || myRole === 'admin';
  return INVITE_ROLES.filter((option) => option.value !== 'admin' || canGrantAdmin);
}

export interface Invitee {
  readonly email: string;
  readonly role: InviteRole;
  /** Display name when pasted as "Ana Ruiz <ana@x.com>". */
  readonly name?: string;
}

const ROLE_LABELS: Readonly<Record<OrgRole, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
  guest: 'Guest',
};

/** Human label for any org role (owner included), never the raw lowercase value. */
export function roleLabel(role: string | null | undefined): string {
  return role && role in ROLE_LABELS ? ROLE_LABELS[role as OrgRole] : 'Member';
}

/** One-line "Member: can create and edit boards" hint for the role picker. */
export function roleHint(role: InviteRole): string {
  const option = INVITE_ROLES.find((item) => item.value === role);
  return option ? `${option.label}: ${option.description.charAt(0).toLowerCase()}${option.description.slice(1)}` : '';
}

export function isValidEmail(value: string): boolean {
  return emailSchema.safeParse(value).success;
}

export interface AddressEntry {
  readonly email: string;
  readonly name?: string;
}

/** Like splitAddresses, but keeps the display name of "Name <address>" entries, in input order. */
export function splitEntries(raw: string): AddressEntry[] {
  const entries: AddressEntry[] = [];
  for (const segment of raw.split(/[,;\n]+/)) {
    const match = /^([^<>]*)<([^>]+)>(.*)$/.exec(segment);
    if (!match) {
      for (const email of splitAddresses(segment)) entries.push({ email });
      continue;
    }
    const [, before = '', address = '', after = ''] = match;
    const email = address.trim().replace(/^mailto:/i, '').toLowerCase();
    const tokens = before.trim().split(/\s+/).filter(Boolean);
    const lastAddress = tokens.reduce((last, token, index) => (token.includes('@') ? index : last), -1);
    for (const leading of splitAddresses(tokens.slice(0, lastAddress + 1).join(' '))) entries.push({ email: leading });
    const name = tokens.slice(lastAddress + 1).join(' ').replace(/^"|"$/g, '').trim();
    entries.push(name ? { email, name: name.slice(0, 120) } : { email });
    for (const extra of splitAddresses(after)) entries.push({ email: extra });
  }
  return entries;
}

/** Split raw input into candidate addresses, unwrapping "Name <address>" forms. */
export function splitAddresses(raw: string): string[] {
  const unwrapped = raw.replace(/[^<>,;\n]*<([^>]+)>/g, ' $1 ');
  return unwrapped
    .split(/[\s,;]+/)
    .map((part) => part.trim().replace(/^mailto:/i, '').toLowerCase())
    .filter(Boolean);
}

export interface ParsedAddresses {
  readonly added: readonly Invitee[];
  readonly invalid: readonly string[];
  readonly duplicates: readonly string[];
  /** Addresses of people who already belong to the organization. */
  readonly members: readonly string[];
  /** Addresses dropped because the list is full. */
  readonly overflow: number;
  /** The signed-in user's own address was entered. */
  readonly self?: boolean;
}

export function parseInvitees(
  raw: string,
  existing: readonly Invitee[],
  role: InviteRole,
  blocked: ReadonlySet<string> = new Set(),
  members: ReadonlySet<string> = new Set(),
  selfEmail?: string | null,
): ParsedAddresses {
  const me = selfEmail?.trim().toLowerCase() || null;
  let self = false;
  const known = new Set(existing.map((invitee) => invitee.email));
  const added: Invitee[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const alreadyMembers: string[] = [];
  let overflow = 0;
  for (const { email: address, name } of splitEntries(raw)) {
    if (!isValidEmail(address)) {
      invalid.push(address);
      continue;
    }
    if (me && address === me) {
      self = true;
      continue;
    }
    if (members.has(address)) {
      alreadyMembers.push(address);
      continue;
    }
    if (known.has(address) || blocked.has(address)) {
      duplicates.push(address);
      continue;
    }
    if (existing.length + added.length >= MAX_INVITEES) {
      overflow += 1;
      continue;
    }
    known.add(address);
    added.push(name ? { email: address, role, name } : { email: address, role });
  }
  return { added, invalid, duplicates, members: alreadyMembers, overflow, ...(self ? { self } : {}) };
}

export function describeParseProblems(parsed: ParsedAddresses): string | null {
  const messages: string[] = [];
  if (parsed.invalid.length === 1) messages.push(`“${parsed.invalid[0]}” isn’t a valid email address.`);
  else if (parsed.invalid.length > 1) messages.push(`${parsed.invalid.length} addresses aren’t valid: ${parsed.invalid.join(', ')}.`);
  if (parsed.duplicates.length > 0)
    messages.push(
      parsed.duplicates.length === 1
        ? `${parsed.duplicates[0]} is already on the list.`
        : `${parsed.duplicates.length} addresses were already on the list.`,
    );
  if (parsed.members.length > 0)
    messages.push(
      parsed.members.length === 1
        ? `${parsed.members[0]} is already a member.`
        : `${parsed.members.length} people are already members.`,
    );
  if (parsed.self) messages.push('That’s you. You’re already in this organization.');
  if (parsed.overflow > 0) messages.push(`You can invite up to ${MAX_INVITEES} people at a time.`);
  return messages.length > 0 ? messages.join(' ') : null;
}

/**
 * The link "Copy link" hands out. With a Portal address it is the Portal's invite page, the one
 * page where a person joins (billing review round 5): it offers "Email me a code" when the link
 * carries no proof of the mailbox, and a copied link never carries one, because the inviter can
 * read it. Without a Portal address (the CRM running alone) it is the CRM's own accept page.
 */
export function inviteLink(origin: string, invitationId: string, portalUrl?: string | null): string {
  const portal = portalUrl?.trim().replace(/\/+$/, '') ?? '';
  if (portal !== '') return `${portal}/invite/${encodeURIComponent(invitationId)}`;
  return `${origin.replace(/\/$/, '')}/welcome/invite/${encodeURIComponent(invitationId)}`;
}

/** "in 6 days" / "today" for invitation expiry. */
export function expiresIn(expiresAt: string, now = Date.now()): string {
  const days = Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000);
  if (!Number.isFinite(days)) return '';
  if (days <= 0) return 'Expired';
  if (days === 1) return 'Expires tomorrow';
  return `Expires in ${days} days`;
}
