/**
 * Carrier follow-up operations for M02 (Carrier Shipment Details and End Of The Day):
 * - Refresh tracking: asks the carrier for the package status and fills Actual pickup and Delivery
 *   date. A connection served by the offline simulation derives the status from the label's own
 *   facts (manifest closed / pickup time passed → picked up; expected delivery passed → delivered).
 * - Schedule pickup: books a carrier pickup for an End Of The Day manifest and stamps Scheduled
 *   pickup on every active package of it.
 * - Auto-close: per warehouse and carrier setup, closes Open manifests at a cutoff time (scheduler
 *   task `eod-auto-close`), plus the overdue summary behind the EOD warning banner.
 *
 * Every carrier call is written to `carrier_call_logs` (steps Tracking / Pickup), so the package
 * drawer's Carrier activity and the carrier-error filter show it.
 */
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { localParts, toMinutes, zonedToUtc } from '@/lib/grid-defs/jobs/schedule';
import type { AppDb } from '@/server/api/db';
import { AppError, notFoundError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { assertInScope, hasWarehouse } from '@/server/auth/scope';
import * as schema from '@/server/db/schema';
import { recordUpdate } from '@/server/domain/change-log';
import { localDate, writeCallLog } from '@/server/domain/shipping/common';
import type { BulkResult, DomainCtx } from '@/server/domain/types';
import { carrierCallMode } from '@/server/integrations/carriers/common';
import { buildEodRows, closeManifests, resolveGroup, type EodRow } from './end-of-day';
import { dbAll, dbGet, dbRun, withWriteTx } from '@/server/db/sql';

/* ------------------------------------------------------------- tracking */

export type TrackingStatus = 'Label created' | 'Picked up' | 'In transit' | 'Delivered';

export interface TrackingFacts {
  readonly labelCreatedAt: string;
  readonly actualShipmentAt: string | null;
  readonly actualPickupAt: string | null;
  readonly scheduledPickupAt: string | null;
  readonly manifestClosedAt: string | null;
  readonly expectedDeliveryAt: string | null;
  readonly deliveredAt: string | null;
}

export interface TrackingResult {
  readonly status: TrackingStatus;
  readonly pickupAt: string | null;
  readonly deliveredAt: string | null;
  readonly events: readonly { readonly at: string; readonly status: TrackingStatus }[];
}

/**
 * Simulated carrier tracking (PURE). Pickup is the first of: a recorded pickup, the manifest close, a
 * scheduled pickup that has passed, the order's ship time. Delivered once the carrier's expected
 * delivery date has passed after pickup. Nothing is invented for a package the carrier never got.
 */
export function simulateTracking(f: TrackingFacts, now: Date): TrackingResult {
  const nowIso = now.toISOString();
  const passed = (iso: string | null): iso is string => Boolean(iso) && (iso as string) <= nowIso;
  const pickupAt =
    f.actualPickupAt ??
    (passed(f.manifestClosedAt) ? f.manifestClosedAt : null) ??
    (passed(f.scheduledPickupAt) && f.actualShipmentAt ? f.scheduledPickupAt : null) ??
    (passed(f.actualShipmentAt) ? f.actualShipmentAt : null);
  const events: { at: string; status: TrackingStatus }[] = [
    { at: f.labelCreatedAt, status: 'Label created' },
  ];
  if (!pickupAt) return { status: 'Label created', pickupAt: null, deliveredAt: null, events };
  events.push({ at: pickupAt, status: 'Picked up' });
  const deliveredAt =
    f.deliveredAt ??
    (passed(f.expectedDeliveryAt) && (f.expectedDeliveryAt as string) > pickupAt
      ? f.expectedDeliveryAt
      : null);
  if (deliveredAt) {
    events.push({ at: deliveredAt, status: 'Delivered' });
    return { status: 'Delivered', pickupAt, deliveredAt, events };
  }
  return { status: pickupAt === nowIso ? 'Picked up' : 'In transit', pickupAt, deliveredAt: null, events };
}

export const refreshTrackingSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1, 'Select at least one package').max(200),
});

export interface TrackingOutcome {
  readonly id: string;
  readonly trackingNumber: string;
  readonly status: TrackingStatus;
  readonly pickupAt: string | null;
  readonly deliveredAt: string | null;
}

export interface RefreshTrackingResult extends BulkResult {
  readonly outcomes: readonly TrackingOutcome[];
}

