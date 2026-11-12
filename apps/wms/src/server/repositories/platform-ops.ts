/**
 * `/api/ops/*` command glue (BUILD_PLAN F7): zod contracts, operation → permission maps
 * and the job / allocation / task commands that wrap the F5 domain engines. Every engine
 * runs with the caller's full scope, so cross-scope ids fail with NOT_FOUND.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import { z } from 'zod';
import { LABEL_FORMATS, PRIORITIES } from '@/lib/enums';
import type { AppDb } from '@/server/api/db';
import { forbiddenError, validationError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { can } from '@/server/auth/permissions';
import { hasWarehouse } from '@/server/auth/scope';
import * as schema from '@/server/db/schema';
import { allocation, jobs, runBulk, tasks } from '@/server/domain';
import type { BulkResult, DomainCtx } from '@/server/domain/types';
import { createCountJobs } from '@/server/repositories/counts-jobs';
import { allocateWorkOrderWith } from '@/server/repositories/work-orders-commands';
import { runPicking } from '@/server/repositories/work-orders-ops';
import { bulkIdsSchema, idSchema } from './platform-common';
import { withWriteTx } from '@/server/db/sql';

/* ------------------------------------------------------------------- jobs */

export const JOB_OPERATIONS = ['order', 'shipment-plan', 'work-order', 'count'] as const;
export type JobOperation = (typeof JOB_OPERATIONS)[number];

export const JOB_OPERATION_PERMISSIONS: Readonly<Record<JobOperation, string>> = {
  order: 'fulfillment.shipment_orders.picking_job_operations',
  'shipment-plan': 'fulfillment.shipment_plan.picking_operations',
  'work-order': 'inventory.work_orders.picking_job_operations',
  count: 'inventory.count_plans.create_job',
};

export const ANY_JOB_OPERATION_PERMISSION: readonly string[] = Object.values(JOB_OPERATION_PERMISSIONS);

const orderOperation = z.enum(['order', 'shipment-plan']).default('order');

const createJobsSchema = z.object({
  mode: z.literal('create'),
  operation: orderOperation,
  orderIds: bulkIdsSchema,
  jobTypeId: idSchema,
  batchSize: z.number().int().min(1).max(1000).optional(),
  assigneeUserId: idSchema.nullish(),
  priority: z.enum(PRIORITIES).optional(),
});

const mergeJobsSchema = z.object({
  mode: z.literal('merge'),
  operation: orderOperation,
  jobId: idSchema,
  orderIds: bulkIdsSchema,
});

