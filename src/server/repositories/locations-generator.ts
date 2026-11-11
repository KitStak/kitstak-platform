/**
 * Bulk Location Generator (M10): preview (count, first codes, collisions) and create.
 * Small runs are one transaction; runs above GENERATOR_BACKGROUND_ABOVE are created in
 * chunked transactions after the response, and the user is notified when done.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import * as s from "@/server/db/schema";
import { notify } from "@/server/domain/notify";
import { expandPattern, GENERATOR_PREVIEW_COUNT, type GeneratedLocation, type GeneratorSpec } from "@/lib/grid-defs/facility/location-generator";
import { legacyRoleFor } from "@/lib/grid-defs/facility/locations";
import { assertWarehouseInScope, domainCtxOf, logCreate, type Actor } from "./locations-shared";
import { withWriteTx } from "@/server/db/sql";

const CHUNK = 250;

export interface GeneratorPreview {
  readonly total: number;
  readonly sample: readonly string[];
  readonly collisions: readonly string[];
  readonly collisionCount: number;
  readonly createCount: number;
}

async function existingCodes(db: AppDb, warehouseId: string, codes: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < codes.length; i += 500) {
    const slice = codes.slice(i, i + 500).map((c) => c.toLowerCase());
    (await db.select({ code: s.locations.code }).from(s.locations)
      .where(and(eq(s.locations.warehouseId, warehouseId), inArray(sql`lower(${s.locations.code})`, slice)))).forEach((r) => found.add(r.code.toLowerCase()));
  }
  return found;
}

/**
 * The legacy `locations.zone` text mirrors the Location Zone lookup name, as the wizard and the
 * import do. The pattern's code prefix (`spec.zone`) is only the first code segment and never
 * becomes a zone (critic R4: a prefix showed as "Location zone" that the filter, zone strip and
 * editor could not find).
 */
async function zoneName(db: AppDb, spec: GeneratorSpec): Promise<string> {
  if (!spec.locationZoneId) return "";
  const row = (await db.select({ name: s.lookupValues.name, warehouseId: s.lookupValues.warehouseId }).from(s.lookupValues)
    .where(and(eq(s.lookupValues.id, spec.locationZoneId), eq(s.lookupValues.type, "location_zone"))).limit(1))[0];
  if (!row || (row.warehouseId && row.warehouseId !== spec.warehouseId)) {
    throw new AppError("VALIDATION", "Pick a zone from this warehouse", { fieldErrors: { locationZoneId: ["Pick a zone from this warehouse"] } });
  }
  return row.name;
}

export async function previewGenerator(db: AppDb, auth: AuthContext, spec: GeneratorSpec): Promise<GeneratorPreview> {
  assertWarehouseInScope(auth, spec.warehouseId);
  const all = expandPattern(spec);
  const clash = await existingCodes(db, spec.warehouseId, all.map((g) => g.code));
  const collisions = all.filter((g) => clash.has(g.code.toLowerCase())).map((g) => g.code);
  return {
    total: all.length,
    sample: all.slice(0, GENERATOR_PREVIEW_COUNT).map((g) => g.code),
    collisions: collisions.slice(0, 50),
    collisionCount: collisions.length,
    createCount: all.length - collisions.length,
  };
}

async function insertChunk(tx: AppDb, auth: AuthContext, actor: Actor, spec: GeneratorSpec, zone: string, rows: readonly GeneratedLocation[]): Promise<number> {
  const ctx = domainCtxOf(actor, auth);
  let created = 0;
  for (const g of rows) {
    const row = (await tx.insert(s.locations).values({
      warehouseId: spec.warehouseId,
      code: g.code,
      barcode: g.code,
      zone,
      aisle: g.aisle,
      bay: g.rack,
      rack: g.rack,
      level: g.level,
      position: g.position,
      type: legacyRoleFor(spec.areaType),
      capacityUnits: 0,
      locationType: spec.locationType,
      areaType: spec.areaType,
      locationZoneId: spec.locationZoneId,
      locationGroupId: spec.locationGroupId,
      walkingPathPriority: spec.walkingPathStart + g.index * spec.walkingPathStep,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }).returning({ id: s.locations.id }))[0];
    await logCreate(tx, ctx, { entityType: "location", entityId: row.id, entityCode: g.code });
    created += 1;
  }
  return created;
}

export interface GeneratorResult {
  readonly created: number;
  readonly skipped: number;
  readonly collisions: readonly string[];
  readonly background: boolean;
}

/** Plans a run: what will be created and whether collisions block it. */
export async function planGenerator(db: AppDb, auth: AuthContext, spec: GeneratorSpec, skipExisting: boolean): Promise<{ rows: GeneratedLocation[]; collisions: string[]; zone: string }> {
  assertWarehouseInScope(auth, spec.warehouseId);
  const zone = await zoneName(db, spec);
  if (spec.locationGroupId) {
    const g = (await db.select({ id: s.lookupValues.id }).from(s.lookupValues).where(and(eq(s.lookupValues.id, spec.locationGroupId), eq(s.lookupValues.type, "location_group"))).limit(1))[0];
    if (!g) throw new AppError("VALIDATION", "Pick a location group", { fieldErrors: { locationGroupId: ["Pick a location group"] } });
  }
  const all = expandPattern(spec);
  const clash = await existingCodes(db, spec.warehouseId, all.map((g) => g.code));
  const collisions = all.filter((g) => clash.has(g.code.toLowerCase())).map((g) => g.code);
  const rows = skipExisting ? all.filter((g) => !clash.has(g.code.toLowerCase())) : collisions.length > 0 ? [] : [...all];
  return { rows, collisions, zone };
}

/** Single-transaction create (caller's tx). */
export async function runGeneratorNow(tx: AppDb, auth: AuthContext, actor: Actor, spec: GeneratorSpec, plan: Awaited<ReturnType<typeof planGenerator>>): Promise<GeneratorResult> {
  const created = plan.rows.length > 0 ? await insertChunk(tx, auth, actor, spec, plan.zone, plan.rows) : 0;
  return { created, skipped: plan.collisions.length, collisions: plan.collisions.slice(0, 50), background: false };
}

/** Background create in chunked transactions; notifies the user at the end. Never throws. */
export async function runGeneratorInBackground(db: AppDb, auth: AuthContext, actor: Actor, spec: GeneratorSpec, plan: Awaited<ReturnType<typeof planGenerator>>): Promise<void> {
  let created = 0;
  let error: string | null = null;
  try {
    for (let i = 0; i < plan.rows.length; i += CHUNK) {
      const slice = plan.rows.slice(i, i + CHUNK);
      created += (await withWriteTx(db, async (tx) => await insertChunk(tx, auth, actor, spec, plan.zone, slice)));
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Unexpected error";
  }
  const target = actor.userId ? [actor.userId] : [];
  await withWriteTx(db, async (tx) => await notify(tx, target, error
    ? { kind: "locations.generator", title: "Location generator stopped", body: `${created.toLocaleString("en-US")} locations were created before an error: ${error}`, href: "/locations", severity: "error" }
    : { kind: "locations.generator", title: "Locations created", body: `${created.toLocaleString("en-US")} locations were created${plan.collisions.length ? ` · ${plan.collisions.length} existing codes skipped` : ""}.`, href: "/locations?sort=-createdAt", severity: "success" }));
}
