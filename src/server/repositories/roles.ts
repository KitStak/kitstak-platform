/**
 * Roles repository (M14): grid with restriction pills, detail with the granted permission
 * keys, create / edit (permission matrix), duplicate, Manage Restrictions and a guarded
 * delete (blocked while users are assigned). System roles are view-only.
 * Permissions are read per request (`loadPermissions`), so a change applies on the next click.
 */
import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { getPermission, PERMISSION_KEYS } from "@/server/auth/permission-catalog";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { RESTRICTION_DEFS, ROLE_FIELDS, ROLE_SEARCH_FIELDS, ROLE_SORT_FIELDS, roleKeyFromName, withImpliedViews, type RoleSave } from "@/lib/grid-defs/admin/roles";
import type { ROLE_RESTRICTIONS } from "@/lib/enums";
import { assertFound, assertVersion, compileGrid, domainCtxOf, duplicateError, logCreate, logDelete, logUpdate, qc, type Actor, type GridBinding } from "./users-shared";

const r = s.roles;
export const ROLE_ENTITY = "role";
type Restriction = (typeof ROLE_RESTRICTIONS)[number];

const userCountSql = sql<number>`(SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = ${qc(r.id)})`;
const permissionCountSql = sql<number>`(SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = ${qc(r.id)})`;

const ROLE_SQL: Readonly<Record<string, SQL>> = {
  name: sql`${qc(r.name)}`,
  description: sql`${qc(r.description)}`,
  category: sql`${qc(r.category)}`,
  restriction: sql`(SELECT je.value FROM json_each(${qc(r.restrictions)}) je LIMIT 1)`,
  isSystem: sql`${qc(r.isSystem)}`,
  userCount: userCountSql,
  permissionCount: permissionCountSql,
  createdAt: sql`${qc(r.createdAt)}`,
  updatedAt: sql`${qc(r.updatedAt)}`,
};

const BINDING: GridBinding = {
  exprs: ROLE_SQL, fields: ROLE_FIELDS, sortable: ROLE_SORT_FIELDS, search: ROLE_SEARCH_FIELDS,
  defaultSort: [{ field: "name", dir: "asc" }], tiebreaker: r.id,
};

/** `f.restriction=in:a,b` must match any restriction of the role. */
function restrictionFilter(query: GridQuery): { query: GridQuery; extra: SQL[] } {
  const extra: SQL[] = [];
  const filters = query.filters.filter((f) => {
    if (f.field !== "restriction" || (f.op !== "in" && f.op !== "nin")) return true;
    if (f.values.length === 0) return false;
    const sub = sql`EXISTS (SELECT 1 FROM json_each(${qc(r.restrictions)}) je WHERE je.value IN (${sql.join(f.values.map((v) => sql`${v}`), sql`, `)}))`;
    extra.push(f.op === "nin" ? sql`NOT ${sub}` : sub);
    return false;
  });
  return { query: { ...query, filters }, extra };
}

export interface RoleRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly category: string;
  readonly isSystem: boolean;
  readonly restrictions: readonly Restriction[];
  readonly userCount: number;
  readonly permissionCount: number;
  readonly totalPermissions: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

const COLUMNS = {
  id: r.id, key: r.key, name: r.name, description: r.description, category: r.category, isSystem: r.isSystem,
  restrictions: r.restrictions, createdAt: r.createdAt, updatedAt: r.updatedAt, version: r.version,
  userCount: userCountSql, permissionCount: permissionCountSql,
};

function toRow(row: Record<string, unknown>): RoleRow {
  const raw = row.restrictions;
  const restrictions = (Array.isArray(raw) ? raw : typeof raw === "string" ? (JSON.parse(raw) as unknown[]) : []) as Restriction[];
  return { ...(row as unknown as RoleRow), isSystem: Boolean(row.isSystem), restrictions, totalPermissions: PERMISSION_KEYS.length };
}

