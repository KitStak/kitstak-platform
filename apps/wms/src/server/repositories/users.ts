/**
 * Users repository (M14): grid, detail, create (4-step wizard), edit, activate/deactivate
 * (bumps the session version), reset password (temporary password, forced change) and
 * session management. Role / warehouse / client links live in `user_roles`,
 * `user_warehouses` and `user_clients`; every change writes field-level `change_log`.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import type { AppDb } from '@/server/api/db';
import { AppError, fromZodError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import {
  assertIdentityManagedHere,
  clearLockoutState,
  switchOffSignIn,
  switchOnSignIn,
  findCoreUserIdByEmail,
  identityManagedHere,
  isWarehouseOrgMember,
  setCredentialPassword,
  upsertCoreIdentity,
} from '@/server/auth/credentials';
import { hashPassword } from '@/server/auth/password';
import { getPasswordPolicy, validatePassword } from '@/server/auth/password-policy';
import { hasWarehouse } from '@/server/auth/scope';
import {
  bumpSessionVersion,
  listActiveSessions,
  revokeSession,
  type SessionSummary,
} from '@/server/auth/session-store';
import { session as coreSession } from '@kitstak/db/schema';
import * as s from '@/server/db/schema';
import { runBulk } from '@/server/domain/bulk';
import type { BulkResult } from '@/server/domain/types';
import { paginate } from '@/server/query/paginate';
import type { GridQuery } from '@/server/query/grid-query';
import {
  USER_FIELDS,
  USER_SEARCH_FIELDS,
  USER_SORT_FIELDS,
  userSaveSchemaWithPolicy,
  type UserSave,
} from '@/lib/grid-defs/admin/users';
import {
  assertFound,
  assertVersion,
  compileGrid,
  domainCtxOf,
  duplicateError,
  fieldError,
  logCreate,
  logUpdate,
  qc,
  type Actor,
  type GridBinding,
} from './users-shared';

const u = s.users;
export const USER_ENTITY = 'user';

type LegacyRole = (typeof u.$inferSelect)['role'];

const roleNamesSql = sql<
  string | null
>`(SELECT string_agg((r.name)::text, ', ') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ${qc(u.id)})`;
const warehouseCodesSql = sql<
  string | null
>`(SELECT string_agg((w.code)::text, ', ') FROM user_warehouses uw JOIN warehouses w ON w.id = uw.warehouse_id WHERE uw.user_id = ${qc(u.id)})`;
const statusSql = sql<string>`CASE WHEN ${qc(u.isActive)} = true THEN 'Active' ELSE 'Inactive' END`;
const sessionCountSql = sql<number>`(SELECT COUNT(*) FROM core.session cs WHERE (cs.user_id)::text = ${qc(u.id)} AND cs.expires_at > now())`;

const USER_SQL: Readonly<Record<string, SQL>> = {
  name: sql`${qc(u.name)}`,
  email: sql`${qc(u.email)}`,
  roleId: sql`(SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = ${qc(u.id)} LIMIT 1)`,
  warehouseId: sql`(SELECT uw.warehouse_id FROM user_warehouses uw WHERE uw.user_id = ${qc(u.id)} LIMIT 1)`,
  userType: sql`${qc(u.userType)}`,
  status: statusSql,
  isApiUser: sql`${qc(u.isApiUser)}`,
  lastLoginAt: sql`${qc(u.lastLoginAt)}`,
  createdAt: sql`${qc(u.createdAt)}`,
  roleNames: roleNamesSql,
  warehouseCodes: warehouseCodesSql,
};

const BINDING: GridBinding = {
  exprs: USER_SQL,
  fields: USER_FIELDS,
  sortable: USER_SORT_FIELDS,
  search: USER_SEARCH_FIELDS,
  defaultSort: [{ field: 'name', dir: 'asc' }],
  tiebreaker: u.id,
};

/** Role / warehouse filters must match ANY linked row, not just the first one. */
function membershipFilters(query: GridQuery): { query: GridQuery; extra: SQL[] } {
  const extra: SQL[] = [];
  const rest = query.filters.filter((f) => {
    if (
      (f.field === 'roleId' || f.field === 'warehouseId') &&
      (f.op === 'in' || f.op === 'nin' || f.op === 'eq')
    ) {
      const values = 'values' in f ? [...f.values] : [f.value];
      if (values.length === 0) return false;
      const list = sql.join(
        values.map((v) => sql`${v}`),
        sql`, `,
      );
      const sub =
        f.field === 'roleId'
          ? sql`EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = ${qc(u.id)} AND ur.role_id IN (${list}))`
          : sql`EXISTS (SELECT 1 FROM user_warehouses uw WHERE uw.user_id = ${qc(u.id)} AND uw.warehouse_id IN (${list}))`;
      extra.push(f.op === 'nin' ? sql`NOT ${sub}` : sub);
      return false;
    }
    return true;
  });
  return { query: { ...query, filters: rest }, extra };
}

