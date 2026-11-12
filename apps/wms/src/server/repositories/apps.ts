/**
 * Apps repository (M14): list with catalog presentation, activate / deactivate (feature
 * gates read `apps.is_active`, e.g. the wave-rule AI Job card) and per-app settings.
 * Changes write `change_log` (entity "app") and the route writes `audit_log`.
 */
import { eq } from "drizzle-orm";
import { asc } from "@/server/db/order";
import type { AppDb } from "@/server/api/db";
import { AppError, fromZodError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import * as s from "@/server/db/schema";
import { appSettingsSchema, defaultAppSettings, getAppDef, type AppDef } from "@/lib/grid-defs/admin/apps";
import { credentialHints, decryptCredentials, encryptCredentials, mergeCredentials } from "@/server/integrations/crypto";
import { domainCtxOf, logUpdate, type Actor } from "./users-shared";
import { mapSeq } from "@/server/db/sql";

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
  /** Last 4 characters of each saved secret field (`clientSecret` → "f00d"); values never leave the server. */
  readonly secretHints: Readonly<Record<string, string>>;
  readonly def: AppDef | null;
}

/** Secret fields live encrypted under this settings key (AES-256-GCM, integration vault). */
export const SEALED_KEY = "__sealed";
const secretKeys = (def: AppDef | null | undefined): string[] => (def?.settings ?? []).filter((f) => f.type === "secret").map((f) => f.key);

/** Decrypted secrets of an app (server only, e.g. the OIDC client secret). */
export function appSecrets(row: Pick<typeof s.apps.$inferSelect, "settings">): Readonly<Record<string, string>> {
  return decryptCredentials((row.settings as Record<string, unknown> | null)?.[SEALED_KEY] as string | undefined) ?? {};
}

function publicSettings(def: AppDef | null, raw: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(def ? defaultAppSettings(def) : {}), ...(raw ?? {}) };
  delete out[SEALED_KEY];
  for (const k of secretKeys(def)) out[k] = "";
  return out;
}

async function toRow(db: AppDb, r: typeof s.apps.$inferSelect): Promise<AppRow> {
  const def = getAppDef(r.key) ?? null;
  const by = r.activatedBy ? (await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, r.activatedBy)).limit(1))[0]?.name ?? null : null;
  return {
    key: r.key, name: r.name, description: r.description, category: r.category, isActive: Boolean(r.isActive), activatedAt: r.activatedAt,
    activatedByName: by, settings: publicSettings(def, r.settings ?? null), secretHints: credentialHints(decryptCredentials((r.settings as Record<string, unknown> | null)?.[SEALED_KEY] as string | undefined)), def,
  };
}

export async function listApps(db: AppDb): Promise<AppRow[]> {
  return await mapSeq((await db.select().from(s.apps).orderBy(asc(s.apps.name))), async (r) => await toRow(db, r));
}

export async function loadApp(db: AppDb, key: string): Promise<typeof s.apps.$inferSelect> {
  const row = (await db.select().from(s.apps).where(eq(s.apps.key, key)).limit(1))[0];
  if (!row) throw notFoundError("App");
  return row;
}

export async function isAppActive(db: AppDb, key: string): Promise<boolean> {
  return Boolean((await db.select({ on: s.apps.isActive }).from(s.apps).where(eq(s.apps.key, key)).limit(1))[0]?.on);
}

export async function setAppActive(tx: AppDb, auth: AuthContext, actor: Actor, key: string, isActive: boolean): Promise<AppRow> {
  const row = await loadApp(tx, key);
  if (Boolean(row.isActive) === isActive) throw new AppError("INVALID_STATE", `${row.name} is already ${isActive ? "active" : "inactive"}`);
  const def = getAppDef(key);
  if (isActive && def && def.settings.some((f) => f.required) && key === "sso") {
    const parsed = appSettingsSchema(def, { savedSecrets: new Set(Object.keys(appSecrets(row))) }).safeParse(publicSettings(def, row.settings ?? null));
    if (!parsed.success) throw new AppError("INVALID_STATE", "Configure single sign-on (gear) before activating it");
  }
  await tx.update(s.apps).set({ isActive, activatedAt: isActive ? new Date().toISOString() : null, activatedBy: isActive ? actor.userId : null }).where(eq(s.apps.key, key));
  await logUpdate(tx, domainCtxOf(actor, auth), { entityType: APP_ENTITY, entityId: key, entityCode: row.name }, { status: row.isActive ? "Activated" : "Not activated" }, { status: isActive ? "Activated" : "Not activated" });
  return await toRow(tx, await loadApp(tx, key));
}

export async function updateAppSettings(tx: AppDb, auth: AuthContext, actor: Actor, key: string, settings: unknown): Promise<AppRow> {
  const row = await loadApp(tx, key);
  const def = getAppDef(key);
  if (!def || def.settings.length === 0) throw new AppError("INVALID_STATE", `${row.name} has no settings`);
  const stored = appSecrets(row);
  const parsed = appSettingsSchema(def, { savedSecrets: new Set(Object.keys(stored)) }).safeParse(settings);
  if (!parsed.success) throw fromZodError(parsed.error, "Check the highlighted settings");
  const before = publicSettings(def, row.settings ?? null);
  const values = { ...(parsed.data as Record<string, unknown>) };
  const secretEdit: Record<string, string> = {};
  for (const k of secretKeys(def)) { secretEdit[k] = String(values[k] ?? ""); delete values[k]; }
  const sealed = mergeCredentials(stored, secretEdit);
  const next: Record<string, unknown> = { ...values, ...(Object.keys(sealed).length > 0 ? { [SEALED_KEY]: encryptCredentials(sealed) } : {}) };
  await tx.update(s.apps).set({ settings: next }).where(eq(s.apps.key, key));
  const changedSecrets = new Set(Object.entries(secretEdit).filter(([, v]) => v.trim() !== "").map(([k]) => k));
  const label = (o: Record<string, unknown>, after: boolean) => Object.fromEntries(def.settings.map((f) => [f.label,
    f.type === "secret" ? (after && changedSecrets.has(f.key) ? "(changed)" : stored[f.key] ? "(set)" : "") : f.type === "textarea" && o[f.key] ? "(set)" : o[f.key]]));
  await logUpdate(tx, domainCtxOf(actor, auth), { entityType: APP_ENTITY, entityId: key, entityCode: row.name }, label(before, false), label(values, true));
  return await toRow(tx, await loadApp(tx, key));
}
