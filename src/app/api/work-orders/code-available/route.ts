/**
 * `GET /api/work-orders/code-available?code=…&exceptId=…`: wizard step 1 checks the work order
 * code on blur, so a duplicate shows inline on General instead of four steps later on Save.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { isWorkOrderCodeAvailable } from "@/server/repositories/work-orders";
import { WO_PERMISSIONS } from "@/server/repositories/work-orders-api";

const querySchema = z.object({ code: z.string().trim().min(1).max(64), exceptId: z.string().trim().max(64).optional() });

export const GET = defineRoute({
  permission: [WO_PERMISSIONS.create, WO_PERMISSIONS.edit],
  query: querySchema,
  handler: ({ db, query }) => ({ code: query.code, available: isWorkOrderCodeAvailable(db, query.code, query.exceptId) }),
});
