/**
 * Per-user settings behind the grid and header (BUILD_PLAN F7): saved filter views,
 * column preferences and printer assignments. Every row belongs to the caller; shared
 * saved views are readable by everyone but only their owner can change them.
 */
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import { z } from 'zod';
import { DENSITIES, GRID_PAGE_SIZES } from '@/lib/enums';
import type { AppDb } from '@/server/api/db';
import { AppError, forbiddenError, notFoundError, validationError } from '@/server/api/errors';
import { hasWarehouse, type Scope } from '@/server/auth/scope';
import { savedViews, userGridPrefs, userPrinters, warehouses, type GridPrefs } from '@/server/db/schema';
import { parseGridQuery } from '@/server/query/grid-query';
import { assertVersion, idSchema, versionSchema } from './platform-common';

export type SavedViewRow = typeof savedViews.$inferSelect;

export const gridKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/, 'Invalid grid key');
const MAX_VIEW_QUERY = 4000;
const viewQuerySchema = z
  .string()
  .max(MAX_VIEW_QUERY)
  .refine((q) => parseGridQuery(new URLSearchParams(q)).issues.length === 0, 'Invalid filter query');
const fieldListSchema = z.array(z.string().trim().min(1).max(120)).max(200);

/* ------------------------------------------------------------- saved views */

export const savedViewListQuerySchema = z.object({ gridKey: gridKeySchema });

export const savedViewCreateSchema = z.object({
  gridKey: gridKeySchema,
  name: z.string().trim().min(1, 'Name is required').max(80),
  query: viewQuerySchema,
  isShared: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  pinnedFields: fieldListSchema.nullish(),
});

export const savedViewUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80).optional(),
  query: viewQuerySchema.optional(),
  isShared: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  pinnedFields: fieldListSchema.nullish(),
  version: versionSchema.optional(),
});

export async function listSavedViews(db: AppDb, userId: string, gridKey: string): Promise<SavedViewRow[]> {
  return await db
    .select()
    .from(savedViews)
    .where(
      and(eq(savedViews.gridKey, gridKey), or(eq(savedViews.userId, userId), eq(savedViews.isShared, true))),
    )
    .orderBy(asc(savedViews.name));
}

/** Visible to the caller (own or shared) — otherwise NOT_FOUND. */
export async function getSavedView(db: AppDb, userId: string, id: string): Promise<SavedViewRow> {
  const row = (await db.select().from(savedViews).where(eq(savedViews.id, id)).limit(1))[0];
  if (!row || (row.userId !== userId && !row.isShared)) throw notFoundError('Saved view');
  return row;
}

async function ownView(db: AppDb, userId: string, id: string): Promise<SavedViewRow> {
  const row = await getSavedView(db, userId, id);
  if (row.userId !== userId) throw forbiddenError('Only the owner can change this view');
  return row;
}

async function assertUniqueName(
  db: AppDb,
  userId: string,
  gridKey: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const clash = (
    await db
      .select({ id: savedViews.id })
      .from(savedViews)
      .where(and(eq(savedViews.userId, userId), eq(savedViews.gridKey, gridKey), eq(savedViews.name, name)))
      .limit(1)
  )[0];
  if (clash && clash.id !== exceptId)
    throw new AppError('DUPLICATE', `You already have a view named "${name}"`, {
      fieldErrors: { name: ['Already exists'] },
    });
}

async function clearDefault(db: AppDb, userId: string, gridKey: string, exceptId: string): Promise<void> {
  await db
    .update(savedViews)
    .set({ isDefault: false })
    .where(and(eq(savedViews.userId, userId), eq(savedViews.gridKey, gridKey), ne(savedViews.id, exceptId)));
}

export async function createSavedView(
  db: AppDb,
  userId: string,
  input: z.output<typeof savedViewCreateSchema>,
): Promise<SavedViewRow> {
  await assertUniqueName(db, userId, input.gridKey, input.name);
  const row = (
    await db
      .insert(savedViews)
      .values({
        ...input,
        pinnedFields: input.pinnedFields ?? null,
        userId,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()
  )[0];
  if (row.isDefault) await clearDefault(db, userId, row.gridKey, row.id);
  return row;
}

export async function updateSavedView(
  db: AppDb,
  userId: string,
  id: string,
  input: z.output<typeof savedViewUpdateSchema>,
): Promise<SavedViewRow> {
  const current = await ownView(db, userId, id);
  assertVersion(current.version, input.version);
  if (input.name !== undefined) await assertUniqueName(db, userId, current.gridKey, input.name, id);
  const updated = (
    await db
      .update(savedViews)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.query !== undefined ? { query: input.query } : {}),
        ...(input.isShared !== undefined ? { isShared: input.isShared } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.pinnedFields !== undefined ? { pinnedFields: input.pinnedFields } : {}),
        updatedBy: userId,
        version: current.version + 1,
      })
      .where(eq(savedViews.id, id))
      .returning()
  )[0];
  if (updated.isDefault) await clearDefault(db, userId, updated.gridKey, updated.id);
  return updated;
}

export async function deleteSavedView(db: AppDb, userId: string, id: string): Promise<{ id: string }> {
  await ownView(db, userId, id);
  await db.delete(savedViews).where(eq(savedViews.id, id));
  return { id };
}

/* -------------------------------------------------------------- grid prefs */

export const gridPrefsParamsSchema = z.object({ gridKey: gridKeySchema });