export interface UserRow {
  readonly id: string;
  readonly name: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string;
  readonly userType: string;
  readonly status: 'Active' | 'Inactive';
  readonly isActive: boolean;
  readonly isApiUser: boolean;
  readonly allClients: boolean;
  readonly roleNames: string | null;
  readonly warehouseCodes: string | null;
  readonly lastLoginAt: string | null;
  readonly passwordChangedAt: string | null;
  readonly lockedUntil: string | null;
  readonly activeSessions: number;
  readonly createdAt: string;
  readonly version: number;
}

const ROW_COLUMNS = {
  id: u.id,
  name: u.name,
  firstName: u.firstName,
  lastName: u.lastName,
  email: u.email,
  userType: u.userType,
  isActive: u.isActive,
  isApiUser: u.isApiUser,
  allClients: u.allClients,
  lastLoginAt: u.lastLoginAt,
  passwordChangedAt: u.passwordChangedAt,
  lockedUntil: u.lockedUntil,
  createdAt: u.createdAt,
  version: u.version,
  status: statusSql,
  roleNames: roleNamesSql,
  warehouseCodes: warehouseCodesSql,
  activeSessions: sessionCountSql,
};

function toRow(r: Record<string, unknown>): UserRow {
  return {
    ...(r as unknown as UserRow),
    isActive: Boolean(r.isActive),
    isApiUser: Boolean(r.isApiUser),
    allClients: Boolean(r.allClients),
  };
}

