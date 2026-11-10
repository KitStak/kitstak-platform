/**
 * Apps repository (M14): list with catalog presentation, activate / deactivate (feature
 * gates read `apps.is_active`, e.g. the wave-rule AI Job card) and per-app settings.
 * Changes write `change_log` (entity "app") and the route writes `audit_log`.
 */
import { asc, eq } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError, fromZodError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import * as s from "@/server/db/schema";
import { appSettingsSchema, defaultAppSettings, getAppDef, type AppDef } from "@/lib/grid-defs/admin/apps";
import { domainCtxOf, logUpdate, type Actor } from "./users-shared";

export const APP_ENTITY = "app";

export interface AppRow {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly isActive: boolean;
  readonly activatedAt: string | null;
  readonly activatedByName: string | null;
  readonly settings: Record<string, unknown>;
  readonly def: AppDef | null;
}

function toRow(db: AppDb, r: typeof s.apps.$inferSelect): AppRow {
  const def = getAppDef(r.key) ?? null;
  const by = r.activatedBy ? db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, r.activatedBy)).get()?.name ?? null : null;
  return {
    key: r.key, name: r.name, description: r.description, category: r.category, isActive: Boolean(r.isActive), activatedAt: r.activatedAt,
    activatedByName: by, settings: { ...(def ? defaultAppSettings(def) : {}), ...(r.settings ?? {}) }, def,
  };
}

export function listApps(db: AppDb): AppRow[] {
  return db.select().from(s.apps).orderBy(asc(s.apps.name)).all().map((r) => toRow(db, r));
}

export function loadApp(db: AppDb, key: string): typeof s.apps.$inferSelect {
  const row = db.select().from(s.apps).where(eq(s.apps.key, key)).get();
  if (!row) throw notFoundError("App");
  return row;
}

export function isAppActive(db: AppDb, key: string): boolean {
  return Boolean(db.select({ on: s.apps.isActive }).from(s.apps).where(eq(s.apps.key, key)).get()?.on);
}

export function setAppActive(tx: AppDb, auth: AuthContext, actor: Actor, key: string, isActive: boolean): AppRow {
  const row = loadApp(tx, key);
  if (Boolean(row.isActive) === isActive) throw new AppError("INVALID_STATE", `${row.name} is already ${isActive ? "active" : "inactive"}`);
  const def = getAppDef(key);
  if (isActive && def && def.settings.some((f) => f.required) && key === "sso") {
    const parsed = appSettingsSchema(def).safeParse(row.settings ?? {});
    if (!parsed.success) throw new AppError("INVALID_STATE", "Configure single sign-on (gear) before activating it");
  }
  tx.update(s.apps).set({ isActive, activatedAt: isActive ? new Date().toISOString() : null, activatedBy: isActive ? actor.userId : null }).where(eq(s.apps.key, key)).run();
  logUpdate(tx, domainCtxOf(actor, auth), { entityType: APP_ENTITY, entityId: key, entityCode: row.name }, { status: row.isActive ? "Activated" : "Not activated" }, { status: isActive ? "Activated" : "Not activated" });
  return toRow(tx, loadApp(tx, key));
}

export function updateAppSettings(tx: AppDb, auth: AuthContext, actor: Actor, key: string, settings: unknown): AppRow {
  const row = loadApp(tx, key);
  const def = getAppDef(key);
  if (!def || def.settings.length === 0) throw new AppError("INVALID_STATE", `${row.name} has no settings`);
  const parsed = appSettingsSchema(def).safeParse(settings);
  if (!parsed.success) throw fromZodError(parsed.error, "Check the highlighted settings");
  const before = { ...defaultAppSettings(def), ...(row.settings ?? {}) };
  const next = parsed.data as Record<string, unknown>;
  tx.update(s.apps).set({ settings: next }).where(eq(s.apps.key, key)).run();
  const label = (o: Record<string, unknown>) => Object.fromEntries(def.settings.map((f) => [f.label, f.type === "textarea" && o[f.key] ? "(set)" : o[f.key]]));
  logUpdate(tx, domainCtxOf(actor, auth), { entityType: APP_ENTITY, entityId: key, entityCode: row.name }, label(before), label(next));
  return toRow(tx, loadApp(tx, key));
}
