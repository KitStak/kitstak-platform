/**
 * Choices for the wave-rule wizard: the viewer's warehouses, the warehouse's job types per
 * operation, roles and users for the Assign step, order-merge rules, lookups for the typed
 * filter editors, and whether the AI Jobs app is active.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { DEFAULT_ROLE_PERMISSIONS, type DefaultRoleKey } from "@/server/auth/permission-catalog";
import { hasWarehouse } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";

/** A job assignee must be able to execute tasks (Logiwa's Assign grids list operational users only). */
export const TASK_EXECUTION_PERMISSION = "fulfillment.task_details.execute_task";

/**
 * Roles and users that can actually work the jobs of `warehouseId` (critic R3):
 * - roles: hold the task-execution permission and are not Client roles;
 * - users: active, not API/service accounts, not Client users, linked to the warehouse (admins
 *   reach every warehouse), and holding task execution through one of their roles (a user with no
 *   role rows falls back to the default set of their legacy role).
 */
export function assignableForWarehouse(db: AppDb, warehouseId: string) {
  const executing = new Set(db.select({ roleId: schema.rolePermissions.roleId }).from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.permission, TASK_EXECUTION_PERMISSION)).all().map((r) => r.roleId));
  const roles = db.select({ id: schema.roles.id, name: schema.roles.name, category: schema.roles.category }).from(schema.roles).orderBy(asc(schema.roles.name)).all()
    .filter((r) => r.category !== "Client" && executing.has(r.id));
  const eligibleRoles = new Set(roles.map((r) => r.id));
  const linked = new Set(db.select({ u: schema.userWarehouses.userId }).from(schema.userWarehouses).where(eq(schema.userWarehouses.warehouseId, warehouseId)).all().map((r) => r.u));
  const rolesOf = new Map<string, { id: string; name: string }[]>();
  for (const r of db.select({ u: schema.userRoles.userId, id: schema.roles.id, name: schema.roles.name }).from(schema.userRoles).innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId)).all()) {
    rolesOf.set(r.u, [...(rolesOf.get(r.u) ?? []), { id: r.id, name: r.name }]);
  }
  const canExecute = (u: { id: string; role: string }): boolean => {
    const own = rolesOf.get(u.id);
    if (own && own.length > 0) return own.some((r) => eligibleRoles.has(r.id));
    return (DEFAULT_ROLE_PERMISSIONS[u.role as DefaultRoleKey] ?? []).includes(TASK_EXECUTION_PERMISSION);
  };
  const users = db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, userType: schema.users.userType, role: schema.users.role, isApiUser: schema.users.isApiUser })
    .from(schema.users).where(eq(schema.users.isActive, true)).orderBy(asc(schema.users.name)).all()
    .filter((u) => !u.isApiUser && u.userType !== "Client")
    .filter((u) => u.role === "admin" || linked.size === 0 || linked.has(u.id))
    .filter(canExecute)
    .map((u) => ({ id: u.id, name: u.name, email: u.email, userType: u.userType ?? "Operation", role: rolesOf.get(u.id)?.map((r) => r.name).join(", ") || u.role }));
  return { roles, users };
}

/** Minimum search length for the Assign user picker (Logiwa: "You have to enter at least 3 characters"). */
export const ASSIGNEE_MIN_CHARS = 3;

/**
 * Users who may be assigned jobs / tasks of `warehouseId`, narrowed by a name/email search of at
 * least {@link ASSIGNEE_MIN_CHARS} characters (shorter queries return nothing).
 */
export function searchAssignees(db: AppDb, warehouseId: string, q: string, limit = 50) {
  const needle = q.trim().toLowerCase();
  if (needle.length < ASSIGNEE_MIN_CHARS) return [];
  return assignableForWarehouse(db, warehouseId).users
    .filter((u) => u.name.toLowerCase().includes(needle) || (u.email ?? "").toLowerCase().includes(needle))
    .slice(0, limit)
    .map((u) => ({ id: u.id, label: u.name, description: [u.role, u.email].filter(Boolean).join(" · ") }));
}

/**
 * Server-side guard for job and task Assign (critic R4): the same eligibility as the wave-rule
 * Assign step. Anyone else (client-portal, viewer, CS, API, inactive, other warehouse) is a 400.
 */
export function assertEligibleAssignee(db: AppDb, userId: string, warehouseIds: readonly string[]): void {
  for (const wh of new Set(warehouseIds)) {
    if (assignableForWarehouse(db, wh).users.some((u) => u.id === userId)) continue;
    const name = db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId)).get()?.name;
    throw new AppError(
      "VALIDATION",
      `${name ?? "This user"} can't be assigned. Only active users of this warehouse who can execute tasks can take jobs and tasks.`,
    );
  }
}

export function waveRuleOptions(db: AppDb, auth: AuthContext, warehouseId: string | null) {
  const warehouses = db.select({ id: schema.warehouses.id, code: schema.warehouses.code, name: schema.warehouses.name, timezone: schema.warehouses.timezone })
    .from(schema.warehouses).where(inArray(schema.warehouses.id, [...auth.scope.warehouseIds])).orderBy(asc(schema.warehouses.code)).all();
  const aiJobsActive = Boolean(db.select({ on: schema.apps.isActive }).from(schema.apps).where(eq(schema.apps.key, "ai-jobs")).get()?.on);
  const lookups = (type: (typeof schema.lookupValues.type._.data)) => db.select({ value: schema.lookupValues.id, label: schema.lookupValues.name }).from(schema.lookupValues)
    .where(and(eq(schema.lookupValues.type, type), eq(schema.lookupValues.isActive, true))).orderBy(asc(schema.lookupValues.sortOrder)).all();
  const clients = db.select({ value: schema.clients.id, label: schema.clients.name }).from(schema.clients).orderBy(asc(schema.clients.name)).all()
    .filter((c) => auth.scope.clientIds === "all" || auth.scope.clientIds.includes(c.value));
  const base = {
    warehouses, aiJobsActive, mergeRules: lookups("order_merge_rule"),
    enumOptions: { orderType: lookups("so_type"), productGroup: lookups("product_group"), client: clients },
  };
  if (!warehouseId || !hasWarehouse(auth.scope, warehouseId)) return { ...base, jobTypes: [], roles: [], users: [] };
  const jobTypes = db.select({ id: schema.jobTypes.id, code: schema.jobTypes.code, description: schema.jobTypes.description, operationType: schema.jobTypes.operationType })
    .from(schema.jobTypes).where(and(eq(schema.jobTypes.warehouseId, warehouseId), eq(schema.jobTypes.isActive, true))).orderBy(asc(schema.jobTypes.code)).all();
  const { roles, users } = assignableForWarehouse(db, warehouseId);
  return { ...base, jobTypes, roles, users };
}

export type WaveRuleOptions = ReturnType<typeof waveRuleOptions>;
