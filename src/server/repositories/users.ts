/**
 * Users repository (M14): grid, detail, create (4-step wizard), edit, activate/deactivate
 * (bumps the session version), reset password (temporary password, forced change) and
 * session management. Role / warehouse / client links live in `user_roles`,
 * `user_warehouses` and `user_clients`; every change writes field-level `change_log`.
 */
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError, fromZodError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hashPassword } from "@/server/auth/password";
import { getPasswordPolicy, validatePassword } from "@/server/auth/password-policy";
import { hasWarehouse } from "@/server/auth/scope";
import { bumpSessionVersion, listActiveSessions, revokeSession, type SessionSummary } from "@/server/auth/session-store";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { USER_FIELDS, USER_SEARCH_FIELDS, USER_SORT_FIELDS, userSaveSchemaWithPolicy, type UserSave } from "@/lib/grid-defs/admin/users";
import { assertFound, assertVersion, compileGrid, domainCtxOf, duplicateError, fieldError, logCreate, logUpdate, qc, type Actor, type GridBinding } from "./users-shared";

const u = s.users;
export const USER_ENTITY = "user";

type LegacyRole = (typeof u.$inferSelect)["role"];

const roleNamesSql = sql<string | null>`(SELECT group_concat(r.name, ', ') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ${qc(u.id)})`;
const warehouseCodesSql = sql<string | null>`(SELECT group_concat(w.code, ', ') FROM user_warehouses uw JOIN warehouses w ON w.id = uw.warehouse_id WHERE uw.user_id = ${qc(u.id)})`;
const statusSql = sql<string>`CASE WHEN ${qc(u.isActive)} = 1 THEN 'Active' ELSE 'Inactive' END`;
const sessionCountSql = sql<number>`(SELECT COUNT(*) FROM user_sessions us WHERE us.user_id = ${qc(u.id)} AND us.revoked_at IS NULL AND us.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

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
  exprs: USER_SQL, fields: USER_FIELDS, sortable: USER_SORT_FIELDS, search: USER_SEARCH_FIELDS,
  defaultSort: [{ field: "name", dir: "asc" }], tiebreaker: u.id,
};

/** Role / warehouse filters must match ANY linked row, not just the first one. */
function membershipFilters(query: GridQuery): { query: GridQuery; extra: SQL[] } {
  const extra: SQL[] = [];
  const rest = query.filters.filter((f) => {
    if ((f.field === "roleId" || f.field === "warehouseId") && (f.op === "in" || f.op === "nin" || f.op === "eq")) {
      const values = "values" in f ? [...f.values] : [f.value];
      if (values.length === 0) return false;
      const list = sql.join(values.map((v) => sql`${v}`), sql`, `);
      const sub = f.field === "roleId"
        ? sql`EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = ${qc(u.id)} AND ur.role_id IN (${list}))`
        : sql`EXISTS (SELECT 1 FROM user_warehouses uw WHERE uw.user_id = ${qc(u.id)} AND uw.warehouse_id IN (${list}))`;
      extra.push(f.op === "nin" ? sql`NOT ${sub}` : sub);
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
  readonly status: "Active" | "Inactive";
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
  id: u.id, name: u.name, firstName: u.firstName, lastName: u.lastName, email: u.email, userType: u.userType,
  isActive: u.isActive, isApiUser: u.isApiUser, allClients: u.allClients, lastLoginAt: u.lastLoginAt,
  passwordChangedAt: u.passwordChangedAt, lockedUntil: u.lockedUntil, createdAt: u.createdAt, version: u.version,
  status: statusSql, roleNames: roleNamesSql, warehouseCodes: warehouseCodesSql, activeSessions: sessionCountSql,
};

function toRow(r: Record<string, unknown>): UserRow {
  return { ...(r as unknown as UserRow), isActive: Boolean(r.isActive), isApiUser: Boolean(r.isApiUser), allClients: Boolean(r.allClients) };
}

export function listUsers(db: AppDb, _auth: AuthContext, query: GridQuery): { rows: UserRow[]; total: number } {
  const split = membershipFilters(query);
  const grid = compileGrid(BINDING, split.query, split.extra);
  const result = paginate(
    db.select(ROW_COLUMNS).from(u).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(u).where(grid.where).get()?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return { rows: (result.rows as Record<string, unknown>[]).map(toRow), total: result.total };
}

export interface UserDetail extends UserRow {
  readonly roles: readonly { readonly id: string; readonly name: string; readonly key: string; readonly isSystem: boolean }[];
  readonly warehouses: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  readonly clients: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  readonly roleIds: readonly string[];
  readonly warehouseIds: readonly string[];
  readonly clientIds: readonly string[];
}

export function loadUser(db: AppDb, id: string): typeof u.$inferSelect {
  return assertFound(db.select().from(u).where(eq(u.id, id)).get(), "User");
}

export function getUser(db: AppDb, id: string): UserDetail {
  const row = assertFound(db.select(ROW_COLUMNS).from(u).where(eq(u.id, id)).get(), "User");
  const roles = db.select({ id: s.roles.id, name: s.roles.name, key: s.roles.key, isSystem: s.roles.isSystem }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(eq(s.userRoles.userId, id)).orderBy(asc(s.roles.name)).all();
  const warehouses = db.select({ id: s.warehouses.id, code: s.warehouses.code, name: s.warehouses.name }).from(s.userWarehouses).innerJoin(s.warehouses, eq(s.warehouses.id, s.userWarehouses.warehouseId)).where(eq(s.userWarehouses.userId, id)).orderBy(asc(s.warehouses.code)).all();
  const clients = db.select({ id: s.clients.id, code: s.clients.code, name: s.clients.name }).from(s.userClients).innerJoin(s.clients, eq(s.clients.id, s.userClients.clientId)).where(eq(s.userClients.userId, id)).orderBy(asc(s.clients.name)).all();
  return {
    ...toRow(row as Record<string, unknown>),
    roles: roles.map((r) => ({ ...r, isSystem: Boolean(r.isSystem) })), warehouses, clients,
    roleIds: roles.map((r) => r.id), warehouseIds: warehouses.map((w) => w.id), clientIds: clients.map((c) => c.id),
  };
}

/* ---------------- validation ---------------- */

/** Legacy `users.role` drives only the admin bypass and the no-role fallback. */
export function legacyRoleFor(roleKeys: readonly string[]): LegacyRole {
  if (roleKeys.includes("admin")) return "admin";
  if (roleKeys.includes("manager")) return "manager";
  if (roleKeys.includes("operator")) return "operator";
  if (roleKeys.length > 0 && roleKeys.every((k) => k === "viewer" || k === "client")) return "viewer";
  return "operator";
}

function resolveRoles(db: AppDb, ids: readonly string[]): { id: string; key: string; name: string; category: string }[] {
  const unique = [...new Set(ids)];
  const rows = unique.length ? db.select({ id: s.roles.id, key: s.roles.key, name: s.roles.name, category: s.roles.category }).from(s.roles).where(inArray(s.roles.id, unique)).all() : [];
  if (rows.length !== unique.length) throw fieldError("roleIds", "One of the selected roles no longer exists");
  return rows;
}

function resolveWarehouses(db: AppDb, auth: AuthContext, ids: readonly string[]): { id: string; code: string }[] {
  const unique = [...new Set(ids)];
  for (const id of unique) if (!hasWarehouse(auth.scope, id)) throw fieldError("warehouseIds", "You can only give access to warehouses you can access");
  const rows = unique.length ? db.select({ id: s.warehouses.id, code: s.warehouses.code }).from(s.warehouses).where(inArray(s.warehouses.id, unique)).all() : [];
  if (rows.length !== unique.length) throw fieldError("warehouseIds", "One of the selected warehouses no longer exists");
  return rows;
}

function resolveClients(db: AppDb, ids: readonly string[]): { id: string; code: string }[] {
  const unique = [...new Set(ids)];
  const rows = unique.length ? db.select({ id: s.clients.id, code: s.clients.code }).from(s.clients).where(inArray(s.clients.id, unique)).all() : [];
  if (rows.length !== unique.length) throw fieldError("clientIds", "One of the selected clients no longer exists");
  return rows;
}

/** True when another user (not `exceptId`) already signs in with `email` (case-insensitive). */
export function isEmailTaken(db: AppDb, email: string, exceptId?: string): boolean {
  const clash = db.select({ id: u.id }).from(u).where(eq(u.email, email.trim().toLowerCase())).get();
  return Boolean(clash && clash.id !== exceptId);
}

function assertEmailFree(db: AppDb, email: string, exceptId?: string): void {
  if (isEmailTaken(db, email, exceptId)) throw duplicateError("email", `A user with ${email} already exists`);
}

export function assertPasswordPolicy(db: AppDb, password: string, email: string, field = "password"): void {
  const issues = validatePassword(password, getPasswordPolicy(db), { email });
  if (issues.length > 0) throw new AppError("VALIDATION", issues[0] ?? "Password does not meet the policy", { fieldErrors: { [field]: issues } });
}

/**
 * Parses a create / edit body against the save schema AND the company password policy in one
 * pass, so the response lists every field error together (no staged validation).
 */
export function parseUserSave(db: AppDb, mode: "create" | "update", raw: unknown): UserSave {
  const policy = getPasswordPolicy(db);
  const parsed = userSaveSchemaWithPolicy(mode, (password, email) => validatePassword(password, policy, { email })).safeParse(raw);
  if (!parsed.success) throw fromZodError(parsed.error);
  return parsed.data;
}

/** Display snapshot for the change log (names, never ids). */
function snapshot(db: AppDb, id: string): Record<string, unknown> {
  const d = getUser(db, id);
  return {
    name: d.name, firstName: d.firstName, lastName: d.lastName, email: d.email, userType: d.userType,
    status: d.status, roles: d.roles.map((r) => r.name).join(", "), warehouses: d.warehouses.map((w) => w.code).join(", "),
    clients: d.allClients ? "All clients" : d.clients.map((c) => c.code).join(", "),
  };
}

function writeLinks(tx: AppDb, userId: string, input: Pick<UserSave, "roleIds" | "warehouseIds" | "allClients" | "clientIds">): void {
  tx.delete(s.userRoles).where(eq(s.userRoles.userId, userId)).run();
  tx.delete(s.userWarehouses).where(eq(s.userWarehouses.userId, userId)).run();
  tx.delete(s.userClients).where(eq(s.userClients.userId, userId)).run();
  const roleIds = [...new Set(input.roleIds)];
  const warehouseIds = [...new Set(input.warehouseIds)];
  if (roleIds.length) tx.insert(s.userRoles).values(roleIds.map((roleId) => ({ userId, roleId }))).run();
  if (warehouseIds.length) tx.insert(s.userWarehouses).values(warehouseIds.map((warehouseId) => ({ userId, warehouseId }))).run();
  const clientIds = input.allClients ? [] : [...new Set(input.clientIds)];
  if (clientIds.length) tx.insert(s.userClients).values(clientIds.map((clientId) => ({ userId, clientId }))).run();
}

const displayName = (first: string, last: string): string => `${first.trim()} ${last.trim()}`.trim();

/* ---------------- commands ---------------- */

export function createUser(tx: AppDb, auth: AuthContext, actor: Actor, input: UserSave): { id: string; name: string; email: string } {
  assertEmailFree(tx, input.email);
  assertPasswordPolicy(tx, input.password, input.email);
  const roles = resolveRoles(tx, input.roleIds);
  resolveWarehouses(tx, auth, input.warehouseIds);
  if (!input.allClients) resolveClients(tx, input.clientIds);
  if (roles.some((r) => r.key === "admin") && !auth.roleKeys.includes("admin") && auth.user.role !== "admin") {
    throw fieldError("roleIds", "Only an administrator can assign the Admin role");
  }
  const now = new Date().toISOString();
  const row = tx.insert(u).values({
    email: input.email.toLowerCase(), name: displayName(input.firstName, input.lastName), firstName: input.firstName.trim(), lastName: input.lastName.trim(),
    passwordHash: hashPassword(input.password), role: legacyRoleFor(roles.map((r) => r.key)), userType: input.userType,
    isActive: input.isActive, allClients: input.allClients, passwordChangedAt: now, createdBy: actor.userId, updatedBy: actor.userId,
  }).returning({ id: u.id, name: u.name, email: u.email }).get();
  writeLinks(tx, row.id, input);
  logCreate(tx, domainCtxOf(actor, auth), { entityType: USER_ENTITY, entityId: row.id, entityCode: row.email });
  return row;
}

/** Last active admin can't be removed, deactivated or demoted. */
function assertNotLastAdmin(db: AppDb, userId: string, willStayAdmin: boolean): void {
  if (willStayAdmin) return;
  const target = loadUser(db, userId);
  if (target.role !== "admin" || !target.isActive) return;
  const others = db.select({ n: sql<number>`count(*)` }).from(u).where(and(eq(u.role, "admin"), eq(u.isActive, true), ne(u.id, userId))).get()?.n ?? 0;
  if (others === 0) throw new AppError("INVALID_STATE", "This is the last active administrator. Make another user an admin first.");
}

export interface UpdateUserResult {
  readonly id: string;
  readonly version: number;
  readonly sessionsRevoked: boolean;
}

export function updateUser(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: UserSave): UpdateUserResult {
  const before = loadUser(tx, id);
  assertVersion(before.version, input.version);
  assertEmailFree(tx, input.email, id);
  if (input.password) assertPasswordPolicy(tx, input.password, input.email);
  const roles = resolveRoles(tx, input.roleIds);
  resolveWarehouses(tx, auth, input.warehouseIds);
  if (!input.allClients) resolveClients(tx, input.clientIds);
  const role = legacyRoleFor(roles.map((r) => r.key));
  if (role === "admin" && before.role !== "admin" && auth.user.role !== "admin") throw fieldError("roleIds", "Only an administrator can assign the Admin role");
  if (id === auth.user.id && !input.isActive) throw fieldError("isActive", "You can't deactivate your own account");
  assertNotLastAdmin(tx, id, role === "admin" && input.isActive);

  const prev = snapshot(tx, id);
  const prevAccess = JSON.stringify([prev.roles, prev.warehouses, prev.clients, before.isActive]);
  tx.update(u).set({
    email: input.email.toLowerCase(), name: displayName(input.firstName, input.lastName), firstName: input.firstName.trim(), lastName: input.lastName.trim(),
    userType: input.userType, isActive: input.isActive, allClients: input.allClients, role,
    ...(input.password ? { passwordHash: hashPassword(input.password), passwordChangedAt: new Date().toISOString() } : {}),
    updatedBy: actor.userId, updatedAt: new Date().toISOString(), version: sql`${u.version} + 1`,
  }).where(eq(u.id, id)).run();
  writeLinks(tx, id, input);
  const next = snapshot(tx, id);
  logUpdate(tx, domainCtxOf(actor, auth), { entityType: USER_ENTITY, entityId: id, entityCode: input.email }, prev, next);
  if (input.password) logUpdate(tx, domainCtxOf(actor, auth), { entityType: USER_ENTITY, entityId: id, entityCode: input.email }, { password: "••••" }, { password: "Changed" });

  // Access, status or password changes end every session of the user (BUILD_PLAN F3 note).
  const accessChanged = prevAccess !== JSON.stringify([next.roles, next.warehouses, next.clients, input.isActive]) || Boolean(input.password);
  if (accessChanged && id !== auth.user.id) bumpSessionVersion(tx, id);
  const version = loadUser(tx, id).version;
  return { id, version, sessionsRevoked: accessChanged && id !== auth.user.id };
}

/** Activate / deactivate many users; deactivation bumps the session version (logout next click). */
export function setUsersActive(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[], isActive: boolean): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadUser(inner, id);
    if (row.isActive === isActive) throw new AppError("INVALID_STATE", `${row.name} is already ${isActive ? "active" : "inactive"}`);
    if (!isActive && id === auth.user.id) throw new AppError("INVALID_STATE", "You can't deactivate your own account");
    if (!isActive) assertNotLastAdmin(inner, id, false);
    inner.update(u).set({ isActive, ...(isActive ? { failedLoginCount: 0, lockedUntil: null } : {}), updatedBy: actor.userId, updatedAt: new Date().toISOString(), version: sql`${u.version} + 1` }).where(eq(u.id, id)).run();
    logUpdate(inner, ctx, { entityType: USER_ENTITY, entityId: id, entityCode: row.email }, { status: row.isActive ? "Active" : "Inactive" }, { status: isActive ? "Active" : "Inactive" });
    if (!isActive) bumpSessionVersion(inner, id);
  });
}

const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** 14 chars with upper, lower, digit and symbol — always passes the policy. */
export function generateTemporaryPassword(length = 14): string {
  const bytes = randomBytes(length);
  const body = Array.from(bytes, (b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]).join("").slice(0, Math.max(10, length) - 4);
  return `${body}Ka7!`;
}

/**
 * Sets a one-time temporary password, revokes every session and marks the password as
 * expired (`password_changed_at = null`) so the user must choose a new one.
 */
export function resetUserPassword(tx: AppDb, auth: AuthContext, actor: Actor, id: string): { temporaryPassword: string; email: string } {
  const row = loadUser(tx, id);
  if (id === auth.user.id) throw new AppError("INVALID_STATE", "Use Change Password to change your own password");
  const temporaryPassword = generateTemporaryPassword();
  tx.update(u).set({ passwordHash: hashPassword(temporaryPassword), passwordChangedAt: null, failedLoginCount: 0, lockedUntil: null, updatedBy: actor.userId, updatedAt: new Date().toISOString() }).where(eq(u.id, id)).run();
  logUpdate(tx, domainCtxOf(actor, auth), { entityType: USER_ENTITY, entityId: id, entityCode: row.email }, { password: "Set by user" }, { password: "Reset by administrator (change required)" });
  bumpSessionVersion(tx, id);
  return { temporaryPassword, email: row.email };
}

export interface UserSession extends SessionSummary {
  readonly isCurrent: boolean;
}

export function userSessions(db: AppDb, auth: AuthContext, id: string): readonly UserSession[] {
  loadUser(db, id);
  return listActiveSessions(db, id).map((sess) => ({ ...sess, isCurrent: sess.id === auth.user.sessionId }));
}

export function revokeUserSession(tx: AppDb, auth: AuthContext, userId: string, sessionId: string): { revoked: boolean } {
  loadUser(tx, userId);
  const sess = tx.select({ userId: s.userSessions.userId }).from(s.userSessions).where(eq(s.userSessions.id, sessionId)).get();
  if (!sess || sess.userId !== userId) throw new AppError("NOT_FOUND", "Session not found");
  if (sessionId === auth.user.sessionId) throw new AppError("INVALID_STATE", "Use Log out to end your current session");
  return { revoked: revokeSession(tx, sessionId) };
}

/** Options for pickers and grid filters. */
export function userOptions(db: AppDb): { id: string; name: string; email: string }[] {
  return db.select({ id: u.id, name: u.name, email: u.email }).from(u).orderBy(asc(u.name)).all();
}

export function findUserByEmail(db: AppDb, email: string): typeof u.$inferSelect | undefined {
  return db.select().from(u).where(eq(u.email, email.trim().toLowerCase())).get();
}
