/**
 * Job Management "Label ▾" (Logiwa 02 §1): create, reprint or void the shipping labels of
 * every order in the selected jobs. Carrier calls are async, so this runs outside the
 * route transaction; each order is its own unit of work and reports its own outcome.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import * as schema from '@/server/db/schema';
import { shipping } from '@/server/domain';
import { DomainError, describeError } from '@/server/domain/errors';
import type { DomainCtx } from '@/server/domain/types';
import { jobOrderIds, loadJob, refreshLabelStatus } from './jobs';
import { flatMapSeq } from '@/server/db/sql';

export const DEFAULT_PACKAGE = { length: 10, width: 8, height: 4 } as const;

export interface LabelOutcome {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
  /** Label files for reprint (opened by the client). */
  readonly files: readonly {
    readonly orderCode: string;
    readonly trackingNumber: string;
    readonly fileId: string | null;
  }[];
}

async function orderRows(db: AppDb, auth: AuthContext, jobIds: readonly string[]) {
  const ids = await flatMapSeq(jobIds, async (id) => {
    await loadJob(db, auth, id);
    return await jobOrderIds(db, id);
  });
  return await flatMapSeq(
    [...new Set(ids)],
    async (id) => await db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)),
  );
}

async function packagesFor(db: AppDb, order: typeof schema.shipmentOrders.$inferSelect) {
  const pkg = order.shipmentPackageId
    ? (
        await db
          .select()
          .from(schema.shipmentPackages)
          .where(eq(schema.shipmentPackages.id, order.shipmentPackageId))
          .limit(1)
      )[0]
    : undefined;
  const dims = pkg as { length?: number | null; width?: number | null; height?: number | null } | undefined;
  return [
    {
      weightOz: Math.max(1, order.totalWeightOz || 1),
      length: dims?.length || DEFAULT_PACKAGE.length,
      width: dims?.width || DEFAULT_PACKAGE.width,
      height: dims?.height || DEFAULT_PACKAGE.height,
      shipmentPackageId: order.shipmentPackageId ?? null,
    },
  ];
}

async function activeLabels(db: AppDb, orderId: string) {
  return await db
    .select()
    .from(schema.shipments)
    .where(
      and(
        eq(schema.shipments.orderId, orderId),
        eq(schema.shipments.labelType, 'Shipping Label'),
        eq(schema.shipments.labelStatus, 'Active'),
        isNull(schema.shipments.actualShipmentAt),
      ),
    );
}

export async function runJobLabels(
  db: AppDb,
  auth: AuthContext,
  ctx: DomainCtx,
  input: { jobIds: readonly string[]; op: 'create' | 'reprint' | 'void' },
): Promise<LabelOutcome> {
  const orders = await orderRows(db, auth, input.jobIds);
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  const files: { orderCode: string; trackingNumber: string; fileId: string | null }[] = [];
  for (const order of orders) {
    try {
      const labels = await activeLabels(db, order.id);
      if (input.op === 'create') {
        if (labels.length > 0)
          throw new DomainError('INVALID_STATE', `Order ${order.code} already has an active label.`);
        if (!order.carrierConnectionId || !order.carrierServiceId) {
          throw new DomainError(
            'VALIDATION',
            `Order ${order.code} has no carrier service. Choose one on the order first.`,
          );
        }
        const res = await shipping.createLabel(db, ctx, {
          orderId: order.id,
          carrierConnectionId: order.carrierConnectionId,
          carrierServiceId: order.carrierServiceId,
          packages: await packagesFor(db, order),
          source: 'JobManagement',
        });
        for (const s of res.shipments)
          files.push({ orderCode: order.code, trackingNumber: s.trackingNumber, fileId: s.labelFileId });
      } else if (input.op === 'reprint') {
        if (labels.length === 0)
          throw new DomainError('INVALID_STATE', `Order ${order.code} has no active label to reprint.`);
        for (const s of labels)
          files.push({ orderCode: order.code, trackingNumber: s.trackingNumber, fileId: s.labelFileId });
      } else {
        if (labels.length === 0)
          throw new DomainError('INVALID_STATE', `Order ${order.code} has no active label to void.`);
        await shipping.voidLabel(db, ctx, { shipmentId: labels[0].id });
      }
      succeeded.push(order.id);
    } catch (error) {
      failed.push({ id: order.id, ...describeError(error) });
    }
  }
  for (const id of input.jobIds) await refreshLabelStatus(db, id);
  return { succeeded, failed, files };
}
