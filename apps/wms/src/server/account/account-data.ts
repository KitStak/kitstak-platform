import { eq, inArray } from "drizzle-orm";
import { userPreferencesSchema, type UserPreferences } from "@/lib/domain-types";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { getPasswordPolicy } from "@/server/auth/password-policy";
import { users, warehouses } from "@/server/db/schema";
import { codeNameLabel } from "@/lib/utils";
import type { PasswordPolicyHints } from "@/components/layout/password-checks";

export interface AccountProfile {
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly userType: string | null;
  readonly isApiUser: boolean;
  readonly allClients: boolean;
  readonly lastLoginAt: string | null;
  readonly passwordChangedAt: string | null;
  readonly createdAt: string | null;
  readonly warehouses: readonly string[];
}

/** The signed-in user's own profile (never another user's: keyed by the session). */
export async function loadAccountProfile(db: AppDb, auth: AuthContext): Promise<AccountProfile | null> {
  const row = (await db
    .select({
      name: users.name,
      email: users.email,
      role: users.role,
      userType: users.userType,
      isApiUser: users.isApiUser,
      allClients: users.allClients,
      lastLoginAt: users.lastLoginAt,
      passwordChangedAt: users.passwordChangedAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, auth.user.id)).limit(1))[0];
  if (!row) return null;
  const whRows = auth.scope.warehouseIds.length
    ? await db.select({ code: warehouses.code, name: warehouses.name }).from(warehouses).where(inArray(warehouses.id, [...auth.scope.warehouseIds]))
    : [];
  return {
    ...row,
    name: row.name || row.email,
    userType: row.userType ?? null,
    isApiUser: Boolean(row.isApiUser),
    allClients: Boolean(row.allClients),
    warehouses: whRows.map((w) => codeNameLabel(w.code, w.name)).sort(),
  };
}

/** Stored preferences with defaults filled (invalid JSON falls back to defaults). */
export async function loadAccountPreferences(db: AppDb, userId: string): Promise<UserPreferences> {
  const row = (await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const parsed = userPreferencesSchema.safeParse(row?.preferences ?? {});
  return parsed.success ? parsed.data : userPreferencesSchema.parse({});
}

/** Client-side mirror of the company password policy (checklist hints only; the API enforces). */
export async function loadPasswordPolicyHints(db: AppDb): Promise<PasswordPolicyHints> {
  const policy = await getPasswordPolicy(db);
  return { minLength: policy.minLength, requireUpper: policy.requireUpper, requireNumber: policy.requireNumber, requireSymbol: policy.requireSymbol };
}
