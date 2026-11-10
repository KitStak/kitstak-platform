/**
 * Count assignees (M07): the "Assign to" list of Create Job / Create Recount. Only warehouse
 * staff who can actually count: active, not API or client-portal users, assigned to the
 * warehouse (admins and users without warehouse links see every warehouse, the same rule
 * `assertUserInWarehouse` enforces on save), and holding a count-execution permission.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import { hasWarehouse, type Scope } from "@/server/auth/scope";
import { loadPermissions } from "@/server/auth/permissions";
import { COUNT_EXECUTE_PERMISSIONS } from "@/lib/grid-defs/counts/count-grids";

export interface CountAssignee {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export function countAssignees(db: AppDb, scope: Scope, warehouseId: string): CountAssignee[] {
  if (!hasWarehouse(scope, warehouseId)) throw notFoundError("Warehouse");
  const users = db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, userType: schema.users.userType })
    .from(schema.users)
    .where(and(eq(schema.users.isActive, true), eq(schema.users.isApiUser, false)))
    .orderBy(asc(schema.users.name)).all()
    .filter((u) => u.userType !== "Client");
  if (users.length === 0) return [];
  const links = db.select({ userId: schema.userWarehouses.userId, warehouseId: schema.userWarehouses.warehouseId })
    .from(schema.userWarehouses).where(inArray(schema.userWarehouses.userId, users.map((u) => u.id))).all();
  const byUser = new Map<string, string[]>();
  for (const l of links) byUser.set(l.userId, [...(byUser.get(l.userId) ?? []), l.warehouseId]);
  return users
    .filter((u) => u.role === "admin" || !byUser.has(u.id) || (byUser.get(u.id) ?? []).includes(warehouseId))
    .filter((u) => {
      const perms = loadPermissions(db, { id: u.id, role: u.role }).permissions as ReadonlySet<string>;
      return COUNT_EXECUTE_PERMISSIONS.some((p) => perms.has(p));
    })
    .map((u) => ({ id: u.id, name: u.name, email: u.email }));
}
