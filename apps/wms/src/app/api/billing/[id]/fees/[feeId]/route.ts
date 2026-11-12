/** `PATCH|DELETE /api/billing/[id]/fees/[feeId]` — edit or delete one fee (contract must not be approved). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { feeSchema } from '@/lib/grid-defs/organization/billing';
import { deleteFee, updateFee } from '@/server/repositories/billing';

const params = z.object({ id: z.string().min(1).max(64), feeId: z.string().min(1).max(64) });

export const PATCH = defineRoute({
  permission: 'settings.billing.edit',
  params,
  body: feeSchema,
  handler: async ({ db, auth, actor, params: p, body }) =>
    await updateFee(db, auth, actor, p.id, p.feeId, body),
});

export const DELETE = defineRoute({
  permission: 'settings.billing.edit',
  params,
  handler: async ({ db, auth, actor, params: p }) => await deleteFee(db, auth, actor, p.id, p.feeId),
});
