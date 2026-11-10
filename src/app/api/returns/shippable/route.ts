/** `GET /api/returns/shippable?orderIds=a,b` — shipped lines and returnable quantities (Create RMA). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { RETURN_PERMISSIONS, shippableOrder } from "@/server/repositories/returns";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.createRma,
  query: z.object({ orderIds: z.string().min(1, "Choose a shipped order").max(4000) }),
  handler: ({ db, auth, query }) => {
    const ids = [...new Set(query.orderIds.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 50);
    return ids.map((id) => {
      try {
        return shippableOrder(db, auth.scope, id);
      } catch (error) {
        if (error instanceof AppError && error.code === "NOT_FOUND") return { id, missing: true as const };
        throw error;
      }
    });
  },
});