export async function listUsers(
  db: AppDb,
  _auth: AuthContext,
  query: GridQuery,
): Promise<{ rows: UserRow[]; total: number }> {
  const split = membershipFilters(query);
  const grid = compileGrid(BINDING, split.query, split.extra);
  const result = await paginate(
    db
      .select(ROW_COLUMNS)
      .from(u)
      .where(grid.where)
      .orderBy(...grid.orderBy)
      .$dynamic(),
    async () =>
      (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(u)
          .where(grid.where)
          .limit(1)
      )[0]?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return { rows: (result.rows as Record<string, unknown>[]).map(toRow), total: result.total };
}

export interface UserDetail extends UserRow {
  readonly roles: readonly {
    readonly id: string;
    readonly name: string;
    readonly key: string;
    readonly isSystem: boolean;
  }[];
  readonly warehouses: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  readonly clients: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  readonly roleIds: readonly string[];
  readonly warehouseIds: readonly string[];
  readonly clientIds: readonly string[];
}

export async function loadUser(db: AppDb, id: string): Promise<typeof u.$inferSelect> {
  return assertFound((await db.select().from(u).where(eq(u.id, id)).limit(1))[0], 'User');
}

export async function getUser(db: AppDb, id: string): Promise<UserDetail> {
  const row = assertFound((await db.select(ROW_COLUMNS).from(u).where(eq(u.id, id)).limit(1))[0], 'User');
  const roles = await db
    .select({ id: s.roles.id, name: s.roles.name, key: s.roles.key, isSystem: s.roles.isSystem })
    .from(s.userRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .where(eq(s.userRoles.userId, id))
    .orderBy(asc(s.roles.name));
  const warehouses = await db
    .select({ id: s.warehouses.id, code: s.warehouses.code, name: s.warehouses.name })
    .from(s.userWarehouses)
    .innerJoin(s.warehouses, eq(s.warehouses.id, s.userWarehouses.warehouseId))
    .where(eq(s.userWarehouses.userId, id))
    .orderBy(asc(s.warehouses.code));
  const clients = await db
    .select({ id: s.clients.id, code: s.clients.code, name: s.clients.name })
    .from(s.userClients)
    .innerJoin(s.clients, eq(s.clients.id, s.userClients.clientId))
    .where(eq(s.userClients.userId, id))
    .orderBy(asc(s.clients.name));
  return {
    ...toRow(row as Record<string, unknown>),
    roles: roles.map((r) => ({ ...r, isSystem: Boolean(r.isSystem) })),
    warehouses,
    clients,
    roleIds: roles.map((r) => r.id),
    warehouseIds: warehouses.map((w) => w.id),
    clientIds: clients.map((c) => c.id),
  };
}

/* ---------------- validation ---------------- */

/** Legacy `users.role` drives only the admin bypass and the no-role fallback. */
export function legacyRoleFor(roleKeys: readonly string[]): LegacyRole {
  if (roleKeys.includes('admin')) return 'admin';
  if (roleKeys.includes('manager')) return 'manager';
  if (roleKeys.includes('operator')) return 'operator';
  if (roleKeys.length > 0 && roleKeys.every((k) => k === 'viewer' || k === 'client')) return 'viewer';
  return 'operator';
}

async function resolveRoles(
  db: AppDb,
  ids: readonly string[],
): Promise<{ id: string; key: string; name: string; category: string }[]> {
  const unique = [...new Set(ids)];
  const rows = unique.length
    ? await db
        .select({ id: s.roles.id, key: s.roles.key, name: s.roles.name, category: s.roles.category })
        .from(s.roles)
        .where(inArray(s.roles.id, unique))
    : [];
  if (rows.length !== unique.length)
    throw fieldError('roleIds', 'One of the selected roles no longer exists');
  return rows;
}

async function resolveWarehouses(
  db: AppDb,
  auth: AuthContext,
  ids: readonly string[],
): Promise<{ id: string; code: string }[]> {
  const unique = [...new Set(ids)];
  for (const id of unique)
    if (!hasWarehouse(auth.scope, id))
      throw fieldError('warehouseIds', 'You can only give access to warehouses you can access');
  const rows = unique.length
    ? await db
        .select({ id: s.warehouses.id, code: s.warehouses.code })
        .from(s.warehouses)
        .where(inArray(s.warehouses.id, unique))
    : [];
  if (rows.length !== unique.length)
    throw fieldError('warehouseIds', 'One of the selected warehouses no longer exists');
  return rows;
}

async function resolveClients(db: AppDb, ids: readonly string[]): Promise<{ id: string; code: string }[]> {
  const unique = [...new Set(ids)];
  const rows = unique.length
    ? await db
        .select({ id: s.clients.id, code: s.clients.code })
        .from(s.clients)
        .where(inArray(s.clients.id, unique))
    : [];
  if (rows.length !== unique.length)
    throw fieldError('clientIds', 'One of the selected clients no longer exists');
  return rows;
}

/** True when another user (not `exceptId`) already signs in with `email` (case-insensitive). */
export async function isEmailTaken(db: AppDb, email: string, exceptId?: string): Promise<boolean> {
  const clash = (
    await db.select({ id: u.id }).from(u).where(eq(u.email, email.trim().toLowerCase())).limit(1)
  )[0];
  return Boolean(clash && clash.id !== exceptId);
}

async function assertEmailFree(db: AppDb, email: string, exceptId?: string): Promise<void> {
  if (await isEmailTaken(db, email, exceptId))
    throw duplicateError('email', `A user with ${email} already exists`);
}

/** An email change must not collide with ANY other KitStak account (core identities are shared). */
async function assertCoreEmailFree(db: AppDb, email: string, userId: string): Promise<void> {
  const holder = await findCoreUserIdByEmail(db, email);
  if (holder && holder !== userId)
    throw duplicateError('email', `${email} already belongs to another KitStak account`);
}

export async function assertPasswordPolicy(
  db: AppDb,
  password: string,
  email: string,
  field = 'password',
): Promise<void> {
  const issues = validatePassword(password, await getPasswordPolicy(db), { email });
  if (issues.length > 0)
    throw new AppError('VALIDATION', issues[0] ?? 'Password does not meet the policy', {
      fieldErrors: { [field]: issues },
    });
}

/**
 * Parses a create / edit body against the save schema AND the company password policy in one
 * pass, so the response lists every field error together (no staged validation).
 */
export async function parseUserSave(db: AppDb, mode: 'create' | 'update', raw: unknown): Promise<UserSave> {
  const policy = await getPasswordPolicy(db);
  const parsed = userSaveSchemaWithPolicy(mode, (password, email) =>
    validatePassword(password, policy, { email }),
  ).safeParse(raw);
  if (!parsed.success) throw fromZodError(parsed.error);
  return parsed.data;
}

/** Display snapshot for the change log (names, never ids). */
async function snapshot(db: AppDb, id: string): Promise<Record<string, unknown>> {
  const d = await getUser(db, id);
  return {
    name: d.name,
    firstName: d.firstName,
    lastName: d.lastName,
    email: d.email,
    userType: d.userType,
    status: d.status,
    roles: d.roles.map((r) => r.name).join(', '),
    warehouses: d.warehouses.map((w) => w.code).join(', '),
    clients: d.allClients ? 'All clients' : d.clients.map((c) => c.code).join(', '),
  };
}

async function writeLinks(
  tx: AppDb,
  userId: string,
  input: Pick<UserSave, 'roleIds' | 'warehouseIds' | 'allClients' | 'clientIds'>,
): Promise<void> {
  await tx.delete(s.userRoles).where(eq(s.userRoles.userId, userId));
  await tx.delete(s.userWarehouses).where(eq(s.userWarehouses.userId, userId));
  await tx.delete(s.userClients).where(eq(s.userClients.userId, userId));
  const roleIds = [...new Set(input.roleIds)];
  const warehouseIds = [...new Set(input.warehouseIds)];
  if (roleIds.length) await tx.insert(s.userRoles).values(roleIds.map((roleId) => ({ userId, roleId })));
  if (warehouseIds.length)
    await tx.insert(s.userWarehouses).values(warehouseIds.map((warehouseId) => ({ userId, warehouseId })));
  const clientIds = input.allClients ? [] : [...new Set(input.clientIds)];
  if (clientIds.length)
    await tx.insert(s.userClients).values(clientIds.map((clientId) => ({ userId, clientId })));
}

const displayName = (first: string, last: string): string => `${first.trim()} ${last.trim()}`.trim();

/* ---------------- commands ---------------- */

export async function createUser(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  input: UserSave,
): Promise<{ id: string; name: string; email: string }> {
  await assertEmailFree(tx, input.email);
  await assertPasswordPolicy(tx, input.password, input.email);
  const roles = await resolveRoles(tx, input.roleIds);
  await resolveWarehouses(tx, auth, input.warehouseIds);
  if (!input.allClients) await resolveClients(tx, input.clientIds);
  if (
    roles.some((r) => r.key === 'admin') &&
    !auth.roleKeys.includes('admin') &&
    auth.user.role !== 'admin'
  ) {
    throw fieldError('roleIds', 'Only an administrator can assign the Admin role');
  }
  // An existing KitStak account (e.g. invited to the org in the portal) is LINKED, keeping
  // its id, name and credential; one that belongs only to other organizations is refused.
  const existingId = await findCoreUserIdByEmail(tx, input.email);
  if (existingId && !(await isWarehouseOrgMember(tx, existingId)))
    throw fieldError(
      'email',
      'This email already has a KitStak account outside your organization. Invite them to your organization first, then add them here.',
    );
  const ownCredential = !existingId || (await identityManagedHere(tx, existingId));
  const now = new Date().toISOString();
  const legacyRole = legacyRoleFor(roles.map((r) => r.key));
  const row = (
    await tx
      .insert(u)
      .values({
        ...(existingId ? { id: existingId } : {}),
        email: input.email.toLowerCase(),
        name: displayName(input.firstName, input.lastName),
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        // Frozen legacy mirror: credentials live in core.account (blueprint §1.4).
        passwordHash: hashPassword(input.password),
        role: legacyRole,
        userType: input.userType,
        isActive: input.isActive,
        allClients: input.allClients,
        passwordChangedAt: now,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: u.id, name: u.name, email: u.email })
  )[0];
  // Shared Better Auth identity: core."user" + credential account + platform-org member +
  // wms.user_profiles, all keyed by the SAME uuid as the wms.users row.
  await upsertCoreIdentity(tx, {
    userId: row.id,
    email: row.email,
    name: row.name,
    // An inactive user must not hold a live shared credential (CRM has no is_active
    // gate); admin reset issues it on activation, mirroring updateUser/resetUserPassword.
    password: input.isActive && ownCredential ? input.password : undefined,
    legacyRole,
    userType: input.userType,
    isApiUser: false,
    allClients: input.allClients,
    passwordChangedAt: new Date(now),
  });
  // A person created inactive is switched off from the start, in every app.
  if (!input.isActive && ownCredential) await switchOffSignIn(tx, row.id, actor.userId);
  await writeLinks(tx, row.id, input);
  await logCreate(tx, domainCtxOf(actor, auth), {
    entityType: USER_ENTITY,
    entityId: row.id,
    entityCode: row.email,
  });
  return row;
}

/** Last active admin can't be removed, deactivated or demoted. */
async function assertNotLastAdmin(db: AppDb, userId: string, willStayAdmin: boolean): Promise<void> {
  if (willStayAdmin) return;
  const target = await loadUser(db, userId);
  if (target.role !== 'admin' || !target.isActive) return;
  const others =
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(u)
        .where(and(eq(u.role, 'admin'), eq(u.isActive, true), ne(u.id, userId)))
        .limit(1)
    )[0]?.n ?? 0;
  if (others === 0)
    throw new AppError(
      'INVALID_STATE',
      'This is the last active administrator. Make another user an admin first.',
    );
}

export interface UpdateUserResult {
  readonly id: string;
  readonly version: number;
  readonly sessionsRevoked: boolean;
}

export async function updateUser(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  id: string,
  input: UserSave,
): Promise<UpdateUserResult> {
  const before = await loadUser(tx, id);
  assertVersion(before.version, input.version);
  await assertEmailFree(tx, input.email, id);
  if (input.password) await assertPasswordPolicy(tx, input.password, input.email);
  // A KitStak account shared with another org keeps its own password and email.
  const managed = await identityManagedHere(tx, id);
  if (!managed && input.password)
    throw fieldError('password', "This person's KitStak account is shared with another organization; only they can change its password.");
  if (!managed && input.email.toLowerCase() !== before.email.toLowerCase())
    throw fieldError('email', "This person's KitStak account is shared with another organization; only they can change its email.");
  if (input.email.toLowerCase() !== before.email.toLowerCase()) await assertCoreEmailFree(tx, input.email, id);
  const roles = await resolveRoles(tx, input.roleIds);
  await resolveWarehouses(tx, auth, input.warehouseIds);
  if (!input.allClients) await resolveClients(tx, input.clientIds);
  const role = legacyRoleFor(roles.map((r) => r.key));
  if (role === 'admin' && before.role !== 'admin' && auth.user.role !== 'admin')
    throw fieldError('roleIds', 'Only an administrator can assign the Admin role');
  if (id === auth.user.id && !input.isActive)
    throw fieldError('isActive', "You can't deactivate your own account");
  await assertNotLastAdmin(tx, id, role === 'admin' && input.isActive);

  const prev = await snapshot(tx, id);
  const prevAccess = JSON.stringify([prev.roles, prev.warehouses, prev.clients, before.isActive]);
  await tx
    .update(u)
    .set({
      email: input.email.toLowerCase(),
      name: displayName(input.firstName, input.lastName),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      userType: input.userType,
      isActive: input.isActive,
      allClients: input.allClients,
      role,
      ...(input.password ? { passwordChangedAt: new Date().toISOString() } : {}),
      updatedBy: actor.userId,
      updatedAt: new Date().toISOString(),
      version: sql`${u.version} + 1`,
    })
    .where(eq(u.id, id));
  // Sync the shared Better Auth identity (email/name/role/profile; new credential if
  // set). NEW-2: a password submitted for a user whose RESULTING state is inactive is
  // skipped — an inactive user must never (re)gain a sign-in credential through an edit.
  await upsertCoreIdentity(tx, {
    userId: id,
    email: input.email.toLowerCase(),
    name: displayName(input.firstName, input.lastName),
    ...(input.password && input.isActive
      ? { password: input.password, passwordChangedAt: new Date() }
      : {}),
    legacyRole: role,
    userType: input.userType,
    isApiUser: before.isApiUser,
    allClients: input.allClients,
  });
  await writeLinks(tx, id, input);
  const next = await snapshot(tx, id);
  await logUpdate(
    tx,
    domainCtxOf(actor, auth),
    { entityType: USER_ENTITY, entityId: id, entityCode: input.email },
    prev,
    next,
  );
  if (input.password)
    await logUpdate(
      tx,
      domainCtxOf(actor, auth),
      { entityType: USER_ENTITY, entityId: id, entityCode: input.email },
      { password: '••••' },
      { password: 'Changed' },
    );

  // An inactive RESULTING state kills the shared credential so password sign-in dies on
  // EVERY instance (CRM included) — reactivation requires an admin password reset (auth
  // review 2026-11-11, H3). NEW-2: keyed on the resulting state, not the active→inactive
  // transition, so an edit of an ALREADY-inactive user also clears any credential a
  // concurrent writer (or an earlier bug) left behind. Runs AFTER upsertCoreIdentity so
  // a submitted password cannot resurrect the credential of an inactive user.
  // Shared accounts: deactivation is local to this warehouse (the session check rejects an
  // inactive wms.users row) — their credential and other orgs' sessions are left alone.
  // Since billing review round 4 the block row in core.sign_in_blocks is the fact every app reads:
  // without it "Forgot password" in the Portal gave a deactivated person a new password.
  if (!input.isActive && managed) await switchOffSignIn(tx, id, actor.userId);
  if (input.isActive && managed) await switchOnSignIn(tx, id);

  // Access, status or password changes end every session of the user (BUILD_PLAN F3 note).
  const accessChanged =
    prevAccess !== JSON.stringify([next.roles, next.warehouses, next.clients, input.isActive]) ||
    Boolean(input.password);
  const revoke = accessChanged && id !== auth.user.id && managed;
  if (revoke) await bumpSessionVersion(tx, id);
  const version = (await loadUser(tx, id)).version;
  return { id, version, sessionsRevoked: revoke };
}

/** Activate / deactivate many users; deactivation bumps the session version (logout next click). */
export async function setUsersActive(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  ids: readonly string[],
  isActive: boolean,
): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  return await runBulk(tx, ids, async (inner, id) => {
    const row = await loadUser(inner, id);
    if (row.isActive === isActive)
      throw new AppError('INVALID_STATE', `${row.name} is already ${isActive ? 'active' : 'inactive'}`);
    if (!isActive && id === auth.user.id)
      throw new AppError('INVALID_STATE', "You can't deactivate your own account");
    if (!isActive) await assertNotLastAdmin(inner, id, false);
    await inner
      .update(u)
      .set({
        isActive,
        ...(isActive ? { failedLoginCount: 0, lockedUntil: null } : {}),
        updatedBy: actor.userId,
        updatedAt: new Date().toISOString(),
        version: sql`${u.version} + 1`,
      })
      .where(eq(u.id, id));
    await logUpdate(
      inner,
      ctx,
      { entityType: USER_ENTITY, entityId: id, entityCode: row.email },
      { status: row.isActive ? 'Active' : 'Inactive' },
      { status: isActive ? 'Active' : 'Inactive' },
    );
    // Reactivation clears the lockout but does NOT restore the deleted credential:
    // the admin must issue a password reset (auth review H3 — mirror of the delete below).
    // Shared accounts: reactivation/deactivation stay local to this warehouse (see updateUser) —
    // their lockout, credential and other orgs' sessions are not this warehouse's to touch.
    const managed = await identityManagedHere(inner, id);
    if (isActive && managed) {
      await clearLockoutState(inner, row.email);
      await switchOnSignIn(inner, id);
    }
    if (!isActive && managed) {
      // H3: revoking sessions is not enough — the account must be switched off for every app
      // (block row + no password row), or the deactivated user simply signs in again at
      // crm.kitstak.io, or asks the Portal for a new password.
      await switchOffSignIn(inner, id, actor.userId);
      await bumpSessionVersion(inner, id);
    }
  });
}

