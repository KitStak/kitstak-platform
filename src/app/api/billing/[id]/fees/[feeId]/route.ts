/** `PATCH|DELETE /api/billing/[id]/fees/[feeId]` — edit or delete one fee (contract must not be approved). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { feeSchema } from "@/lib/grid-defs/organization/billing";
import { deleteFee, updateFee } from "@/server/repositories/billing";

const params = z.object({ id: z.string().min(1).max(64), feeId: z.string().min(1).max(64) });

export const PATCH = defineRoute({
  permission: "settings.billing.edit",
  params,
  body: feeSchema,
  handler: ({ db, auth, actor, params: p, body }) => updateFee(db, auth, actor, p.id, p.feeId, body),
});

export const DELETE = defineRoute({
  permission: "settings.billing.edit",
  params,
  handler: ({ db, auth, actor, params: p }) => deleteFee(db, auth, actor, p.id, p.feeId),
});
