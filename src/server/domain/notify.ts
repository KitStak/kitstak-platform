/** In-app notifications (BUILD_PLAN F5 `notify(tx, userIds | roleKey, payload)`). */
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { isOneOf, LEGACY_USER_ROLES, NOTIFICATION_SEVERITIES } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import type { Tx } from "./types";

export const notificationPayloadSchema = z.object({
  kind: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional(),
  href: z.string().startsWith("/").max(500).optional(),
  severity: z.enum(NOTIFICATION_SEVERITIES).default("info"),
});
export type NotificationPayload = z.input<typeof notificationPayloadSchema>;

export type NotifyTarget = readonly string[] | { readonly roleKey: string };

function resolveUsers(tx: Tx, target: NotifyTarget): string[] {
  if (Array.isArray(target)) {
    const ids = [...new Set(target as readonly string[])];
    if (ids.length === 0) return [];
    return tx.select({ id: schema.users.id }).from(schema.users)
      .where(and(inArray(schema.users.id, ids), eq(schema.users.isActive, true))).all().map((u) => u.id);
  }
  const { roleKey } = target as { roleKey: string };
  const viaRoles = tx.select({ id: schema.userRoles.userId }).from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId)).where(eq(schema.roles.key, roleKey)).all().map((r) => r.id);
  const legacyRole = isOneOf(LEGACY_USER_ROLES, roleKey) ? roleKey : null;
  if (viaRoles.length === 0 && !legacyRole) return [];
  return tx.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.isActive, true),
    or(viaRoles.length > 0 ? inArray(schema.users.id, viaRoles) : undefined, legacyRole ? eq(schema.users.role, legacyRole) : undefined))).all()
    .map((r) => r.id);
}

/** Inserts one notification per active target user. Returns the number written. */
export function notify(tx: Tx, target: NotifyTarget, payload: NotificationPayload): number {
  const p = notificationPayloadSchema.parse(payload);
  const userIds = resolveUsers(tx, target);
  if (userIds.length === 0) return 0;
  tx.insert(schema.notifications).values(userIds.map((userId) => ({
    userId, kind: p.kind, title: p.title, body: p.body ?? null, href: p.href ?? null, severity: p.severity,
  }))).run();
  return userIds.length;
}
