/**
 * Choices for the wave-rule wizard: the viewer's warehouses, the warehouse's job types per
 * operation, roles and users for the Assign step, order-merge rules, lookups for the typed
 * filter editors, and whether the AI Jobs app is active.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { hasWarehouse } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";

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
  const roles = db.select({ id: schema.roles.id, name: schema.roles.name, category: schema.roles.category }).from(schema.roles).orderBy(asc(schema.roles.name)).all();
  const linked = new Set(db.select({ u: schema.userWarehouses.userId }).from(schema.userWarehouses).where(eq(schema.userWarehouses.warehouseId, warehouseId)).all().map((r) => r.u));
  const roleOf = new Map(db.select({ u: schema.userRoles.userId, name: schema.roles.name }).from(schema.userRoles).innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId)).all().map((r) => [r.u, r.name]));
  const users = db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, userType: schema.users.userType, role: schema.users.role })
    .from(schema.users).where(eq(schema.users.isActive, true)).orderBy(asc(schema.users.name)).all()
    .filter((u) => u.role === "admin" || linked.size === 0 || linked.has(u.id))
    .map((u) => ({ id: u.id, name: u.name, email: u.email, userType: u.userType ?? "Operation", role: roleOf.get(u.id) ?? u.role }));
  return { ...base, jobTypes, roles, users };
}

export type WaveRuleOptions = ReturnType<typeof waveRuleOptions>;