export async function refreshTracking(
  db: AppDb,
  auth: AuthContext,
  ctx: DomainCtx,
  ids: readonly string[],
  now: Date = new Date(),
): Promise<RefreshTrackingResult> {
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  const outcomes: TrackingOutcome[] = [];
  for (const id of [...new Set(ids)]) {
    const startedAt = Date.now();
    const s = (await db.select().from(schema.shipments).where(eq(schema.shipments.id, id)).limit(1))[0];
    try {
      if (!s) throw notFoundError('Shipment');
      assertInScope(auth.scope, s, 'Shipment');
      if (s.labelStatus === 'Voided')
        throw new AppError(
          'INVALID_STATE',
          `${s.trackingNumber}: the label is voided, so the carrier has nothing to track.`,
        );
      const connection = s.carrierConnectionId
        ? (
            await db
              .select()
              .from(schema.carrierConnections)
              .where(eq(schema.carrierConnections.id, s.carrierConnectionId))
              .limit(1)
          )[0]
        : undefined;
      if (!connection)
        throw new AppError('INVALID_STATE', `${s.trackingNumber}: the label has no carrier connection.`);
      const order =
        (
          await db
            .select()
            .from(schema.shipmentOrders)
            .where(eq(schema.shipmentOrders.id, s.orderId))
            .limit(1)
        )[0] ?? null;
      const mode = carrierCallMode(connection);
      if (mode !== 'simulated') {
        const message = `Tracking isn't available through the ${connection.provider} integration yet; open the carrier's tracking page instead.`;
        await writeCallLog(db, ctx, {
          step: 'Tracking',
          connection,
          order,
          shipmentId: s.id,
          trackingNumber: s.trackingNumber,
          ok: false,
          httpCode: 501,
          error: message,
          startedAt,
          serviceName: s.serviceName,
          source: 'CarrierShipmentDetails',
          labelType: s.labelType,
          request: { trackingNumber: s.trackingNumber, mode },
          response: { error: message },
        });
        throw new AppError('INVALID_STATE', `${s.trackingNumber}: ${message}`);
      }
      const manifest = s.endOfDayManifestId
        ? (
            await db
              .select()
              .from(schema.endOfDayManifests)
              .where(eq(schema.endOfDayManifests.id, s.endOfDayManifestId))
              .limit(1)
          )[0]
        : undefined;
      const result = simulateTracking(
        {
          labelCreatedAt: s.labelCreatedAt,
          actualShipmentAt: s.actualShipmentAt,
          actualPickupAt: s.actualPickupAt,
          scheduledPickupAt: s.scheduledPickupAt,
          manifestClosedAt: manifest?.status === 'Closed' ? manifest.closeDate : null,
          expectedDeliveryAt: s.carrierExpectedDeliveryAt,
          deliveredAt: s.deliveredAt,
        },
        now,
      );
      await withWriteTx(db, async (tx) => {
        const patch = {
          actualPickupAt: result.pickupAt ?? s.actualPickupAt,
          deliveredAt: result.deliveredAt ?? s.deliveredAt,
        };
        if (patch.actualPickupAt !== s.actualPickupAt || patch.deliveredAt !== s.deliveredAt) {
          await tx.update(schema.shipments).set(patch).where(eq(schema.shipments.id, s.id));
        }
        await writeCallLog(tx, ctx, {
          step: 'Tracking',
          connection,
          order,
          shipmentId: s.id,
          trackingNumber: s.trackingNumber,
          ok: true,
          httpCode: 200,
          startedAt,
          serviceName: s.serviceName,
          source: 'CarrierShipmentDetails',
          labelType: s.labelType,
          request: { trackingNumber: s.trackingNumber, mode },
          response: {
            status: result.status,
            actualPickupAt: result.pickupAt,
            deliveredAt: result.deliveredAt,
            events: result.events,
            simulated: true,
          },
        });
      });
      outcomes.push({
        id: s.id,
        trackingNumber: s.trackingNumber,
        status: result.status,
        pickupAt: result.pickupAt,
        deliveredAt: result.deliveredAt,
      });
      succeeded.push(id);
    } catch (error: unknown) {
      failed.push({
        id,
        code: (error as { code?: string }).code ?? 'INTERNAL',
        message: error instanceof Error ? error.message : 'Tracking refresh failed',
      });
    }
  }
  return { succeeded, failed, outcomes };
}

/* -------------------------------------------------------- schedule pickup */