const workOrderJobsSchema = z.object({
  mode: z.literal('work-order'),
  workOrderIds: bulkIdsSchema,
  jobTypeId: idSchema.nullish(),
  assigneeUserId: idSchema.nullish(),
  priority: z.enum(PRIORITIES).optional(),
});
const countJobsSchema = z.object({
  mode: z.literal('count'),
  countPlanIds: bulkIdsSchema,
  jobTypeId: idSchema,
  batchSize: z.number().int().min(1).max(1000),
  assigneeUserId: idSchema.nullish(),
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The shared create-job modal posts `{ operation, mode: "create" | "merge", ids, ... }`.
 * Map that shape onto the command schemas: `ids` -> `orderIds` / `workOrderIds` / `countPlanIds`,
 * and `mode: "create"` with `operation: "work-order" | "count"` -> the dedicated mode.
 */
function normalizeJobsBody(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const { ids, ...rest } = raw;
  const mode =
    rest.mode === 'create' && (rest.operation === 'work-order' || rest.operation === 'count')
      ? rest.operation
      : rest.mode;
  const idsKey = mode === 'work-order' ? 'workOrderIds' : mode === 'count' ? 'countPlanIds' : 'orderIds';
  return { ...rest, mode, ...(ids !== undefined && rest[idsKey] === undefined ? { [idsKey]: ids } : {}) };
}

export const opsJobsSchema = z.preprocess(
  normalizeJobsBody,
  z.discriminatedUnion('mode', [createJobsSchema, mergeJobsSchema, workOrderJobsSchema, countJobsSchema]),
);
export type OpsJobsInput = z.output<typeof opsJobsSchema>;

const eligibilityOperation = z.enum(['order', 'shipment-plan', 'work-order']).default('order');

/** `{ operation, orderIds | ids, jobTypeId | jobId }`; work orders need neither (dry run of Picking/Job Operations). */
export const eligibilitySchema = z.preprocess(
  (raw: unknown) =>
    isRecord(raw) && raw.ids !== undefined && raw.orderIds === undefined
      ? { ...raw, orderIds: raw.ids }
      : raw,
  z
    .object({
      operation: eligibilityOperation,
      orderIds: bulkIdsSchema,
      jobTypeId: idSchema.optional(),
      jobId: idSchema.optional(),
    })
    .refine((b) => b.jobTypeId === undefined || b.jobId === undefined, {
      message: 'Choose a job type (new job) or a job (merge), not both',
      path: ['jobTypeId'],
    }),
);

function operationOf(input: OpsJobsInput): JobOperation {
  if (input.mode === 'work-order') return 'work-order';
  if (input.mode === 'count') return 'count';
  return input.operation;
}

function requireOperation(auth: AuthContext, operation: JobOperation): void {
  if (!can(auth, JOB_OPERATION_PERMISSIONS[operation])) throw forbiddenError();
}

export type OpsJobsResult = BulkResult & { readonly jobIds: readonly string[] };

export async function runJobsCommand(
  db: AppDb,
  auth: AuthContext,
  ctx: DomainCtx,
  input: OpsJobsInput,
): Promise<OpsJobsResult> {
  requireOperation(auth, operationOf(input));
  switch (input.mode) {
    case 'create': {
      const { succeeded, failed, jobIds } = await jobs.createJobsFromOrders(db, ctx, {
        orderIds: input.orderIds,
        jobTypeId: input.jobTypeId,
        batchSize: input.batchSize,
        assigneeUserId: input.assigneeUserId ?? null,
        priority: input.priority,
      });
      return { succeeded, failed, jobIds };
    }
    case 'merge':
      return {
        ...(await jobs.mergeIntoJob(db, ctx, { jobId: input.jobId, orderIds: input.orderIds })),
        jobIds: [input.jobId],
      };
    case 'work-order': {
      const opts = {
        jobTypeId: input.jobTypeId ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        priority: input.priority,
      };
      return {
        ...(await runBulk(db, input.workOrderIds, async (tx, id) => {
          await allocateWorkOrderWith(tx, ctx, id, opts);
        })),
        jobIds: [],
      };
    }
    case 'count':
      return await createCountJobs(db, ctx, auth, {
        ids: input.countPlanIds,
        jobTypeId: input.jobTypeId,
        batchSize: input.batchSize,
        assigneeUserId: input.assigneeUserId ?? null,
      });
  }
}

class DryRunRollback extends Error {}

/** `code` is the error code (INVALID_STATE…); `recordCode` is the record's own code (e.g. SO010850) for display. */
type IneligibleRow = BulkResult['failed'][number] & {
  readonly reason: string;
  readonly recordCode?: string | null;
};

export interface EligibilityResult {
  readonly total: number;
  readonly eligible: readonly string[];
  /** `reason` mirrors `message` (the shared modal reads `reason`). */
  readonly ineligible: readonly IneligibleRow[];
  /** Job types the records can use (work orders: Work Order Picking job types of their warehouses). */
  readonly jobTypes?: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  /** Jobs that "Create Job" would produce now (0 for a merge). */
  readonly jobCount: number;
}

/**
 * "X of Y orders are eligible": runs the real create/merge inside a savepoint and rolls
 * it back, so the answer always matches what the command would do.
 */
export async function checkEligibility(
  db: AppDb,
  auth: AuthContext,
  ctx: DomainCtx,
  input: z.output<typeof eligibilitySchema>,
): Promise<EligibilityResult> {
  requireOperation(auth, input.operation);
  if (input.operation === 'work-order') return await workOrderEligibility(db, auth, ctx, input.orderIds);
  if (!input.jobTypeId && !input.jobId) return await orderPreEligibility(db, auth, input.orderIds);
  let outcome: EligibilityResult | null = null;
  try {
    await withWriteTx(db, async (tx) => {
      const res = input.jobId
        ? {
            ...(await jobs.mergeIntoJob(tx, ctx, { jobId: input.jobId, orderIds: input.orderIds })),
            jobIds: [] as readonly string[],
          }
        : await jobs.createJobsFromOrders(tx, ctx, {
            orderIds: input.orderIds,
            jobTypeId: input.jobTypeId ?? '',
          });
      outcome = {
        total: new Set(input.orderIds).size,
        eligible: res.succeeded,
        ineligible: res.failed.map(withReason),
        jobCount: res.jobIds.length,
      };
      throw new DryRunRollback();
    });
  } catch (error: unknown) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  if (!outcome) throw validationError('Eligibility could not be evaluated');
  return outcome;
}

const withReason = (f: BulkResult['failed'][number]): IneligibleRow => ({ ...f, reason: f.message });

const JOBBABLE_STATUSES = new Set(['Open', 'Shortage', 'Ready to Pick']);

/**
 * First step of the shared create-job modal (no job type chosen yet): which orders can go into
 * a job at all, and the active Picking job types of their warehouses. The exact check (conditions,
 * allocation) runs once a job type or job is chosen.
 */
async function orderPreEligibility(
  db: AppDb,
  auth: AuthContext,
  ids: readonly string[],
): Promise<EligibilityResult> {
  const so = schema.shipmentOrders;
  const unique = [...new Set(ids)];
  const rows = (
    await db
      .select({
        id: so.id,
        code: so.code,
        status: so.status,
        jobId: so.jobId,
        warehouseId: so.warehouseId,
        clientId: so.clientId,
        deletedAt: so.deletedAt,
      })
      .from(so)
      .where(inArray(so.id, unique))
  ).filter((r) => !r.deletedAt && hasWarehouse(auth.viewScope, r.warehouseId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const eligible: string[] = [];
  const ineligible: IneligibleRow[] = [];
  for (const id of unique) {
    const r = byId.get(id);
    const reason = !r
      ? 'Shipment order not found'
      : r.jobId
        ? `Order ${r.code} is already in a job.`
        : !JOBBABLE_STATUSES.has(r.status)
          ? `Order ${r.code} is ${r.status}; only Open, Shortage or Ready to Pick orders can be added to a job.`
          : null;
    if (reason)
      ineligible.push({
        id,
        code: r ? 'INVALID_STATE' : 'NOT_FOUND',
        message: reason,
        reason,
        recordCode: r?.code ?? null,
      });
    else eligible.push(id);
  }
  const warehouseIds = [...new Set(rows.map((r) => r.warehouseId))];
  const jt = schema.jobTypes;
  const jobTypes =
    warehouseIds.length === 0
      ? []
      : (
          await db
            .select({ id: jt.id, code: jt.code, name: jt.description })
            .from(jt)
            .where(
              and(
                inArray(jt.warehouseId, warehouseIds),
                eq(jt.operationType, 'Picking'),
                eq(jt.isActive, true),
              ),
            )
            .orderBy(asc(jt.code))
        ).map((t) => ({ id: t.id, code: t.code, name: t.name }));
  return { total: unique.length, eligible, ineligible, jobCount: 0, jobTypes };
}

/** Work orders: dry run of Picking/Job Operations (M08 `runPicking`); shortages count as ineligible. */
async function workOrderEligibility(
  db: AppDb,
  auth: AuthContext,
  ctx: DomainCtx,
  ids: readonly string[],
): Promise<EligibilityResult> {
  const res = await runPicking(db, { ...ctx, scope: auth.scope }, { ids, dryRun: true });
  const eligible = res.outcomes.filter((o) => o.outcome === 'allocated').map((o) => o.id);
  const ineligible = res.outcomes
    .filter((o) => o.outcome !== 'allocated')
    .map((o): IneligibleRow => {
      const detail = o.shortages.map((x) => `${x.sku} needs ${x.need}, ${x.free} free`).join('; ');
      const reason = detail ? `${o.message} (${detail})` : o.message;
      return { id: o.id, code: o.code, message: reason, reason };
    });
  return {
    total: new Set(ids).size,
    eligible,
    ineligible,
    jobCount: eligible.length,
    jobTypes: res.jobTypes.map((t) => ({ id: t.id, code: t.code, name: t.name })),
  };
}

/* ------------------------------------------------------------- allocation */

export const ALLOCATE_PERMISSION = 'fulfillment.shipment_orders.picking_job_operations';
export const DEALLOCATE_PERMISSION = 'fulfillment.shipment_orders.cancel_picking';

export const allocateSchema = z.object({
  action: z.enum(['allocate', 'deallocate']).default('allocate'),
  orderIds: bulkIdsSchema,
  warehouseId: idSchema.optional(),
  algorithmId: idSchema.nullish(),
  mode: z.enum(['full', 'partial']).default('full'),
});

export async function runAllocation(
  db: AppDb,
  auth: AuthContext,
  ctx: DomainCtx,
  input: z.output<typeof allocateSchema>,
): Promise<BulkResult> {
  if (input.action === 'deallocate') {
    if (!can(auth, DEALLOCATE_PERMISSION)) throw forbiddenError();
    return await allocation.deallocate(db, ctx, { orderIds: input.orderIds });
  }
  if (!can(auth, ALLOCATE_PERMISSION)) throw forbiddenError();
  if (!input.warehouseId) throw validationError('Choose a warehouse', { warehouseId: ['Required'] });
  if (!hasWarehouse(auth.scope, input.warehouseId))
    throw validationError('Warehouse not found', { warehouseId: ['Warehouse not found'] });
  return await allocation.allocateOrders(db, ctx, {
    orderIds: input.orderIds,
    warehouseId: input.warehouseId,
    algorithmId: input.algorithmId ?? null,
    mode: input.mode,
  });
}

/* ------------------------------------------------------------------ tasks */

export const TASK_PERMISSIONS = {
  execute: 'fulfillment.task_details.execute_task',
  update: 'fulfillment.task_details.update_task',
  cancel: 'fulfillment.task_details.cancel_task',
} as const;

export const taskExecuteSchema = z.object({
  taskIds: bulkIdsSchema,
  targetLocationId: idSchema,
  targetLpId: idSchema.nullish(),
  qty: z.number().int().min(0).optional(),
  serials: z.array(z.string().trim().min(1).max(100)).max(1000).optional(),
  createResolutionJob: z.boolean().optional(),
  note: z.string().trim().max(500).nullish(),
});

export const taskUpdateSchema = z
  .object({
    taskId: idSchema,
    targetLocationId: idSchema.nullish(),
    targetLpId: idSchema.nullish(),
    moveToJobId: idSchema.optional(),
  })
  .refine(
    (b) => b.targetLocationId !== undefined || b.targetLpId !== undefined || b.moveToJobId !== undefined,
    'Nothing to update',
  );

export const taskCancelSchema = z.object({ ids: bulkIdsSchema });

/** Per-id cancel (a failing task does not block the others). */
export async function cancelTasks(db: AppDb, ctx: DomainCtx, ids: readonly string[]): Promise<BulkResult> {
  return await runBulk(db, ids, async (tx, id) => {
    await tasks.cancel(tx, ctx, { taskIds: [id] });
  });
}

/* --------------------------------------------------------------- shipping */

export const SHIPPING_PERMISSIONS = {
  rates: 'fulfillment.shipment_orders.create_label',
  labels: 'fulfillment.shipment_orders.create_label',
  void: 'fulfillment.shipment_orders.void_label',
  ship: 'fulfillment.shipment_orders.ship_order',
  returnLabel: 'fulfillment.shipment_orders.create_return_label',
  closeEod: 'fulfillment.end_of_day.print_end_of_the_day_report',
} as const;

const MAX_DIM = 500;
const MAX_WEIGHT_OZ = 2400;

export const packageSpecSchema = z.object({
  weightOz: z.number().positive().max(MAX_WEIGHT_OZ),
  length: z.number().positive().max(MAX_DIM),
  width: z.number().positive().max(MAX_DIM),
  height: z.number().positive().max(MAX_DIM),
});

const packageInputSchema = packageSpecSchema.extend({
  shipmentPackageId: idSchema.nullish(),
  items: z
    .array(z.object({ orderLineId: idSchema, qty: z.number().int().positive() }))
    .max(1000)
    .optional(),
});

export const rateShopSchema = z.object({
  orderId: idSchema,
  packages: z.array(packageSpecSchema).min(1).max(50),
  presetId: idSchema.nullish(),
  carrierConnectionIds: z.array(idSchema).max(50).optional(),
});

export const createLabelSchema = z.object({
  orderId: idSchema,
  carrierConnectionId: idSchema,
  carrierServiceId: idSchema,
  packages: z.array(packageInputSchema).min(1).max(50),
  format: z.enum(LABEL_FORMATS).optional(),
  rateShoppingPresetId: idSchema.nullish(),
  source: z.enum(['BatchPacking', 'PackingStation', 'OrderGrid', 'ShipmentPlan']).optional(),
  insuranceType: z.string().trim().max(40).nullish(),
  insuranceValue: z.number().min(0).max(1_000_000).nullish(),
  confirmationType: z.string().trim().max(40).nullish(),
  allowSaturdayDelivery: z.boolean().optional(),
  otherCost: z.number().min(0).max(100_000).optional(),
  externalReference: z.string().trim().max(120).nullish(),
  scheduledPickupAt: z.string().trim().max(40).nullish(),
});

export const voidLabelSchema = z.object({ shipmentId: idSchema });

export const shipOrdersSchema = z.object({
  ids: bulkIdsSchema,
  shipDate: z.iso.datetime().optional(),
  // The HTTP surface always requires an active label (db:verify shipped_without_label); label-less
  // shipping exists only for in-process tests and seeds.
  requireLabel: z.literal(true).default(true),
});

export const returnLabelSchema = z.object({
  orderId: idSchema,
  returnOrderId: idSchema.nullish(),
  carrierConnectionId: idSchema,
  carrierServiceId: idSchema,
  package: packageSpecSchema,
  format: z.enum(LABEL_FORMATS).optional(),
});

export const closeEodSchema = z.object({ manifestId: idSchema });
