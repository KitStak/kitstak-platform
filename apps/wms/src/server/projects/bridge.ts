/**
 * KitStak Projects inside the WMS: the "Project tasks" panel on shipment order and work order
 * pages, "Create task" from a record, and status events (order shipped…) that Projects
 * automations react to. Everything goes through @kitstak/pm-bridge on the WMS's own database
 * handle (one shared Postgres). The WMS is single-tenant: it acts for the platform org.
 *
 * Degrades quietly: no `projects` entitlement, no pm schema (PGlite tests, standalone installs)
 * or a non-member user all read as `available: false`; status events never throw.
 */
import { eq, or } from 'drizzle-orm';
import {
  createTaskFromExternal,
  emitRecordStatusChange,
  isBridgeError,
  listLinkedWork,
  listOrgPeople,
  listWritableProjects,
  orgIdForSlug,
  pmAvailability,
  removeLink,
  rowsOf,
  type BridgeExecutor,
  type BridgeLinkSnapshot,
  type BridgePerson,
  type BridgePriority,
  type BridgeTask,
  type LinkedWork,
  type WritableProject,
} from '@kitstak/pm-bridge';
import { hasModule, type EntitlementsDb } from '@kitstak/entitlements';
import { sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import { AppError, notFoundError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { PLATFORM_ORG_SLUG } from '@/server/auth/credentials';
import { entitlementsAllowAll } from '@/server/auth/entitlements';
import { assertInScope } from '@/server/auth/scope';
import * as schema from '@/server/db/schema';

export type WmsRecordType = 'wms_order' | 'wms_work_order' | 'wms_receipt' | 'wms_count';

export interface RecordProjectsDto {
  readonly available: boolean;
  readonly reason: 'not_licensed' | 'not_installed' | 'not_member' | null;
  readonly projectsUrl: string;
  readonly target: BridgeLinkSnapshot | null;
  readonly work: LinkedWork;
}

export interface ProjectOptionsDto {
  readonly projects: readonly WritableProject[];
  readonly people: readonly BridgePerson[];
}

export interface CreateRecordTaskInput {
  readonly projectId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly statusId?: string | null;
  readonly priority?: BridgePriority;
  readonly assigneeId?: string | null;
  readonly dueDate?: string | null;
}

const EMPTY: LinkedWork = { projects: [], tasks: [], openTasks: 0 };
const ORG_TTL_MS = 5 * 60_000;
let platformOrg: { readonly id: string | null; readonly at: number } | null = null;

const bridgeDb = (db: AppDb) => db as unknown as BridgeExecutor;

export function projectsUrl(): string {
  return (process.env.NEXT_PUBLIC_PROJECTS_URL || 'http://localhost:3400').replace(/\/+$/, '');
}

async function platformOrgId(db: AppDb): Promise<string | null> {
  if (platformOrg && Date.now() - platformOrg.at < ORG_TTL_MS) return platformOrg.id;
  const id = await orgIdForSlug(bridgeDb(db), PLATFORM_ORG_SLUG);
  platformOrg = { id, at: Date.now() };
  return id;
}

async function isMember(db: AppDb, orgId: string, userId: string): Promise<boolean> {
  const rows = rowsOf<{ ok: boolean }>(
    await db.execute(sql`select exists (select 1 from core.member where organization_id = ${orgId}::uuid and user_id = ${userId}::uuid
                          and role not like 'deactivated:%') as ok`),
  );
  return rows[0]?.ok === true;
}

/** Why Projects can't be used from this install/user right now (null = it can). */
async function unavailable(
  db: AppDb,
  auth: AuthContext,
): Promise<{ reason: RecordProjectsDto['reason']; orgId: string | null }> {
  if (!(await pmAvailability(bridgeDb(db))).installed) return { reason: 'not_installed', orgId: null };
  const orgId = await platformOrgId(db);
  if (!orgId) return { reason: 'not_installed', orgId: null };
  if (
    !entitlementsAllowAll() &&
    !(await hasModule(db as unknown as EntitlementsDb, orgId, 'projects').catch(() => false))
  ) {
    return { reason: 'not_licensed', orgId };
  }
  if (!(await isMember(db, orgId, auth.user.id))) return { reason: 'not_member', orgId };
  return { reason: null, orgId };
}

/** The record as a link snapshot (scope-checked). Title/status match what Projects resolves. */
async function snapshot(
  db: AppDb,
  auth: AuthContext,
  type: WmsRecordType,
  idOrCode: string,
  origin: string,
): Promise<BridgeLinkSnapshot> {
  if (type === 'wms_order') {
    const t = schema.shipmentOrders;
    const [row] = await db
      .select({
        id: t.id,
        code: t.code,
        status: t.status,
        customerName: t.customerName,
        storeName: t.storeName,
        warehouseId: t.warehouseId,
        clientId: t.clientId,
        deletedAt: t.deletedAt,
      })
      .from(t)
      .where(or(eq(t.id, idOrCode), eq(t.code, idOrCode)))
      .limit(1);
    if (!row || row.deletedAt) throw notFoundError('Shipment order');
    assertInScope(auth.scope, row, 'Shipment order');
    const label = row.customerName?.trim() || row.storeName || 'Order';
    return {
      type,
      id: row.id,
      title: `${row.code} · ${label}`,
      status: row.status,
      url: `${origin}/orders/${encodeURIComponent(row.id)}`,
      meta: { code: row.code },
    };
  }
  if (type === 'wms_receipt') {
    const t = schema.purchaseOrders;
    const [row] = await db
      .select({ id: t.id, code: t.code, status: t.status, warehouseId: t.warehouseId, clientId: t.clientId })
      .from(t)
      .where(or(eq(t.id, idOrCode), eq(t.code, idOrCode)))
      .limit(1);
    if (!row) throw notFoundError('Purchase order');
    assertInScope(auth.scope, row, 'Purchase order');
    // Same title Projects resolves for a receipt link (apps/projects server/integrations/wms.ts).
    return {
      type,
      id: row.id,
      title: `${row.code} · Purchase order`,
      status: row.status,
      url: `${origin}/receiving/${encodeURIComponent(row.id)}`,
      meta: { code: row.code },
    };
  }
  if (type === 'wms_count') {
    const t = schema.countPlans;
    const [row] = await db
      .select({ id: t.id, code: t.code, status: t.status, description: t.description, warehouseId: t.warehouseId })
      .from(t)
      .where(or(eq(t.id, idOrCode), eq(t.code, idOrCode)))
      .limit(1);
    if (!row) throw notFoundError('Cycle count');
    assertInScope(auth.scope, row, 'Cycle count');
    return {
      type,
      id: row.id,
      title: `${row.code} · ${row.description?.trim() || 'Cycle count'}`,
      status: row.status,
      url: `${origin}/counts/${encodeURIComponent(row.id)}`,
      meta: { code: row.code },
    };
  }
  const t = schema.workOrders;
  const [row] = await db
    .select({
      id: t.id,
      code: t.code,
      status: t.status,
      type: t.type,
      warehouseId: t.warehouseId,
      clientId: t.clientId,
    })
    .from(t)
    .where(or(eq(t.id, idOrCode), eq(t.code, idOrCode)))
    .limit(1);
  if (!row) throw notFoundError('Work order');
  assertInScope(auth.scope, row, 'Work order');
  return {
    type,
    id: row.id,
    title: `${row.code} · ${row.type?.trim() || 'Work order'}`,
    status: row.status,
    url: `${origin}/work-orders/${encodeURIComponent(row.id)}`,
    meta: { code: row.code },
  };
}

function rethrow(error: unknown): never {
  if (isBridgeError(error)) {
    if (error.code === 'NOT_FOUND') throw new AppError('NOT_FOUND', error.message);
    if (error.code === 'FORBIDDEN') throw new AppError('FORBIDDEN', error.message);
    if (error.code === 'UNAVAILABLE') throw new AppError('INVALID_STATE', error.message);
    throw new AppError('VALIDATION', error.message, {
      fieldErrors: Object.fromEntries(
        Object.entries(error.fields ?? {}).map(([field, message]) => [field, [message]]),
      ),
    });
  }
  throw error;
}

export async function getRecordProjects(
  db: AppDb,
  auth: AuthContext,
  type: WmsRecordType,
  id: string,
  origin: string,
): Promise<RecordProjectsDto> {
  const target = await snapshot(db, auth, type, id, origin);
  const { reason, orgId } = await unavailable(db, auth);
  const base = { projectsUrl: projectsUrl() };
  if (reason || !orgId) return { ...base, available: false, reason, target: null, work: EMPTY };
  const work = await listLinkedWork(
    bridgeDb(db),
    { orgId, userId: auth.user.id },
    [{ type, id: target.id }],
    base,
  );
  return { ...base, available: true, reason: null, target, work };
}

export async function getProjectOptions(db: AppDb, auth: AuthContext): Promise<ProjectOptionsDto> {
  const { reason, orgId } = await unavailable(db, auth);
  if (reason || !orgId) return { projects: [], people: [] };
  const [projects, people] = await Promise.all([
    listWritableProjects(bridgeDb(db), { orgId, userId: auth.user.id }, { limit: 100 }),
    listOrgPeople(bridgeDb(db), orgId),
  ]);
  return { projects, people };
}

async function requireOrg(db: AppDb, auth: AuthContext): Promise<string> {
  const { reason, orgId } = await unavailable(db, auth);
  if (reason === 'not_licensed')
    throw new AppError(
      'ENTITLEMENT_MISSING',
      'KitStak Projects isn’t part of your plan yet. Add it in Portal billing.',
    );
  if (reason === 'not_member')
    throw new AppError(
      'FORBIDDEN',
      'You’re not a member of the KitStak workspace in Projects. Ask an admin to invite you.',
    );
  if (reason || !orgId)
    throw new AppError('INVALID_STATE', 'KitStak Projects isn’t set up for this install yet.');
  return orgId;
}

export async function createRecordTask(
  db: AppDb,
  auth: AuthContext,
  type: WmsRecordType,
  id: string,
  origin: string,
  input: CreateRecordTaskInput,
): Promise<BridgeTask> {
  const link = await snapshot(db, auth, type, id, origin);
  const orgId = await requireOrg(db, auth);
  try {
    const created = await createTaskFromExternal(
      bridgeDb(db),
      { orgId, userId: auth.user.id },
      { ...input, link, source: 'wms' },
      { projectsUrl: projectsUrl() },
    );
    return created.task;
  } catch (error) {
    rethrow(error);
  }
}

export async function unlinkRecordWork(
  db: AppDb,
  auth: AuthContext,
  type: WmsRecordType,
  id: string,
  origin: string,
  linkId: string,
): Promise<void> {
  const target = await snapshot(db, auth, type, id, origin);
  const orgId = await requireOrg(db, auth);
  const rows = rowsOf<{ target_type: string; target_id: string }>(
    await db.execute(
      sql`select target_type, target_id from pm.integration_links where id = ${linkId}::uuid and org_id = ${orgId}::uuid`,
    ),
  );
  if (!rows[0] || rows[0].target_type !== type || rows[0].target_id !== target.id)
    throw new AppError('NOT_FOUND', 'That link no longer exists.');
  try {
    await removeLink(bridgeDb(db), { orgId, userId: auth.user.id }, linkId);
  } catch (error) {
    rethrow(error);
  }
}

const ENTITY_TARGETS: Readonly<Record<string, 'wms_order' | 'wms_work_order' | 'wms_receipt' | 'wms_count'>> =
  {
    shipment_order: 'wms_order',
    work_order: 'wms_work_order',
    purchase_order: 'wms_receipt',
    count_plan: 'wms_count',
  };

let pmInstalled: { readonly value: boolean; readonly at: number } | null = null;

/**
 * Automation hook (called from the change log): a shipment order / work order / receipt /
 * count changed status. Refreshes the cached status on Projects links and queues an event
 * ("When the linked order ships…"). Runs inside the caller's transaction via a SAVEPOINT and
 * never throws, so it can't break a WMS write.
 */
export async function notifyProjectsOfStatusChange(
  db: AppDb,
  change: {
    readonly entityType: string;
    readonly entityId: string;
    readonly before: unknown;
    readonly after: unknown;
    readonly userId: string | null;
  },
): Promise<void> {
  const type = ENTITY_TARGETS[change.entityType];
  if (!type || typeof change.after !== 'string' || change.after === change.before) return;
  try {
    if (!pmInstalled || Date.now() - pmInstalled.at > ORG_TTL_MS) {
      pmInstalled = { value: (await pmAvailability(bridgeDb(db))).installed, at: Date.now() };
    }
    if (!pmInstalled.value) return;
    const orgId = await platformOrgId(db);
    if (!orgId) return;
    await emitRecordStatusChange(bridgeDb(db), {
      orgId,
      source: 'wms',
      target: { type, id: change.entityId },
      status: change.after,
      previousStatus: typeof change.before === 'string' ? change.before : undefined,
      actorId: change.userId,
    });
  } catch (error) {
    console.warn('[projects] status event skipped', error);
  }
}

/** Public origin of this WMS (deep links stored on Projects links). */
export function wmsOrigin(request: Request): string {
  const configured =
    process.env.NEXT_PUBLIC_WMS_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL;
  return (configured || new URL(request.url).origin).replace(/\/+$/, '');
}

export interface ClientProjectsDto {
  readonly available: boolean;
  readonly projectsUrl: string;
  readonly projects: LinkedWork['projects'];
  readonly openTasks: number;
  /** Projects list filtered to this customer. */
  readonly filteredUrl: string;
}

/**
 * KitStak Projects health for a WMS client: the projects serving the shared core customer
 * (WMS client ids are the core.customers ids) with their health and progress. Fails soft.
 */
export async function getClientProjects(db: AppDb, auth: AuthContext, clientId: string): Promise<ClientProjectsDto> {
  const base = projectsUrl();
  const filteredUrl = `${base}/projects?customer=${encodeURIComponent(clientId)}`;
  const { reason, orgId } = await unavailable(db, auth);
  if (reason || !orgId) return { available: false, projectsUrl: base, projects: [], openTasks: 0, filteredUrl };
  const work = await listLinkedWork(
    bridgeDb(db),
    { orgId, userId: auth.user.id },
    [{ type: 'core_customer', id: clientId }],
    { projectsUrl: base },
  );
  return { available: true, projectsUrl: base, projects: work.projects, openTasks: work.openTasks, filteredUrl };
}