export const schedulePickupSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(200)).min(1, 'Select at least one manifest').max(50),
  pickupAt: z.iso.datetime({ offset: true }),
  /** Latest time the carrier may come (warehouse closes), optional. */
  closeAt: z.iso.datetime({ offset: true }).nullish(),
  note: z.string().trim().max(200).nullish(),
});
export type SchedulePickupInput = z.infer<typeof schedulePickupSchema>;

export interface PickupOutcome {
  readonly id: string;
  readonly confirmation: string;
  readonly packages: number;
  readonly pickupAt: string;
}

export interface SchedulePickupResult extends BulkResult {
  readonly pickups: readonly PickupOutcome[];
}

/** Validates the pickup window (PURE): not in the past (5 min grace), within 14 days, close after ready. */
export function pickupWindowError(
  pickupAt: string,
  closeAt: string | null | undefined,
  now: Date,
): string | null {
  const at = new Date(pickupAt).getTime();
  if (Number.isNaN(at)) return 'Pick a valid pickup date and time.';
  if (at < now.getTime() - 5 * 60_000) return 'The pickup time is in the past.';
  if (at > now.getTime() + 14 * 86_400_000) return 'Carriers book pickups up to 14 days ahead.';
  if (closeAt && new Date(closeAt).getTime() <= at)
    return 'The latest pickup time must be after the ready time.';
  return null;
}

const confirmationOf = (seed: string): string =>
  `PU${createHash('sha1').update(seed).digest('hex').slice(0, 10).toUpperCase()}`;

export async function schedulePickup(
  db: AppDb,
  auth: AuthContext,
  ctx: DomainCtx,
  input: SchedulePickupInput,
  now: Date = new Date(),
): Promise<SchedulePickupResult> {
  const windowError = pickupWindowError(input.pickupAt, input.closeAt, now);
  if (windowError) throw new AppError('VALIDATION', windowError);
  const pickupAt = new Date(input.pickupAt).toISOString();
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  const pickups: PickupOutcome[] = [];
  for (const id of [...new Set(input.ids)]) {
    const startedAt = Date.now();
    try {
      const { row, pendingIds } = await resolveGroup(db, auth.scope, id);
      if (row.totalPackages === 0)
        throw new AppError(
          'INVALID_STATE',
          `The ${row.carrierPrefix} manifest for ${row.shipDate} has no active packages to pick up.`,
        );
      const connection = (
        await db
          .select()
          .from(schema.carrierConnections)
          .where(eq(schema.carrierConnections.id, row.carrierConnectionId))
          .limit(1)
      )[0];
      if (!connection) throw notFoundError('Carrier connection');
      const where = row.manifestId
        ? sql`(s.end_of_day_manifest_id = ${row.manifestId}${
            pendingIds.length
              ? sql` OR s.id IN (${sql.join(
                  pendingIds.map((p) => sql`${p}`),
                  sql`, `,
                )})`
              : sql``
          })`
        : pendingIds.length
          ? sql`s.id IN (${sql.join(
              pendingIds.map((p) => sql`${p}`),
              sql`, `,
            )})`
          : sql`0 = 1`;
      const targets = (
        await dbAll<{ id: string }>(
          db,
          sql`SELECT s.id AS id FROM shipments s WHERE ${where} AND s.carrier_code = ${row.carrierCode} AND s.label_type = 'Shipping Label' AND s.label_status = 'Active'`,
        )
      ).map((r) => r.id);
      if (targets.length === 0)
        throw new AppError(
          'INVALID_STATE',
          `The ${row.carrierPrefix} manifest for ${row.shipDate} has no active packages to pick up.`,
        );
      const mode = carrierCallMode(connection);
      if (mode !== 'simulated') {
        const message = `Pickup booking isn't available through the ${connection.provider} integration yet; book it on the carrier's site.`;
        await writeCallLog(db, ctx, {
          step: 'Pickup',
          connection,
          order: null,
          ok: false,
          httpCode: 501,
          error: message,
          startedAt,
          source: 'EndOfTheDay',
          request: { manifest: id, pickupAt, mode },
          response: { error: message },
        });
        throw new AppError('INVALID_STATE', message);
      }
      const confirmation = confirmationOf(`${row.id}|${pickupAt}`);
      await withWriteTx(db, async (tx) => {
        await dbRun(
          tx,
          sql`UPDATE shipments SET scheduled_pickup_at = ${pickupAt} WHERE id IN (${sql.join(
            targets.map((t) => sql`${t}`),
            sql`, `,
          )})`,
        );
        await writeCallLog(tx, ctx, {
          step: 'Pickup',
          connection,
          order: null,
          ok: true,
          httpCode: 200,
          startedAt,
          source: 'EndOfTheDay',
          request: {
            manifest: row.id,
            shipDate: row.shipDate,
            carrierCode: row.carrierCode,
            pickupAt,
            closeAt: input.closeAt ?? null,
            packages: targets.length,
            note: input.note ?? null,
            mode,
          },
          response: { confirmation, pickupAt, packages: targets.length, simulated: true },
        });
        if (row.manifestId) {
          await recordUpdate(tx, ctx, {
            entityType: 'end_of_day_manifest',
            entityId: row.manifestId,
            entityCode: row.shipDate,
            before: { scheduledPickup: row.scheduledPickupAt ?? '' },
            after: { scheduledPickup: `${pickupAt} (${confirmation})` },
          });
        }
      });
      pickups.push({ id, confirmation, packages: targets.length, pickupAt });
      succeeded.push(id);
    } catch (error: unknown) {
      failed.push({
        id,
        code: (error as { code?: string }).code ?? 'INTERNAL',
        message: error instanceof Error ? error.message : 'Pickup booking failed',
      });
    }
  }
  return { succeeded, failed, pickups };
}