const gridPrefsShape = z.object({
  visible: fieldListSchema,
  order: fieldListSchema,
  widths: z
    .record(
      z.string().max(120),
      z
        .number()
        .min(24)
        .max(2000)
        .transform((n) => Math.round(n)),
    )
    .refine((w) => Object.keys(w).length <= 200, 'Too many columns'),
  density: z.enum(DENSITIES),
  pageSize: z
    .number()
    .int()
    .refine(
      (n) => (GRID_PAGE_SIZES as readonly number[]).includes(n),
      `Use one of ${GRID_PAGE_SIZES.join(', ')}`,
    ),
  pinned: fieldListSchema.optional(),
});

/**
 * PUT body for `/api/grid-prefs/[gridKey]`. Accepts the flat prefs object (current client)
 * and the legacy `{ prefs: {...} }` envelope, so an older tab never fails with a 400.
 */
export const gridPrefsSchema = z.preprocess(
  (raw) =>
    raw && typeof raw === 'object' && 'prefs' in raw && !('visible' in raw)
      ? (raw as { prefs: unknown }).prefs
      : raw,
  gridPrefsShape,
);

export async function getGridPrefs(db: AppDb, userId: string, gridKey: string): Promise<GridPrefs | null> {
  return (
    (
      await db
        .select({ prefs: userGridPrefs.prefs })
        .from(userGridPrefs)
        .where(and(eq(userGridPrefs.userId, userId), eq(userGridPrefs.gridKey, gridKey)))
        .limit(1)
    )[0]?.prefs ?? null
  );
}

export async function putGridPrefs(
  db: AppDb,
  userId: string,
  gridKey: string,
  prefs: GridPrefs,
): Promise<GridPrefs> {
  await db
    .insert(userGridPrefs)
    .values({ userId, gridKey, prefs })
    .onConflictDoUpdate({ target: [userGridPrefs.userId, userGridPrefs.gridKey], set: { prefs } });
  return prefs;
}

/* ---------------------------------------------------------------- printers */

const printerName = z
  .string()
  .trim()
  .max(120)
  .nullish()
  .transform((v) => (v ? v : null));

export const printerPutSchema = z.object({
  warehouseId: idSchema,
  barcodePrinter: printerName,
  laserPrinter: printerName,
});

export interface PrinterAssignment {
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
  readonly barcodePrinter: string | null;
  readonly laserPrinter: string | null;
  /** Printers registered in this warehouse (station defaults + any user's assignment). */
  readonly barcodePrinters: readonly string[];
  readonly laserPrinters: readonly string[];
}

/** Station printers every warehouse registers by default (Direct Print agent names). */
export function defaultStationPrinters(warehouseCode: string): {
  readonly barcode: readonly string[];
  readonly laser: readonly string[];
} {
  return {
    barcode: [
      `${warehouseCode}-ZEBRA-PACK-01`,
      `${warehouseCode}-ZEBRA-PACK-02`,
      `${warehouseCode}-ZEBRA-RECV-01`,
    ],
    laser: [`${warehouseCode}-HP-LASER-OFFICE`, `${warehouseCode}-HP-LASER-SHIP`],
  };
}

function uniqueSorted(values: readonly (string | null)[]): readonly string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));
}

/** One row per warehouse in scope (unassigned printers are null). */
export async function listPrinters(db: AppDb, userId: string, scope: Scope): Promise<PrinterAssignment[]> {
  if (scope.warehouseIds.length === 0) return [];
  const whs = await db
    .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name })
    .from(warehouses)
    .where(inArray(warehouses.id, [...scope.warehouseIds]))
    .orderBy(asc(warehouses.name));
  if (whs.length === 0) return [];
  const all = await db
    .select()
    .from(userPrinters)
    .where(
      inArray(
        userPrinters.warehouseId,
        whs.map((w) => w.id),
      ),
    );
  const assigned = new Map(all.filter((p) => p.userId === userId).map((p) => [p.warehouseId, p]));
  return whs.map((w) => {
    const inWarehouse = all.filter((p) => p.warehouseId === w.id);
    const defaults = defaultStationPrinters(w.code);
    return {
      warehouseId: w.id,
      warehouseCode: w.code,
      warehouseName: w.name,
      barcodePrinter: assigned.get(w.id)?.barcodePrinter ?? null,
      laserPrinter: assigned.get(w.id)?.laserPrinter ?? null,
      barcodePrinters: uniqueSorted([...defaults.barcode, ...inWarehouse.map((p) => p.barcodePrinter)]),
      laserPrinters: uniqueSorted([...defaults.laser, ...inWarehouse.map((p) => p.laserPrinter)]),
    };
  });
}

export async function putPrinters(
  db: AppDb,
  userId: string,
  scope: Scope,
  input: z.output<typeof printerPutSchema>,
): Promise<PrinterAssignment> {
  if (!hasWarehouse(scope, input.warehouseId))
    throw validationError('Warehouse not found', { warehouseId: ['Warehouse not found'] });
  const values = { barcodePrinter: input.barcodePrinter, laserPrinter: input.laserPrinter };
  await db
    .insert(userPrinters)
    .values({ userId, warehouseId: input.warehouseId, ...values })
    .onConflictDoUpdate({ target: [userPrinters.userId, userPrinters.warehouseId], set: values });
  const row = (await listPrinters(db, userId, { warehouseIds: [input.warehouseId], clientIds: 'all' }))[0];
  if (!row) throw notFoundError('Warehouse');
  return row;
}
