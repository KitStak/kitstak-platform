/**
 * Permission resolution + checks (server).
 *
 * Effective permissions of a user:
 *   - legacy role `admin`  → every catalog key (owner/superuser; cannot be locked out);
 *   - has `user_roles` rows → union of their `role_permissions` (+ self-service keys);
 *   - no role rows yet     → `DEFAULT_ROLE_PERMISSIONS[users.role]` (pre-seed fallback).
 * Restrictions (carrier cost, carrier account data, rate shopping data) are the union of the
 * assigned roles' `restrictions`, applied by serializers through `redactFor`.
 */
import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { rolePermissions, roles, userRoles } from "@/server/db/schema";
import type { ROLE_RESTRICTIONS } from "@/lib/enums";
import { getAppDb, type AppDb } from "@/server/api/db";
import { forbiddenError } from "@/server/api/errors";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_KEYS,
  SELF_SERVICE_PERMISSIONS,
  isPermissionKey,
  type PermissionKey,
} from "./permission-catalog";
import { getSessionUser, type SessionUser } from "./session";

export type Restriction = (typeof ROLE_RESTRICTIONS)[number];

export interface PermissionGrant {
  readonly permissions: ReadonlySet<PermissionKey>;
  readonly restrictions: readonly Restriction[];
  readonly roleKeys: readonly string[];
}

/** Anything that carries a permission set (an AuthContext, a principal, a test double). */
export interface HasPermissions {
  readonly permissions: ReadonlySet<PermissionKey>;
}

export function loadPermissions(db: AppDb, user: Pick<SessionUser, "id" | "role">): PermissionGrant {
  const assigned = db
    .select({ id: roles.id, key: roles.key, restrictions: roles.restrictions })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, user.id))
    .all();

  const restrictions = [...new Set(assigned.flatMap((r) => r.restrictions ?? []))];
  const roleKeys = assigned.map((r) => r.key);

  if (user.role === "admin") {
    return { permissions: new Set(PERMISSION_KEYS), restrictions, roleKeys };
  }
  if (assigned.length === 0) {
    return { permissions: new Set(DEFAULT_ROLE_PERMISSIONS[user.role]), restrictions, roleKeys };
  }
  const granted = db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, assigned.map((r) => r.id)))
    .all()
    .map((r) => r.permission)
    .filter(isPermissionKey);
  return { permissions: new Set([...granted, ...SELF_SERVICE_PERMISSIONS]), restrictions, roleKeys };
}

export function can(subject: HasPermissions, key: PermissionKey): boolean {
  return subject.permissions.has(key);
}

export function canAny(subject: HasPermissions, keys: readonly PermissionKey[]): boolean {
  return keys.some((k) => subject.permissions.has(k));
}

/** Throws FORBIDDEN unless the subject holds `key` (or any of `key[]`). */
export function requirePermission(subject: HasPermissions, key: PermissionKey | readonly PermissionKey[]): void {
  const keys = typeof key === "string" ? [key] : key;
  if (!canAny(subject, keys)) throw forbiddenError();
}

export const FORBIDDEN_PATH = "/forbidden";

export interface PageAuth extends PermissionGrant {
  readonly user: SessionUser;
}

/**
 * For server components: ensures a session (else redirect to /login) and the permission
 * (else redirect to the shared 403 page `/forbidden`, owned by F4). Returns the grant.
 */
export async function requirePagePermission(key: PermissionKey | readonly PermissionKey[], from?: string): Promise<PageAuth> {
  const user = await getSessionUser();
  if (!user) redirect(from ? `/login?next=${encodeURIComponent(from)}` : "/login");
  const grant = loadPermissions(await getAppDb(), user);
  const keys = typeof key === "string" ? [key] : key;
  if (!canAny(grant, keys)) redirect(from ? `${FORBIDDEN_PATH}?from=${encodeURIComponent(from)}` : FORBIDDEN_PATH);
  return { user, ...grant };
}

/* ------------------------------ Data restrictions ------------------------------ */

/** Default field names hidden per restriction (serializers may pass their own map). */
export const RESTRICTED_FIELDS: Readonly<Record<Restriction, readonly string[]>> = {
  carrier_cost: ["shippingCost", "carrierCost", "carrierFee", "rate", "rateAmount", "totalCharge", "labelCost", "insuranceCost"],
  carrier_account_data: ["accountNumber", "carrierAccountNumber", "billingAccount", "billingZip", "meterNumber"],
  rate_shopping_data: ["rateShoppingResult", "rateQuotes", "rateShopRuleId", "selectedRate", "rateShoppingLog"],
};

/**
 * Returns a copy of `row` with every field covered by the subject's restrictions set to null.
 * Never mutates the input.
 */
export function redactFor<T extends Record<string, unknown>>(
  subject: { readonly restrictions: readonly Restriction[] },
  row: T,
  fields: Partial<Readonly<Record<Restriction, readonly string[]>>> = RESTRICTED_FIELDS,
): T {
  if (subject.restrictions.length === 0) return row;
  const hidden = new Set(subject.restrictions.flatMap((r) => fields[r] ?? []));
  const entries = Object.entries(row).map(([k, v]) => [k, hidden.has(k) ? null : v] as const);
  return Object.fromEntries(entries) as T;
}