/* ------------------------------------------------------------ auto-close */

/**
 * Rules live in a module-owned table created on demand (same pattern as the scheduler store), one per
 * warehouse and carrier setup: close that setup's Open manifests every day at `cutoff_time` (warehouse
 * local HH:mm).
 */
async function ensureAutoCloseTable(db: AppDb): Promise<void> {
  await dbRun(db, sql`CREATE SCHEMA IF NOT EXISTS wms`);
  await dbRun(
    db,
    sql`CREATE TABLE IF NOT EXISTS wms.eod_auto_close_rules (
    id TEXT PRIMARY KEY NOT NULL,
    warehouse_id TEXT NOT NULL,
    carrier_connection_id TEXT NOT NULL,
    cutoff_time TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_run_date TEXT,
    last_run_at TEXT,
    last_result TEXT,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  )`,
  );
  await dbRun(
    db,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS eod_auto_close_conn_idx ON wms.eod_auto_close_rules (warehouse_id, carrier_connection_id)`,
  );
}

export interface AutoCloseRule {
  readonly id: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly timezone: string;
  readonly carrierConnectionId: string;
  readonly carrierName: string;
  readonly cutoffTime: string;
  readonly isActive: boolean;
  readonly lastRunDate: string | null;
  readonly lastRunAt: string | null;
  readonly lastResult: string | null;
}

export const autoCloseRuleSchema = z.object({
  carrierConnectionId: z.string().trim().min(1).max(64),
  cutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 17:30'),
  isActive: z.boolean().default(true),
});

export interface AutoCloseSetup {
  readonly rules: readonly AutoCloseRule[];
  /** Carrier setups in scope that can get a rule. */
  readonly connections: readonly {
    readonly id: string;
    readonly label: string;
    readonly warehouseCode: string;
  }[];
}

async function rulesIn(db: AppDb, warehouseIds: readonly string[] | null): Promise<AutoCloseRule[]> {
  await ensureAutoCloseTable(db);
  const rows = await dbAll<Omit<AutoCloseRule, 'isActive'> & { isActive: number }>(
    db,
    sql`
    SELECT r.id AS id, r.warehouse_id AS "warehouseId", w.code AS "warehouseCode", w.timezone AS timezone, r.carrier_connection_id AS "carrierConnectionId",
      COALESCE(cc.setup_name || ' - ' || cc.account_prefix, r.carrier_connection_id) AS "carrierName", r.cutoff_time AS "cutoffTime", r.is_active AS "isActive",
      r.last_run_date AS "lastRunDate", r.last_run_at AS "lastRunAt", r.last_result AS "lastResult"
    FROM eod_auto_close_rules r JOIN warehouses w ON w.id = r.warehouse_id LEFT JOIN carrier_connections cc ON cc.id = r.carrier_connection_id
    ${
      warehouseIds
        ? sql`WHERE r.warehouse_id IN (${
            warehouseIds.length
              ? sql.join(
                  warehouseIds.map((w) => sql`${w}`),
                  sql`, `,
                )
              : sql`''`
          })`
        : sql``
    }
    ORDER BY w.code, "carrierName"`,
  );
  return rows.map((r) => ({ ...r, isActive: Boolean(r.isActive) }));
}

export async function getAutoCloseSetup(db: AppDb, auth: AuthContext): Promise<AutoCloseSetup> {
  const connections = (
    await db
      .select()
      .from(schema.carrierConnections)
      .innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.carrierConnections.warehouseId))
      .where(eq(schema.carrierConnections.isActive, true))
  )
    .filter((c) => hasWarehouse(auth.viewScope, c.carrier_connections.warehouseId))
    .map((c) => ({
      id: c.carrier_connections.id,
      label: `${c.carrier_connections.setupName} - ${c.carrier_connections.accountPrefix}`,
      warehouseCode: c.warehouses.code,
    }));
  return { rules: await rulesIn(db, auth.viewScope.warehouseIds), connections };
}

export async function saveAutoCloseRule(
  db: AppDb,
  auth: AuthContext,
  ctx: DomainCtx,
  input: z.infer<typeof autoCloseRuleSchema>,
): Promise<AutoCloseRule> {
  await ensureAutoCloseTable(db);
  const connection = (
    await db
      .select()
      .from(schema.carrierConnections)
      .where(eq(schema.carrierConnections.id, input.carrierConnectionId))
      .limit(1)
  )[0];
  if (!connection || !hasWarehouse(auth.scope, connection.warehouseId))
    throw notFoundError('Carrier connection');
  const existing = await dbGet<{ id: string; cutoff: string; active: number }>(
    db,
    sql`SELECT id, cutoff_time AS cutoff, is_active AS active FROM eod_auto_close_rules WHERE warehouse_id = ${connection.warehouseId} AND carrier_connection_id = ${connection.id}`,
  );
  const id = existing?.id ?? crypto.randomUUID();
  const nowIso = new Date().toISOString();
  await dbRun(
    db,
    sql`INSERT INTO eod_auto_close_rules (id, warehouse_id, carrier_connection_id, cutoff_time, is_active, updated_at, updated_by)
    VALUES (${id}, ${connection.warehouseId}, ${connection.id}, ${input.cutoffTime}, ${input.isActive ? 1 : 0}, ${nowIso}, ${ctx.userId})
    ON CONFLICT(id) DO UPDATE SET cutoff_time = excluded.cutoff_time, is_active = excluded.is_active, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  );
  await recordUpdate(db, ctx, {
    entityType: 'carrier_connection',
    entityId: connection.id,
    entityCode: connection.setupName,
    before: { endOfDayAutoClose: existing ? `${existing.cutoff}${existing.active ? '' : ' (off)'}` : '' },
    after: { endOfDayAutoClose: `${input.cutoffTime}${input.isActive ? '' : ' (off)'}` },
  });
  const rule = (await rulesIn(db, [connection.warehouseId])).find((r) => r.id === id);
  if (!rule) throw notFoundError('Auto-close rule');
  return rule;
}