export function listRoles(db: AppDb, query: GridQuery): { rows: RoleRow[]; total: number } {
  const split = restrictionFilter(query);
  const grid = compileGrid(BINDING, split.query, split.extra);
  const result = paginate(
    db.select(COLUMNS).from(r).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(r).where(grid.where).get()?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return { rows: (result.rows as Record<string, unknown>[]).map(toRow), total: result.total };
}

export interface RoleDetail extends RoleRow {
  readonly permissions: readonly string[];
  readonly users: readonly { readonly id: string; readonly name: string; readonly email: string; readonly isActive: boolean }[];
}

export function loadRole(db: AppDb, id: string): typeof r.$inferSelect {
  return assertFound(db.select().from(r).where(eq(r.id, id)).get(), "Role");
}

export function rolePermissionKeys(db: AppDb, id: string): string[] {
  return db.select({ p: s.rolePermissions.permission }).from(s.rolePermissions).where(eq(s.rolePermissions.roleId, id)).all().map((x) => x.p);
}

export function getRole(db: AppDb, id: string): RoleDetail {
  const row = assertFound(db.select(COLUMNS).from(r).where(eq(r.id, id)).get(), "Role");
  const users = db.select({ id: s.users.id, name: s.users.name, email: s.users.email, isActive: s.users.isActive }).from(s.userRoles)
    .innerJoin(s.users, eq(s.users.id, s.userRoles.userId)).where(eq(s.userRoles.roleId, id)).orderBy(asc(s.users.name)).all();
  return { ...toRow(row as Record<string, unknown>), permissions: rolePermissionKeys(db, id), users: users.map((x) => ({ ...x, isActive: Boolean(x.isActive) })) };
}

function assertNameFree(db: AppDb, name: string, exceptId?: string): void {
  const clash = db.select({ id: r.id }).from(r).where(sql`lower(${r.name}) = lower(${name.trim()})`).get();
  if (clash && clash.id !== exceptId) throw duplicateError("name", `A role named ${name.trim()} already exists`);
}

function uniqueKey(db: AppDb, name: string): string {
  const base = roleKeyFromName(name);
  let key = base;
  for (let i = 2; db.select({ id: r.id }).from(r).where(eq(r.key, key)).get(); i += 1) key = `${base}_${i}`;
  return key;
}

function writePermissions(tx: AppDb, roleId: string, keys: readonly string[]): void {
  tx.delete(s.rolePermissions).where(eq(s.rolePermissions.roleId, roleId)).run();
  const unique = [...new Set(keys)];
  for (let i = 0; i < unique.length; i += 200) {
    tx.insert(s.rolePermissions).values(unique.slice(i, i + 200).map((permission) => ({ roleId, permission }))).run();
  }
}

const permissionLabel = (key: string): string => {
  const def = getPermission(key);
  return def ? `${def.pageLabel}: ${def.label}` : key;
};

/** Change-log snapshot: permission changes are logged as granted / revoked lists. */
function logPermissionDiff(tx: AppDb, auth: AuthContext, actor: Actor, id: string, code: string, before: readonly string[], after: readonly string[]): void {
  const prev = new Set(before);
  const next = new Set(after);
  const granted = after.filter((k) => !prev.has(k)).map(permissionLabel);
  const revoked = before.filter((k) => !next.has(k)).map(permissionLabel);
  const ctx = domainCtxOf(actor, auth);
  const ref = { entityType: ROLE_ENTITY, entityId: id, entityCode: code };
  if (granted.length) logUpdate(tx, ctx, ref, { permissionsGranted: "" }, { permissionsGranted: granted.join(", ").slice(0, 2000) });
  if (revoked.length) logUpdate(tx, ctx, ref, { permissionsRevoked: "" }, { permissionsRevoked: revoked.join(", ").slice(0, 2000) });
}

export function createRole(tx: AppDb, auth: AuthContext, actor: Actor, input: RoleSave): { id: string; name: string } {
  assertNameFree(tx, input.name);
  const row = tx.insert(r).values({
    key: uniqueKey(tx, input.name), name: input.name.trim(), description: input.description, category: input.category,
    isSystem: false, restrictions: [], createdBy: actor.userId, updatedBy: actor.userId,
  }).returning({ id: r.id, name: r.name }).get();
  writePermissions(tx, row.id, withImpliedViews(input.permissions));
  logCreate(tx, domainCtxOf(actor, auth), { entityType: ROLE_ENTITY, entityId: row.id, entityCode: row.name });
  return row;
}

function assertEditable(row: typeof r.$inferSelect): void {
  if (row.isSystem) throw new AppError("INVALID_STATE", `${row.name} is a system role and can't be changed. Duplicate it to make a custom version.`);
}

export function updateRole(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: RoleSave): { id: string; version: number } {
  const before = loadRole(tx, id);
  assertEditable(before);
  assertVersion(before.version, input.version);
  assertNameFree(tx, input.name, id);
  const prevPerms = rolePermissionKeys(tx, id);
  const after = tx.update(r).set({
    name: input.name.trim(), description: input.description, category: input.category,
    updatedBy: actor.userId, updatedAt: new Date().toISOString(), version: sql`${r.version} + 1`,
  }).where(eq(r.id, id)).returning().get();
  const perms = withImpliedViews(input.permissions);
  writePermissions(tx, id, perms);
  const ctx = domainCtxOf(actor, auth);
  logUpdate(tx, ctx, { entityType: ROLE_ENTITY, entityId: id, entityCode: after.name },
    { name: before.name, description: before.description, category: before.category },
    { name: after.name, description: after.description, category: after.category });
  logPermissionDiff(tx, auth, actor, id, after.name, prevPerms, perms);
  return { id, version: after.version };
}

export function duplicateRole(tx: AppDb, auth: AuthContext, actor: Actor, id: string): { id: string; name: string } {
  const source = loadRole(tx, id);
  let name = `${source.name} (copy)`;
  for (let i = 2; tx.select({ id: r.id }).from(r).where(sql`lower(${r.name}) = lower(${name})`).get(); i += 1) name = `${source.name} (copy ${i})`;
  const row = tx.insert(r).values({
    key: uniqueKey(tx, name), name, description: source.description ?? `Copy of ${source.name}`, category: source.category,
    isSystem: false, restrictions: source.restrictions ?? [], createdBy: actor.userId, updatedBy: actor.userId,
  }).returning({ id: r.id, name: r.name }).get();
  writePermissions(tx, row.id, withImpliedViews(rolePermissionKeys(tx, id)));
  logCreate(tx, domainCtxOf(actor, auth), { entityType: ROLE_ENTITY, entityId: row.id, entityCode: row.name });
  return row;
}

export function setRestrictions(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[], restrictions: readonly Restriction[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  const label = (list: readonly string[]) => list.map((k) => RESTRICTION_DEFS.find((d) => d.key === k)?.label ?? k).join(", ") || "None";
  return runBulk(tx, ids, (inner, id) => {
    const row = loadRole(inner, id);
    if (row.key === "admin") throw new AppError("INVALID_STATE", "The Admin role always sees every field");
    const next = [...new Set(restrictions)];
    inner.update(r).set({ restrictions: next, updatedBy: actor.userId, updatedAt: new Date().toISOString(), version: sql`${r.version} + 1` }).where(eq(r.id, id)).run();
    logUpdate(inner, ctx, { entityType: ROLE_ENTITY, entityId: id, entityCode: row.name }, { restrictions: label(row.restrictions ?? []) }, { restrictions: label(next) });
  });
}

export function roleDeleteBlocker(db: AppDb, row: typeof r.$inferSelect): string | null {
  if (row.isSystem) return `${row.name} is a system role`;
  const users = db.select({ n: sql<number>`count(*)` }).from(s.userRoles).where(eq(s.userRoles.roleId, row.id)).get()?.n ?? 0;
  return users > 0 ? `${row.name} is assigned to ${users} ${users === 1 ? "user" : "users"}` : null;
}

export function deleteRoles(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadRole(inner, id);
    const reason = roleDeleteBlocker(inner, row);
    if (reason) throw new AppError("INVALID_STATE", reason);
    inner.delete(r).where(eq(r.id, id)).run();
    logDelete(inner, ctx, { entityType: ROLE_ENTITY, entityId: id, entityCode: row.name });
  });
}

export function rolesByIds(db: AppDb, ids: readonly string[]) {
  return ids.length ? db.select({ id: r.id, name: r.name, key: r.key }).from(r).where(inArray(r.id, [...ids])).all() : [];
}

export function findRoleByName(db: AppDb, name: string): typeof r.$inferSelect | undefined {
  return db.select().from(r).where(sql`lower(${r.name}) = lower(${name.trim()}) OR lower(${r.key}) = lower(${name.trim()})`).get();
}
