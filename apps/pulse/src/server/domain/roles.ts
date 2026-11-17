/**
 * People and roles (SPEC section 3): who has which Pulse role, the per person "sees money"
 * switch, and "Run Pulse for this workspace" when nobody owns Pulse yet.
 */
import 'server-only';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { memberRoles } from '@/server/db/schema';
import { conflict, forbidden, invalid, notFound } from '@/server/errors';
import { isPulseRole, type PulseRole } from '@/lib/permissions';
import type { MemberRoleDTO, OrgPerson, RunPulseDTO } from '@/lib/types';
import { inTx, type DomainContext } from './_shared';
import { freshPulseAccess, pulseAccessFor, requirePulse, resolveAccess, wmsRolesByEmail, type PulseAccess } from './access';
import { logActivity } from './activity';
import { listOrgPeople } from './people';
import { loadSettings } from './settings';

export interface ResolvedMember {
  readonly person: OrgPerson;
  readonly access: PulseAccess;
  readonly hasKioskPin: boolean;
}

/** Everyone in the org with their resolved Pulse access (one read per source, no query per person). */
export async function resolveAllAccess(ctx: DomainContext, executor: Executor = db): Promise<ResolvedMember[]> {
  const [people, explicit, wms, settings] = await Promise.all([
    listOrgPeople(ctx, executor),
    executor.select().from(memberRoles).where(eq(memberRoles.orgId, ctx.orgId)),
    wmsRolesByEmail(ctx.orgId),
    loadSettings(ctx.orgId, executor),
  ]);
  const byUser = new Map(explicit.map((row) => [row.userId, row]));
  const fallback = isPulseRole(settings.defaultMemberRole) ? settings.defaultMemberRole : 'none';
  return people.map((person) => {
    const row = byUser.get(person.id);
    const access = resolveAccess({
      explicit: row ? { role: row.role, seesMoney: row.seesMoney } : null,
      wmsRole: row ? null : (wms.get(person.email.toLowerCase()) ?? null),
      orgRole: person.orgRole,
      defaultMemberRole: fallback,
    });
    return { person, access, hasKioskPin: Boolean(row?.kioskPinHash) };
  });
}

function toDTO(member: ResolvedMember): MemberRoleDTO {
  return {
    id: member.person.id,
    name: member.person.name,
    email: member.person.email,
    image: member.person.image,
    orgRole: member.person.orgRole,
    role: member.access.role,
    source: member.access.source === 'system' ? 'org' : member.access.source,
    seesMoneySwitch: member.access.seesMoneySwitch,
    seesMoney: member.access.seesMoney,
    seesWages: member.access.seesWages,
    hasKioskPin: member.hasKioskPin,
  };
}

export async function listMemberRoles(ctx: DomainContext): Promise<MemberRoleDTO[]> {
  await requirePulse(ctx, 'roles:manage');
  return (await resolveAllAccess(ctx)).map(toDTO);
}

/** User ids of the people whose Pulse role is in `roles` (alert fan out). */
export async function userIdsWithRoles(ctx: DomainContext, roles: readonly string[], executor: Executor = db): Promise<Map<string, PulseAccess>> {
  const out = new Map<string, PulseAccess>();
  for (const member of await resolveAllAccess(ctx, executor)) if (roles.includes(member.access.role)) out.set(member.person.id, member.access);
  return out;
}

/**
 * Sets a person's explicit Pulse role and money switch. Only an owner may make or unmake an
 * owner, and the last owner cannot be removed.
 */
export async function setMemberRole(ctx: DomainContext, userId: string, patch: { role?: PulseRole; seesMoney?: boolean }): Promise<MemberRoleDTO> {
  const actor = await requirePulse(ctx, 'roles:manage');
  return inTx(async (tx) => {
    const members = await resolveAllAccess(ctx, tx);
    const target = members.find((member) => member.person.id === userId);
    if (!target) throw notFound('That person');
    const nextRole = patch.role ?? target.access.role;
    const touchesOwner = target.access.role === 'owner' || nextRole === 'owner';
    if (touchesOwner && nextRole !== target.access.role && actor.role !== 'owner') throw forbidden('Only the owner of Pulse can make or remove an owner.');
    if (target.access.role === 'owner' && nextRole !== 'owner' && members.filter((member) => member.access.role === 'owner').length <= 1) {
      throw conflict('Pulse needs at least one owner. Make someone else the owner first.');
    }
    const seesMoney = patch.seesMoney ?? target.access.seesMoneySwitch;
    await tx
      .insert(memberRoles)
      .values({ orgId: ctx.orgId, userId, role: nextRole, seesMoney, updatedBy: ctx.userId })
      .onConflictDoUpdate({ target: [memberRoles.orgId, memberRoles.userId], set: { role: nextRole, seesMoney, updatedBy: ctx.userId, updatedAt: new Date() } });
    if (nextRole !== target.access.role || target.access.source !== 'explicit') {
      await logActivity(tx, ctx, { verb: 'role.changed', entityType: 'member_role', entityId: userId, before: { role: target.access.role, source: target.access.source }, after: { role: nextRole } });
    }
    if (seesMoney !== target.access.seesMoneySwitch) {
      await logActivity(tx, ctx, { verb: 'money_access.changed', entityType: 'member_role', entityId: userId, before: { seesMoney: target.access.seesMoneySwitch }, after: { seesMoney } });
    }
    const after = (await resolveAllAccess(ctx, tx)).find((member) => member.person.id === userId)!;
    return toDTO(after);
  });
}