export async function deleteAutoCloseRule(
  db: AppDb,
  auth: AuthContext,
  ctx: DomainCtx,
  id: string,
): Promise<{ readonly id: string }> {
  const rule = (await rulesIn(db, null)).find((r) => r.id === id);
  if (!rule || !hasWarehouse(auth.scope, rule.warehouseId)) throw notFoundError('Auto-close rule');
  await dbRun(db, sql`DELETE FROM eod_auto_close_rules WHERE id = ${id}`);
  await recordUpdate(db, ctx, {
    entityType: 'carrier_connection',
    entityId: rule.carrierConnectionId,
    entityCode: rule.carrierName,
    before: { endOfDayAutoClose: rule.cutoffTime },
    after: { endOfDayAutoClose: '' },
  });
  return { id };
}

/** The UTC instant of today's cutoff in the warehouse zone, or null when it has not passed yet (PURE). */
export function cutoffPassed(
  cutoffTime: string,
  timeZone: string,
  now: Date,
): { readonly localDay: string; readonly at: Date } | null {
  const p = localParts(now, timeZone);
  const at = zonedToUtc(p.year, p.month, p.day, toMinutes(cutoffTime), timeZone);
  if (now.getTime() < at.getTime()) return null;
  return { localDay: localDate(now, timeZone), at };
}

