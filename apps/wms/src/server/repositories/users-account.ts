/**
 * Self-service account (M14): My Profile edits, Change Password with session rotation, and
 * the timezone shown on Preferences (from the user's default / first warehouse).
 */
import { eq, sql } from "drizzle-orm";
import { asc } from "@/server/db/order";
import type { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { bumpSessionVersion } from "@/server/auth/session-store";
import * as s from "@/server/db/schema";
import type { profileSchema } from "@/lib/grid-defs/admin/account";
import { assertPasswordPolicy, loadUser, USER_ENTITY } from "./users";
import { domainCtxOf, duplicateError, logUpdate, type Actor } from "./users-shared";

type ProfileInput = z.output<typeof profileSchema>;

export async function updateOwnProfile(tx: AppDb, auth: AuthContext, actor: Actor, input: ProfileInput): Promise<{ name: string; email: string; emailChanged: boolean }> {
  const before = await loadUser(tx, auth.user.id);
  const email = input.email.toLowerCase();
  const emailChanged = email !== before.email;
  if (emailChanged) {
    if (!input.currentPassword) throw new AppError("VALIDATION", "Enter your current password to change your email", { fieldErrors: { currentPassword: ["Required to change your email"] } });
    if (!verifyPassword(input.currentPassword, before.passwordHash)) throw new AppError("VALIDATION", "Current password is incorrect", { fieldErrors: { currentPassword: ["Current password is incorrect"] } });
    const clash = (await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email)).limit(1))[0];
    if (clash && clash.id !== before.id) throw duplicateError("email", `${email} is already used by another user`);
  }
  const after = { name: input.displayName.trim(), firstName: input.firstName.trim(), lastName: input.lastName.trim(), email };
  await tx.update(s.users).set({ ...after, updatedBy: actor.userId, updatedAt: new Date().toISOString(), version: sql`${s.users.version} + 1` }).where(eq(s.users.id, before.id));
  await logUpdate(tx, domainCtxOf(actor, auth), { entityType: USER_ENTITY, entityId: before.id, entityCode: email },
    { name: before.name, firstName: before.firstName, lastName: before.lastName, email: before.email }, after);
  return { name: after.name, email, emailChanged };
}

/** Verifies the current password, applies the policy, sets the new hash and ends every session. */
export async function changeOwnPassword(tx: AppDb, auth: AuthContext, actor: Actor, currentPassword: string, newPassword: string): Promise<void> {
  const row = await loadUser(tx, auth.user.id);
  if (!verifyPassword(currentPassword, row.passwordHash)) {
    throw new AppError("VALIDATION", "Current password is incorrect", { fieldErrors: { currentPassword: ["Current password is incorrect"] } });
  }
  if (currentPassword === newPassword) throw new AppError("VALIDATION", "Choose a password you have not just used", { fieldErrors: { newPassword: ["Must differ from the current password"] } });
  await assertPasswordPolicy(tx, newPassword, row.email, "newPassword");
  const now = new Date();
  await tx.update(s.users).set({ passwordHash: hashPassword(newPassword), passwordChangedAt: now.toISOString(), failedLoginCount: 0, lockedUntil: null }).where(eq(s.users.id, row.id));
  await logUpdate(tx, domainCtxOf(actor, auth), { entityType: USER_ENTITY, entityId: row.id, entityCode: row.email }, { password: "••••" }, { password: "Changed by the user" });
  await bumpSessionVersion(tx, row.id, now);
}

/** Timezone of the user's default warehouse (or the first one in scope). */
export async function accountTimezone(db: AppDb, auth: AuthContext, defaultWarehouseId?: string | null): Promise<{ timezone: string; warehouse: string | null }> {
  const ids = auth.scope.warehouseIds;
  const pick = defaultWarehouseId && ids.includes(defaultWarehouseId) ? defaultWarehouseId : (auth.context.warehouseId ?? ids[0] ?? null);
  const row = pick
    ? (await db.select({ timezone: s.warehouses.timezone, code: s.warehouses.code, name: s.warehouses.name }).from(s.warehouses).where(eq(s.warehouses.id, pick)).limit(1))[0]
    : (await db.select({ timezone: s.warehouses.timezone, code: s.warehouses.code, name: s.warehouses.name }).from(s.warehouses).orderBy(asc(s.warehouses.code)).limit(1))[0];
  return { timezone: row?.timezone ?? "America/Chicago", warehouse: row?.name ?? null };
}
