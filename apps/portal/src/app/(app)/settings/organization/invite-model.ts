/**
 * The pure parts of the invite form: reading several addresses from one field, and the one line
 * that says what sending does to the plan before anything is sent (docs/billing/SPEC.md 6.9).
 */
import { z } from 'zod';

/** Roles a person can be invited with. Admin, member and viewer use a seat. Guest is free. */
export const INVITE_ROLES = ['admin', 'member', 'viewer', 'guest'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const ROLE_LABEL: Readonly<Record<InviteRole, string>> = { admin: 'Admin', member: 'Member', viewer: 'Viewer', guest: 'Guest' };

/** True when a person with this role does not use a seat (`CATALOG.freeRoles` in @kitstak/billing). */
export function isFreeInviteRole(role: InviteRole): boolean {
  return role === 'guest';
}

export const MAX_INVITES_AT_ONCE = 20;
const emailSchema = z.email();

export type ParsedEmails =
  | { readonly ok: true; readonly emails: readonly string[] }
  | { readonly ok: false; readonly message: string };

/** Addresses split on commas, semicolons, spaces and new lines. Doubles are dropped. */
export function parseInviteEmails(text: string): ParsedEmails {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const email = part.trim();
    if (email === '') continue;
    if (!emailSchema.safeParse(email).success) {
      return { ok: false, message: emails.length === 0 && !/[\s,;]/.test(text.trim()) ? 'Enter a valid email address.' : `Check this address: ${email}` };
    }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  if (emails.length === 0) return { ok: false, message: 'Enter an email address.' };
  if (emails.length > MAX_INVITES_AT_ONCE) return { ok: false, message: `Invite up to ${MAX_INVITES_AT_ONCE} people at a time.` };
  return { ok: true, emails };
}

/** How many addresses are typed so far, right or wrong. Used for the plan line while typing. */
export function countTyped(text: string): number {
  return text.split(/[\s,;]+/).filter((part) => part.trim() !== '').length;
}

/** A person who is already in the organization. */
export interface TeamPerson {
  readonly email: string;
  readonly name: string;
}

/** The first name, or the address when there is no name: "Sam is already on your team." */
function shortName(person: TeamPerson): string {
  return person.name.trim().split(/\s+/)[0] || person.email;
}

/** The teammate who already has this address, or null. PURE. */
export function findOnTeam(email: string, team: readonly TeamPerson[]): TeamPerson | null {
  const key = email.trim().toLowerCase();
  return team.find((person) => person.email.trim().toLowerCase() === key) ?? null;
}

/**
 * The sentence for an invite the server refused, in our words. The auth layer answers "User is
 * already a member of this organization" for a teammate and a similar line for an open invite.
 * Those become "Sam is already on your team." and "... already has an invite." Anything else keeps
 * the server's sentence. PURE.
 */
export function inviteErrorWords(error: { readonly code?: string; readonly message?: string }, email: string, team: readonly TeamPerson[]): string {
  const code = (error.code ?? '').toUpperCase();
  const message = error.message ?? '';
  if (code.includes('ALREADY_A_MEMBER') || /already a member/i.test(message)) {
    const person = findOnTeam(email, team);
    return `${person ? shortName(person) : email} is already on your team.`;
  }
  if (code.includes('ALREADY_INVITED') || /already invited/i.test(message)) return `${email} already has an invite. It is in the list below.`;
  return message || 'We could not send the invite. Try again.';
}

/** "ana@x.co was not invited yet" for one, "2 people were not invited yet" for more. PURE. */
export function notInvitedYet(emails: readonly string[]): string {
  const list = emails.length <= 1 ? (emails[0] ?? '') : `${emails.slice(0, -1).join(', ')} and ${emails[emails.length - 1]}`;
  return emails.length === 1 ? `1 person was not invited yet: ${list}.` : `${emails.length} people were not invited yet: ${list}.`;
}

export interface SeatFacts {
  /** A paid plan priced per seat is live. False in a trial and with no plan: no seat limit then. */
  readonly paid: boolean;
  /** Seats the plan pays for. null when the plan has no seat limit. */
  readonly limit: number | null;
  /** Seats in use: people with a seat role, and open invites with one. */
  readonly used: number;
  /** The viewer may pay and change the plan. */
  readonly canManageBilling: boolean;
  /** The plan is Pulse alone: 5 seats are included and more cannot be bought. */
  readonly pulseOnly: boolean;
}

const people = (count: number): string => (count === 1 ? '1 person' : `${count} people`);
const seats = (count: number): string => (count === 1 ? '1 seat' : `${count} seats`);

/** One plain sentence: what sending these invites does to the plan. PURE. */
export function invitePlanLine(facts: SeatFacts, role: InviteRole, typed: number): string {
  const count = Math.max(1, typed);
  if (isFreeInviteRole(role)) return count === 1 ? 'A guest is free. This uses no seat.' : 'Guests are free. This uses no seats.';
  if (!facts.paid) return 'No seat limit during your free trial. Seats are counted when you pick a plan.';
  if (facts.limit === null) return 'Your plan has no seat limit. This does not change your bill.';
  const open = Math.max(0, facts.limit - facts.used);
  if (count <= open) return `Uses ${count} of your ${seats(open).replace('seat', 'open seat')}. Your bill stays the same.`;
  const short = count - open;
  const lead = open === 0 ? (facts.limit === 1 ? 'Your 1 seat is in use.' : `All ${facts.limit} seats are in use.`) : `You have ${seats(open).replace('seat', 'open seat')} for ${people(count)}.`;
  if (facts.pulseOnly) return `${lead} Pulse covers up to ${facts.limit} seats.`;
  if (!facts.canManageBilling) return `${lead} An owner or a billing manager can add ${short === 1 ? 'one' : 'more'}.`;
  return `${lead} We show the price and ask before we add ${seats(short)}.`;
}
