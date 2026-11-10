/** `GET /api/company/change-log` — field-level history of Company Settings. */
import { defineRoute } from "@/server/api/define-route";
import { COMPANY_ENTITY } from "@/server/repositories/company";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/users-shared";

export const GET = defineRoute({
  permission: "settings.company_settings.view",
  query: changeLogPageSchema,
  handler: ({ db, query }) => changeLogResult(db, COMPANY_ENTITY, "company", query),
});
