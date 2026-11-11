/** `GET /api/algorithms?kind=putaway|allocation` — grid (grid grammar). `POST` — create an algorithm with its rules. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { ALGORITHM_KIND_SLUG, algorithmSaveSchema } from "@/lib/grid-defs/integrations/algorithms";
import { createAlgorithm, listAlgorithms } from "@/server/repositories/algorithms";

const listQuery = z.object({ kind: z.enum(["putaway", "allocation"]).default("putaway") }).loose();

export const GET = defineRoute({
  permission: "automation.algorithms.view",
  query: listQuery,
  handler: async ({ db, auth, grid, query }) => {
    const q = grid();
    const { rows, total } = await listAlgorithms(db, auth, ALGORITHM_KIND_SLUG[query.kind], q);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});

export const POST = defineRoute({
  permission: "automation.algorithms.create",
  body: algorithmSaveSchema,
  handler: async ({ db, auth, actor, body }) => created(await createAlgorithm(db, auth, actor, body)),
});
