/**
 * KitStak Pulse inside the WMS: the "Job profit" card on a work order and the "Client profit"
 * strip on a client page. Everything is read through @kitstak/pulse-bridge on the WMS's own
 * database handle (one shared Postgres, no browser call to Pulse). The handle is already bound
 * to this organization's warehouse schema, and `warehouseOrgId` names the organization that
 * owns it, so a warehouse can only ever see its own organization's Pulse data.
 *
 * Degrades quietly: no `pulse` entitlement, no pulse schema (PGlite tests, standalone installs),
 * a user who is not a member of the organization, or a person with no Pulse role all read as
 * `available: false`, and the UI renders nothing. Money is hidden on the server for people who
 * may not see it in Pulse. Change events never throw.
 */
import { eq, or } from 'drizzle-orm';
import {
  emitBridgeEvent,
  getClientProfit,
  getJobsForRecord,
  lastDays,
  pulseAvailability,
  pulseUrls,
  type BridgeExecutor,
  type PulseJobSummary,
  type PulsePeriodProfit,
} from '@kitstak/pulse-bridge';
import { hasModule, type EntitlementsDb } from '@kitstak/entitlements';
import type { AppDb } from '@/server/api/db';
import { notFoundError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { warehouseOrgId } from '@/server/auth/credentials';
import { entitlementsAllowAll } from '@/server/auth/entitlements';
import { assertInScope } from '@/server/auth/scope';
import * as schema from '@/server/db/schema';

export type PulseUnavailableReason = 'not_licensed' | 'not_installed' | 'no_access';

export interface WorkOrderPulseJob extends PulseJobSummary {
  /** Absolute link to the job in Pulse. */
  readonly url: string;
  /** Absolute link to the Pulse daily log, on this job. */
  readonly logUrl: string;
}

export interface WorkOrderPulseDto {
  readonly available: boolean;
  readonly reason: PulseUnavailableReason | null;
  readonly pulseUrl: string;
  readonly moneyHidden: boolean;
  readonly canLog: boolean;
  readonly canManageJobs: boolean;
  /** The Pulse job tracking this work order (the worst one first when there are several). */
  readonly jobs: readonly WorkOrderPulseJob[];
  /** "Create Pulse job from this work order" deep link. Null when this person cannot add jobs. */
  readonly createJobUrl: string | null;
  readonly workOrder: { readonly id: string; readonly code: string; readonly status: string; readonly requestedQty: number; readonly processedQty: number } | null;
}

export interface ClientPulseDto {
  readonly available: boolean;
  readonly reason: PulseUnavailableReason | null;
  readonly pulseUrl: string;
  readonly moneyHidden: boolean;
  /** Null when Pulse has no client for this warehouse client yet. */
  readonly client: { readonly id: string; readonly name: string; readonly url: string } | null;
  /** The last 30 days. */
  readonly period: PulsePeriodProfit | null;
  readonly openJobs: number;
  readonly atRisk: number;
  readonly losing: number;
  readonly jobs: readonly WorkOrderPulseJob[];
}

const bridgeDb = (db: AppDb) => db as unknown as BridgeExecutor;

export function pulseUrl(): string {
  return (process.env.NEXT_PUBLIC_PULSE_URL || 'http://localhost:3500').replace(/\/+$/, '');
}

async function ownerOrgId(db: AppDb): Promise<string | null> {
  try {
    return await warehouseOrgId(db);
  } catch {
    return null;
  }
}

/** Why Pulse cannot be shown from this install right now (null = it can). */
async function unavailable(db: AppDb): Promise<{ reason: PulseUnavailableReason | null; orgId: string | null }> {
  if (!(await pulseAvailability(bridgeDb(db))).installed) return { reason: 'not_installed', orgId: null };
  const orgId = await ownerOrgId(db);
  if (!orgId) return { reason: 'not_installed', orgId: null };
  if (!entitlementsAllowAll() && !(await hasModule(db as unknown as EntitlementsDb, orgId, 'pulse').catch(() => false))) {
    return { reason: 'not_licensed', orgId };
  }
  return { reason: null, orgId };
}

function withUrls(job: PulseJobSummary): WorkOrderPulseJob {
  const urls = pulseUrls(pulseUrl());
  return { ...job, url: urls.path(job.path), logUrl: urls.log(job.number) };
}

const OFF_WORK_ORDER = (reason: PulseUnavailableReason): WorkOrderPulseDto => ({
  available: false,
  reason,
  pulseUrl: pulseUrl(),
  moneyHidden: true,
  canLog: false,
  canManageJobs: false,
  jobs: [],
  createJobUrl: null,
  workOrder: null,
});

/** Pulse job profit for one work order (id or code). The work order is scope checked first. */
export async function getWorkOrderPulse(db: AppDb, auth: AuthContext, idOrCode: string): Promise<WorkOrderPulseDto> {
  const t = schema.workOrders;
  const [row] = await db
    .select({ id: t.id, code: t.code, status: t.status, requestedQty: t.requestedQty, processedQty: t.processedQty, warehouseId: t.warehouseId, clientId: t.clientId })
    .from(t)
    .where(or(eq(t.id, idOrCode), eq(t.code, idOrCode)))
    .limit(1);
  if (!row) throw notFoundError('Work order');
  assertInScope(auth.scope, row, 'Work order');
  try {
    const { reason, orgId } = await unavailable(db);
    if (reason || !orgId) return OFF_WORK_ORDER(reason ?? 'not_installed');
    const result = await getJobsForRecord(bridgeDb(db), { orgId, userId: auth.user.id }, { type: 'wms_work_order', id: row.id }, { limit: 5 });
    if (!result.available) return OFF_WORK_ORDER(result.reason);
    return {
      available: true,
      reason: null,
      pulseUrl: pulseUrl(),
      moneyHidden: result.moneyHidden,
      canLog: result.access.canLog,
      canManageJobs: result.access.canManageJobs,
      jobs: result.jobs.map(withUrls),
      createJobUrl: result.access.canManageJobs ? pulseUrls(pulseUrl()).newJobFromWorkOrder(row.id) : null,
      workOrder: { id: row.id, code: row.code, status: row.status, requestedQty: Number(row.requestedQty) || 0, processedQty: Number(row.processedQty) || 0 },
    };
  } catch (error) {
    console.warn('[pulse] work order profit skipped', error);
    return OFF_WORK_ORDER('not_installed');
  }
}

const OFF_CLIENT = (reason: PulseUnavailableReason): ClientPulseDto => ({
  available: false,
  reason,
  pulseUrl: pulseUrl(),
  moneyHidden: true,
  client: null,
  period: null,
  openJobs: 0,
  atRisk: 0,
  losing: 0,
  jobs: [],
});

/**
 * Pulse profit for a WMS client over the last 30 days. A WMS client id is the shared
 * `core.customers` id, which is how Pulse finds its own client row. Fails soft.
 */
export async function getClientPulse(db: AppDb, auth: AuthContext, clientId: string): Promise<ClientPulseDto> {
  const t = schema.clients;
  const [row] = await db.select({ id: t.id }).from(t).where(eq(t.id, clientId)).limit(1);
  if (!row) throw notFoundError('Client');
  assertInScope(auth.scope, { clientId: row.id }, 'Client');
  try {
    const { reason, orgId } = await unavailable(db);
    if (reason || !orgId) return OFF_CLIENT(reason ?? 'not_installed');
    const range = lastDays(30);
    const result = await getClientProfit(bridgeDb(db), { orgId, userId: auth.user.id }, { coreCustomerId: clientId }, { from: range.from, to: range.to, jobLimit: 3 });
    if (!result.available) return OFF_CLIENT(result.reason);
    const urls = pulseUrls(pulseUrl());
    return {
      available: true,
      reason: null,
      pulseUrl: pulseUrl(),
      moneyHidden: result.moneyHidden,
      client: result.client ? { id: result.client.id, name: result.client.name, url: urls.path(result.client.path) } : null,
      period: result.period,
      openJobs: result.openJobs,
      atRisk: result.atRisk,
      losing: result.losing,
      jobs: result.jobs.map(withUrls),
    };
  } catch (error) {
    console.warn('[pulse] client profit skipped', error);
    return OFF_CLIENT('not_installed');
  }
}

let pulseInstalled: { readonly value: boolean; readonly at: number } | null = null;
const INSTALL_TTL_MS = 5 * 60_000;

/**
 * Change hook (called from the change log): a work order changed status or finished quantity.
 * Leaves a note in Pulse's inbox so the linked job refreshes on the next Pulse page load. Runs
 * inside the caller's transaction through a SAVEPOINT and never throws, so it cannot break a
 * WMS write. Does nothing when Pulse is not installed.
 */
export async function notifyPulseOfWorkOrderChange(
  db: AppDb,
  change: { readonly entityType: string; readonly entityId: string; readonly status: unknown; readonly processedQty: unknown },
): Promise<void> {
  if (change.entityType !== 'work_order' || !change.entityId) return;
  try {
    if (!pulseInstalled || Date.now() - pulseInstalled.at > INSTALL_TTL_MS) {
      pulseInstalled = { value: (await pulseAvailability(bridgeDb(db))).installed, at: Date.now() };
    }
    if (!pulseInstalled.value) return;
    const orgId = await ownerOrgId(db);
    if (!orgId) return;
    await emitBridgeEvent(bridgeDb(db), { orgId }, {
      kind: 'wms_work_order_changed',
      targetId: change.entityId,
      payload: {
        status: typeof change.status === 'string' ? change.status : null,
        processedQty: typeof change.processedQty === 'number' ? change.processedQty : null,
      },
    });
  } catch (error) {
    console.warn('[pulse] work order event skipped', error);
  }
}

