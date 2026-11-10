/** `GET /api/work-orders/next-code`: the next automatic WO code (wizard default). */
import { defineRoute } from "@/server/api/define-route";
import { nextWorkOrderCode } from "@/server/repositories/work-orders";
import { WO_PERMISSIONS } from "@/server/repositories/work-orders-api";

export const GET = defineRoute({
  permission: [WO_PERMISSIONS.create, WO_PERMISSIONS.edit],
  handler: ({ db }) => ({ code: nextWorkOrderCode(db) }),
});
