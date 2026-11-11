/** `GET /api/audit/stats` — last-24-hour security counters for the Audit Log header. */
import { defineRoute } from "@/server/api/define-route";
import { auditStats } from "@/server/repositories/audit";

export const GET = defineRoute({
  permission: "settings.users.view",
  handler: async ({ db }) => await auditStats(db),
});
