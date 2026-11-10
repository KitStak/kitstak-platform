/** `GET /api/job-types/algorithms?warehouseId=` — allocation algorithms of a warehouse. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { algorithmsFor } from "@/server/repositories/job-types";

export const GET = defineRoute({
  permission: ["settings.job_types.create", "settings.job_types.edit", "settings.job_types.view"],
  query: z.object({ warehouseId: z.string().min(1).max(64) }),
  handler: ({ db, auth, query }) => algorithmsFor(db, auth, query.warehouseId),
});