const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 14 chars with upper, lower, digit and symbol — always passes the policy. */
export function generateTemporaryPassword(length = 14): string {
  const bytes = randomBytes(length);
  const body = Array.from(bytes, (b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length])
    .join('')
    .slice(0, Math.max(10, length) - 4);
  return `${body}Ka7!`;
}

/**
 * Sets a one-time temporary password (core.account credential), revokes every session
 * and marks the password as expired (`password_changed_at = null`) so the user must
 * choose a new one. (Blueprint §1.4: neither app has a mailer, so the admin-reset flow
 * stays; `auth.api.setUserPassword` needs the admin plugin, so the credential is set
 * through the shared hasher instead.)
 */
export async function resetUserPassword(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  id: string,
): Promise<{ temporaryPassword: string; email: string }> {
  const row = await loadUser(tx, id);
  if (id === auth.user.id)
    throw new AppError('INVALID_STATE', 'Use Change Password to change your own password');
  // NEW-2: a reset would (re)create the shared core.account credential, silently
  // reactivating password sign-in on every instance for a deactivated user (H3).
  if (!row.isActive)
    throw new AppError(
      'INVALID_STATE',
      `${row.name} is inactive. Activate the user first, then reset their password.`,
    );
  await assertIdentityManagedHere(tx, id, 'reset its password');
  const temporaryPassword = generateTemporaryPassword();
  await setCredentialPassword(tx, id, temporaryPassword, { passwordChangedAt: null });
  await tx
    .update(u)
    .set({
      passwordChangedAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedBy: actor.userId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(u.id, id));
  await logUpdate(
    tx,
    domainCtxOf(actor, auth),
    { entityType: USER_ENTITY, entityId: id, entityCode: row.email },
    { password: 'Set by user' },
    { password: 'Reset by administrator (change required)' },
  );
  await bumpSessionVersion(tx, id);
  return { temporaryPassword, email: row.email };
}

export interface UserSession extends SessionSummary {
  readonly isCurrent: boolean;
}

export async function userSessions(
  db: AppDb,
  auth: AuthContext,
  id: string,
): Promise<readonly UserSession[]> {
  await loadUser(db, id);
  // A KitStak account shared with another org: its sessions (IPs, devices) are not ours to see.
  if (!(await identityManagedHere(db, id))) return [];
  return (await listActiveSessions(db, id)).map((sess) => ({
    ...sess,
    isCurrent: sess.id === auth.user.sessionId,
  }));
}

export async function revokeUserSession(
  tx: AppDb,
  auth: AuthContext,
  userId: string,
  sessionId: string,
): Promise<{ revoked: boolean }> {
  await loadUser(tx, userId);
  await assertIdentityManagedHere(tx, userId, 'end its sessions');
  const sess = (
    await tx
      .select({ userId: coreSession.userId })
      .from(coreSession)
      .where(eq(coreSession.id, sessionId))
      .limit(1)
  )[0];
  if (!sess || sess.userId !== userId) throw new AppError('NOT_FOUND', 'Session not found');
  if (sessionId === auth.user.sessionId)
    throw new AppError('INVALID_STATE', 'Use Log out to end your current session');
  return { revoked: await revokeSession(tx, sessionId) };
}

/** Options for pickers and grid filters. */
export async function userOptions(db: AppDb): Promise<{ id: string; name: string; email: string }[]> {
  return await db.select({ id: u.id, name: u.name, email: u.email }).from(u).orderBy(asc(u.name));
}

export async function findUserByEmail(db: AppDb, email: string): Promise<typeof u.$inferSelect | undefined> {
  return (await db.select().from(u).where(eq(u.email, email.trim().toLowerCase())).limit(1))[0];
}
