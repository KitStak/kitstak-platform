/**
 * `GET /api/clients/code-check?code=APX[&exceptId=…]` — Create Client step 1: whether the code is free
 * (case-insensitive, global) and the nearest free variant to suggest. Returns no client data.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { clientCodeCheck } from "@/server/repositories/clients";

export const GET = defineRoute({
  permission: ["settings.clients.create", "settings.clients.edit"],
  query: z.object({ code: z.string().trim().max(20), exceptId: z.string().trim().max(64).optional() }),
  handler: async ({ db, query }) => await clientCodeCheck(db, query.code, query.exceptId),
});
