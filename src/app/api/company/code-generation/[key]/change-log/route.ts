/** `GET /api/company/code-generation/[key]/change-log` — history of one sequence's preferences. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { SEQUENCE_ENTITY } from "@/server/repositories/company-sequences";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/users-shared";

export const GET = defineRoute({
  permission: "settings.data_setup.view",
  params: z.object({ key: z.string().trim().min(1).max(40).regex(/^[A-Za-z]+$/) }),
  query: changeLogPageSchema,
  handler: ({ db, params, query }) => changeLogResult(db, SEQUENCE_ENTITY, params.key, query),
});
