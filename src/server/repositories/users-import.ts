/**
 * Users bulk import / update (M14, Settings › Users › Bulk import/update ▾). The four Excel
 * handlers (`imports/handlers/{users,user-roles,user-warehouses,user-clients}.ts`) apply one
 * row each through these functions, which go through `createUser` / `updateUser`, so every row
 * gets the same rules as the wizard: unique email, caller warehouse scope, only an admin can
 * grant Admin, the last active admin stays, session revoke on access change, field-level
 * change log.
 *
 * Imported users get a random password that is already expired: they can't sign in until an
 * administrator uses Reset password (or they use Forgot password) — no password ever travels
 * in an Excel file.
 */
import { eq, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { hasWarehouse } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { USER_TYPES } from "@/lib/enums";
import type { UserSave } from "@/lib/grid-defs/admin/users";
import { createUser, findUserByEmail, generateTemporaryPassword, getUser, updateUser, type UserDetail } from "./users";
import type { Actor } from "./users-shared";

export type ImportCell = string | number | boolean | null | undefined;
export type LinkKind = "role" | "warehouse" | "client";
export type LinkAction = "Assign" | "Unassign";

const str = (v: ImportCell): string | null => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

function fail(message: string): never {
  throw new DomainError("VALIDATION", message);
}

/** Template "User Type" → stored type. Web / Mobile / Web & Mobile are operation users. */
export function importUserType(value: ImportCell): (typeof USER_TYPES)[number] {
  const v = (str(value) ?? "").toLowerCase();
  if (v === "client") return "Client";
  if (v === "" || v === "operation" || v === "web" || v === "mobile" || v === "web & mobile" || v === "web and mobile") return "Operation";
  return fail(`User Type "${String(value)}" is not valid. Use Operation or Client (Web, Mobile and Web & Mobile mean Operation).`);
}

/** "Sam Q. Operator" → first "Sam", last "Q. Operator"; a single word is used for both. */
export function splitFullName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fail("Full Name is required");
  if (parts.length === 1) return { firstName: parts[0]!.slice(0, 60), lastName: parts[0]!.slice(0, 60) };
  return { firstName: parts[0]!.slice(0, 60), lastName: parts.slice(1).join(" ").slice(0, 60) };
}

/** Normalises the template Action column (Assign / Unassign, case-insensitive). */
export function linkAction(value: ImportCell): LinkAction {
  const v = (str(value) ?? "").toLowerCase();
  if (v === "assign") return "Assign";
  if (v === "unassign") return "Unassign";
  return fail(`Action must be Assign or Unassign (got "${String(value ?? "")}")`);
}

/** Pure: the id list after applying one assign / unassign (no duplicates, order kept). */
export function applyLink(ids: readonly string[], id: string, action: LinkAction): string[] {
  if (action === "Assign") return ids.includes(id) ? [...ids] : [...ids, id];
  return ids.filter((x) => x !== id);
}

function roleByName(db: AppDb, name: string): { id: string; name: string } {
  const row = db.select({ id: s.roles.id, name: s.roles.name }).from(s.roles).where(sql`lower(${s.roles.name}) = ${name.toLowerCase()} OR lower(${s.roles.key}) = ${name.toLowerCase()}`).get();
  return row ?? fail(`Role "${name}" was not found`);
}

function warehouseByCode(db: AppDb, auth: AuthContext, code: string): { id: string; code: string } {
  const row = db.select({ id: s.warehouses.id, code: s.warehouses.code }).from(s.warehouses).where(sql`upper(${s.warehouses.code}) = ${code.toUpperCase()}`).get();
  if (!row || !hasWarehouse(auth.scope, row.id)) return fail(`Warehouse "${code}" was not found`);
  return row;
}

function clientByCode(db: AppDb, auth: AuthContext, code: string): { id: string; code: string } {
  const row = db.select({ id: s.clients.id, code: s.clients.code }).from(s.clients).where(sql`upper(${s.clients.code}) = ${code.toUpperCase()}`).get();
  if (!row || (auth.scope.clientIds !== "all" && !auth.scope.clientIds.includes(row.id))) return fail(`Client "${code}" was not found`);
  return row;
}

function userByEmail(db: AppDb, email: string): UserDetail {
  const row = findUserByEmail(db, email.trim().toLowerCase());
  if (!row) return fail(`No user signs in with ${email}`);
  return getUser(db, row.id);
}

/** The current save payload of a user (password untouched), for read-modify-write imports. */
export function saveInputOf(d: UserDetail): UserSave {
  const name = splitFullName(d.name || d.email);
  return {
    firstName: d.firstName?.trim() || name.firstName, lastName: d.lastName?.trim() || name.lastName, email: d.email,
    userType: (USER_TYPES as readonly string[]).includes(d.userType) ? (d.userType as UserSave["userType"]) : "Operation",
    sendWelcomeEmail: false, isActive: d.isActive, password: "", confirmPassword: "",
    roleIds: [...d.roleIds], warehouseIds: [...d.warehouseIds], allClients: d.allClients, clientIds: [...d.clientIds], version: d.version,
  };
}