/** Removes the explicit row, so the person's role follows the warehouse or the org role again. */
export async function clearMemberRole(ctx: DomainContext, userId: string): Promise<MemberRoleDTO> {
  const actor = await requirePulse(ctx, 'roles:manage');
  return inTx(async (tx) => {
    const members = await resolveAllAccess(ctx, tx);
    const target = members.find((member) => member.person.id === userId);
    if (!target) throw notFound('That person');
    if (target.access.role === 'owner' && actor.role !== 'owner') throw forbidden('Only the owner of Pulse can make or remove an owner.');
    await tx.delete(memberRoles).where(and(eq(memberRoles.orgId, ctx.orgId), eq(memberRoles.userId, userId)));
    const after = (await resolveAllAccess(ctx, tx)).find((member) => member.person.id === userId)!;
    if (target.access.role === 'owner' && after.access.role !== 'owner' && members.filter((member) => member.access.role === 'owner').length <= 1) {
      throw conflict('Pulse needs at least one owner. Make someone else the owner first.');
    }
    await logActivity(tx, ctx, { verb: 'role.changed', entityType: 'member_role', entityId: userId, before: { role: target.access.role, source: 'explicit' }, after: { role: after.access.role, source: after.access.source } });
    return toDTO(after);
  });
}

async function runState(ctx: DomainContext, executor: Executor = db): Promise<{ state: RunPulseDTO; members: ResolvedMember[] }> {
  const members = await resolveAllAccess(ctx, executor);
  const owners = members.filter((member) => member.access.role === 'owner');
  const admins = members.filter((member) => member.access.role === 'admin');
  const me = members.find((member) => member.person.id === ctx.userId);
  // Nobody is an admin by accident: the first admin may take it, or any member when there is no admin either.
  const canClaim = owners.length === 0 && Boolean(me) && (me!.access.role === 'admin' || (admins.length === 0 && me!.person.orgRole === 'member'));
  return { state: { hasOwner: owners.length > 0, canClaim, ownerNames: owners.map((member) => member.person.name) }, members };
}

/** Is there a Pulse owner yet, and may this person take the job? Open to every member (it gates the welcome screen). */
export async function whoRunsPulse(ctx: DomainContext): Promise<RunPulseDTO> {
  return (await runState(ctx)).state;
}

/** "Run Pulse for this workspace": writes an explicit owner row for the caller when nobody owns Pulse yet. */
export async function claimPulseOwnership(ctx: DomainContext): Promise<MemberRoleDTO> {
  return inTx(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`pulse-owner:${ctx.orgId}`}))`);
    const { state, members } = await runState(ctx, tx);
    if (!state.canClaim) throw forbidden(state.hasOwner ? 'Someone already runs Pulse for this workspace. Ask them for a role.' : 'Ask an admin of your workspace to set up Pulse.');
    const before = members.find((member) => member.person.id === ctx.userId)!;
    await tx
      .insert(memberRoles)
      .values({ orgId: ctx.orgId, userId: ctx.userId, role: 'owner', seesMoney: true, updatedBy: ctx.userId })
      .onConflictDoUpdate({ target: [memberRoles.orgId, memberRoles.userId], set: { role: 'owner', seesMoney: true, updatedBy: ctx.userId, updatedAt: new Date() } });
    await logActivity(tx, ctx, { verb: 'role.changed', entityType: 'member_role', entityId: ctx.userId, before: { role: before.access.role }, after: { role: 'owner' }, meta: { claimed: true } });
    const after = (await resolveAllAccess(ctx, tx)).find((member) => member.person.id === ctx.userId)!;
    return toDTO(after);
  });
}

/** The caller's own access, read fresh (after a claim or a role change in the same request). */
export async function myAccess(ctx: DomainContext, fresh = false): Promise<PulseAccess> {
  return fresh ? freshPulseAccess(ctx) : pulseAccessFor(ctx);
}

/** Sets or clears a person's 4 digit kiosk PIN (stored as a salted scrypt hash). */
export async function setKioskPin(ctx: DomainContext, userId: string, pin: string | null): Promise<void> {
  await requirePulse(ctx, 'roles:manage');
  if (pin !== null && !/^\d{4}$/.test(pin)) throw invalid('A kiosk PIN is 4 digits.', { pin: 'Type 4 digits.' });
  await inTx(async (tx) => {
    const members = await resolveAllAccess(ctx, tx);
    const target = members.find((member) => member.person.id === userId);
    if (!target) throw notFound('That person');
    const salt = randomBytes(16);
    const hash = pin === null ? null : `${salt.toString('hex')}:${scryptSync(pin, salt, 32).toString('hex')}`;
    await tx
      .insert(memberRoles)
      .values({ orgId: ctx.orgId, userId, role: target.access.role, seesMoney: target.access.seesMoneySwitch, kioskPinHash: hash, updatedBy: ctx.userId })
      .onConflictDoUpdate({ target: [memberRoles.orgId, memberRoles.userId], set: { kioskPinHash: hash, updatedBy: ctx.userId, updatedAt: new Date() } });
    await logActivity(tx, ctx, { verb: 'role.changed', entityType: 'member_role', entityId: userId, meta: { kioskPin: pin === null ? 'cleared' : 'set' } });
  });
}

/** Checks a kiosk PIN against the stored hash in constant time. */
export function verifyKioskPin(stored: string | null, pin: string): boolean {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
