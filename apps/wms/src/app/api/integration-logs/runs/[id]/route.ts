/** `GET /api/integration-logs/runs/[id]?page&ps&errors` — Show Details for one run (header + items). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { getRun } from "@/server/repositories/integration-logs";

export const GET = defineRoute({
  permission: "integrations.integration_logs.view",
  params: idParamsSchema,
  query: z.object({ page: z.coerce.number().int().min(1).default(1), ps: z.coerce.number().int().min(1).max(500).default(50), errors: z.enum(["true", "false"]).default("false") }),
  handler: async ({ db, auth, params, query }) => await getRun(db, auth, params.id, query.page, query.ps, query.errors === "true"),
});
