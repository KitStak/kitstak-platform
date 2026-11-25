/**
 * Kit reads for a program (docs/programs/SPEC.md 6.3, 4.2 `kits.ts`): WMS capacity for a
 * variant's kit, shortages for a build, and the planner capacity tint. Read only, fail soft.
 */
import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { builds, programVariants } from '@/server/db/schema';
import { notFound } from '@/server/errors';
import { variantKitCapacity, variantKitShortages } from '@/server/integrations/wms-kits';
import type { IsoDate } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { requireTask } from '../access';
import { requireProgram } from './access';

export async function variantKit(ctx: DomainContext, key: string, variantId: string) {
  const { program } = await requireProgram(ctx, key);
  const [variant] = await db.select().from(programVariants).where(and(eq(programVariants.id, variantId), eq(programVariants.programId, program.id), isNull(programVariants.deletedAt)));
  if (!variant) throw notFound('That variant');
  return variantKitCapacity(ctx, variant);
}

export async function buildShortages(ctx: DomainContext, buildId: string) {
  await requireTask(ctx, buildId);
  const [build] = await db.select().from(builds).where(eq(builds.taskId, buildId));
  if (!build || !build.variantId) return { available: false as const, reason: 'not_linked' as const };
  const [variant] = await db.select().from(programVariants).where(eq(programVariants.id, build.variantId));
  if (!variant) return { available: false as const, reason: 'not_linked' as const };
  const remaining = Math.max(0, Number(build.plannedQty) - Number(build.builtQty));
  return variantKitShortages(ctx, variant, String(remaining));
}

/** Per linked variant: what WMS can build, and the first short component for the planned qty in the range. */
export async function plannerCapacity(ctx: DomainContext, key: string, range: { readonly from: IsoDate; readonly to: IsoDate }) {
  const { program } = await requireProgram(ctx, key);
  const variants = await db.select().from(programVariants).where(and(eq(programVariants.programId, program.id), isNull(programVariants.deletedAt), sql`(${programVariants.coreItemId} is not null or ${programVariants.wmsProductId} is not null)`));
  const planned = await db.execute(
    sql`select b.variant_id::text as variant_id, coalesce(sum(b.planned_qty - b.built_qty), 0)::text as qty from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null
         where b.program_id = ${program.id}::uuid and b.build_date between ${range.from}::date and ${range.to}::date group by 1`,
  );
  const qtyBy = new Map((planned as unknown as { rows: { variant_id: string; qty: string }[] }).rows.map((r) => [r.variant_id, r.qty]));
  const out = [];
  for (const variant of variants) {
    const capacity = await variantKitCapacity(ctx, variant);
    const shortages = await variantKitShortages(ctx, variant, qtyBy.get(variant.id) ?? '0');
    const first = shortages.available ? shortages.components.find((c) => Number(c.short) > 0) ?? null : null;
    out.push({
      variantId: variant.id,
      available: capacity.available,
      canBuild: capacity.available ? capacity.warehouses.reduce((sum, w) => sum + Number(w.netKittingCapacity), 0) : null,
      plannedQty: qtyBy.get(variant.id) ?? '0',
      firstShort: first,
    });
  }
  return { from: range.from, to: range.to, variants: out };
}