/** Open EOD rows a rule closes at its cutoff: that setup's Open rows dated today or earlier (PURE). */
export function rowsToAutoClose(
  rows: readonly EodRow[],
  rule: Pick<AutoCloseRule, 'warehouseId' | 'carrierConnectionId'>,
  localDay: string,
): EodRow[] {
  return rows.filter(
    (r) =>
      r.status === 'Open' &&
      r.warehouseId === rule.warehouseId &&
      r.carrierConnectionId === rule.carrierConnectionId &&
      r.shipDate <= localDay &&
      r.totalPackages > 0,
  );
}

async function systemAuth(db: AppDb, warehouseId: string, userId: string | null): Promise<AuthContext> {
  const user = userId
    ? (await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1))[0]
    : undefined;
  const scope = { warehouseIds: [warehouseId], clientIds: 'all' as const };
  return {
    permissions: new Set(),
    restrictions: [],
    roleKeys: [],
    user: {
      id: user?.id ?? 'system',
      email: user?.email ?? '',
      name: 'End of day auto-close',
      role: 'admin',
      userType: 'Standard',
      allClients: true,
      isApiUser: true,
      sessionId: 'scheduler',
      sessionVersion: 0,
      sessionExpiresAt: '',
    },
    scope,
    viewScope: scope,
    context: { warehouseId, clientId: null },
  } as unknown as AuthContext;
}

/** Scheduler entry point: closes every due rule's Open manifests once per warehouse-local day. */
export async function runAutoClose(
  db: AppDb,
  now: Date = new Date(),
): Promise<{ readonly closed: number; readonly rules: number }> {
  let closed = 0;
  let ran = 0;
  for (const rule of (await rulesIn(db, null)).filter((r) => r.isActive)) {
    const due = cutoffPassed(rule.cutoffTime, rule.timezone, now);
    if (!due || rule.lastRunDate === due.localDay) continue;
    const updatedBy =
      (
        await dbGet<{ u: string | null }>(
          db,
          sql`SELECT updated_by AS u FROM eod_auto_close_rules WHERE id = ${rule.id}`,
        )
      )?.u ?? null;
    const auth = await systemAuth(db, rule.warehouseId, updatedBy);
    const ctx: DomainCtx = { userId: updatedBy, source: 'EOD auto-close' };
    const targets = rowsToAutoClose(await buildEodRows(db, auth.scope, now), rule, due.localDay);
    let message = 'Nothing to close';
    if (targets.length > 0) {
      const res = await closeManifests(
        db,
        auth,
        ctx,
        targets.map((t) => t.id),
      );
      closed += res.succeeded.length;
      message = `Closed ${res.succeeded.length} of ${targets.length}${res.failed.length ? `; ${res.failed[0]?.message}` : ''}`;
    }
    await dbRun(
      db,
      sql`UPDATE eod_auto_close_rules SET last_run_date = ${due.localDay}, last_run_at = ${now.toISOString()}, last_result = ${message} WHERE id = ${rule.id}`,
    );
    ran += 1;
  }
  return { closed, rules: ran };
}

/* -------------------------------------------------------- overdue banner */

export interface OverdueSummary {
  readonly count: number;
  readonly packages: number;
  readonly oldestShipDate: string | null;
  readonly rows: readonly {
    readonly id: string;
    readonly carrierPrefix: string;
    readonly carrierCode: string;
    readonly warehouseCode: string;
    readonly shipDate: string;
    readonly totalPackages: number;
  }[];
}

/** Open manifests from past ship days (warehouse-local) in the caller's view scope. */
export async function overdueManifests(
  db: AppDb,
  auth: AuthContext,
  now: Date = new Date(),
): Promise<OverdueSummary> {
  const rows = (await buildEodRows(db, auth.viewScope, now))
    .filter((r) => r.status === 'Open' && r.isOverdue && r.totalPackages > 0)
    .sort((a, b) => a.shipDate.localeCompare(b.shipDate) || a.carrierPrefix.localeCompare(b.carrierPrefix));
  return {
    count: rows.length,
    packages: rows.reduce((s, r) => s + r.totalPackages, 0),
    oldestShipDate: rows[0]?.shipDate ?? null,
    rows: rows
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        carrierPrefix: r.carrierPrefix,
        carrierCode: r.carrierCode,
        warehouseCode: r.warehouseCode,
        shipDate: r.shipDate,
        totalPackages: r.totalPackages,
      })),
  };
}