/**
 * "Bulk Import Users" row: creates the user (role + default warehouse + client access) or, when
 * the email exists, updates name / type / status and adds the role and warehouse.
 */
export function importUserRow(db: AppDb, auth: AuthContext, actor: Actor, row: Readonly<Record<string, ImportCell>>): { entityId: string; message: string } {
  const email = (str(row.email) ?? fail("Email is required")).toLowerCase();
  const { firstName, lastName } = splitFullName(str(row.name) ?? fail("Full Name is required"));
  const userType = importUserType(row.userType);
  const isActive = str(row.status) !== "Inactive";
  const roleName = str(row.roleName);
  const role = roleName ? roleByName(db, roleName) : null;
  const whCode = str(row.defaultWarehouseCode);
  const warehouse = whCode ? warehouseByCode(db, auth, whCode) : null;
  const allClients = row.allClients === null || row.allClients === undefined || row.allClients === "" ? true : row.allClients === true || /^(yes|true|1)$/i.test(String(row.allClients));

  const existing = findUserByEmail(db, email);
  if (!existing) {
    if (!role) fail("Role is required for a new user");
    if (!warehouse) fail("Default Warehouse Code is required for a new user");
    if (!allClients) fail("Set All Clients to Yes, then assign clients with the User-Client import");
    const password = generateTemporaryPassword();
    const created = createUser(db, auth, actor, {
      firstName, lastName, email, userType, sendWelcomeEmail: false, isActive, password, confirmPassword: password,
      roleIds: [role.id], warehouseIds: [warehouse.id], allClients: true, clientIds: [],
    });
    // Expired at once: the user can't sign in until an admin resets the password.
    db.update(s.users).set({ passwordChangedAt: null }).where(eq(s.users.id, created.id)).run();
    return { entityId: created.id, message: `User ${email} created. Use Reset password to issue a temporary password.` };
  }
  const current = saveInputOf(getUser(db, existing.id));
  const next: UserSave = {
    ...current, firstName, lastName, userType, isActive,
    roleIds: role ? applyLink(current.roleIds, role.id, "Assign") : current.roleIds,
    warehouseIds: warehouse ? applyLink(current.warehouseIds, warehouse.id, "Assign") : current.warehouseIds,
    // "All Clients = Yes" widens access; "No" never silently revokes it (use the User-Client import).
    allClients: allClients ? true : current.allClients,
  };
  updateUser(db, auth, actor, existing.id, next);
  return { entityId: existing.id, message: `User ${email} updated` };
}

/** "Import User-Role" / "User-Warehouse" / "User-Client" rows: assign or unassign one link. */
export function importUserLinkRow(db: AppDb, auth: AuthContext, actor: Actor, kind: LinkKind, row: Readonly<Record<string, ImportCell>>): { entityId: string; message: string } {
  const email = str(row.email) ?? fail("Email is required");
  const action = linkAction(row.action);
  const user = userByEmail(db, email);
  const current = saveInputOf(user);
  let next: UserSave;
  let label: string;
  if (kind === "role") {
    const role = roleByName(db, str(row.roleName) ?? fail("Role is required"));
    label = `role ${role.name}`;
    const roleIds = applyLink(current.roleIds, role.id, action);
    if (roleIds.length === 0) fail(`${user.email} needs at least one role. Assign another role before removing ${role.name}.`);
    next = { ...current, roleIds };
  } else if (kind === "warehouse") {
    const wh = warehouseByCode(db, auth, str(row.warehouseCode) ?? fail("Warehouse Code is required"));
    label = `warehouse ${wh.code}`;
    const warehouseIds = applyLink(current.warehouseIds, wh.id, action);
    if (warehouseIds.length === 0) fail(`${user.email} needs access to at least one warehouse.`);
    next = { ...current, warehouseIds };
  } else {
    const cl = clientByCode(db, auth, str(row.clientCode) ?? fail("Client Code is required"));
    label = `client ${cl.code}`;
    if (current.allClients && action === "Unassign") fail(`${user.email} has access to all clients. Edit the user and choose Select manually first.`);
    if (current.allClients && action === "Assign") return { entityId: user.id, message: `${user.email} already has access to all clients` };
    const clientIds = applyLink(current.clientIds, cl.id, action);
    if (clientIds.length === 0) fail(`${user.email} needs access to at least one client.`);
    next = { ...current, allClients: false, clientIds };
  }
  const unchanged = JSON.stringify([next.roleIds, next.warehouseIds, next.clientIds, next.allClients]) === JSON.stringify([current.roleIds, current.warehouseIds, current.clientIds, current.allClients]);
  if (unchanged) return { entityId: user.id, message: `${user.email}: ${label} was already ${action === "Assign" ? "assigned" : "unassigned"}` };
  updateUser(db, auth, actor, user.id, next);
  return { entityId: user.id, message: `${user.email}: ${label} ${action === "Assign" ? "assigned" : "unassigned"}` };
}
