/**
 * `GET /api/reports/schedules?gridKey=` — the caller's scheduled report deliveries (team
 * schedules too for supervisors and admins). `POST` creates one from the current report view.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { createSchedule, listSchedules, scheduleInputSchema } from "@/server/repositories/reports-schedules";

export const GET = defineRoute({
  name: "GET /api/reports/schedules",
  query: z.object({ gridKey: z.string().max(80).optional() }),
  handler: async ({ db, auth, query }) => await listSchedules(db, auth, query.gridKey),
});

export const POST = defineRoute({
  name: "POST /api/reports/schedules",
  body: scheduleInputSchema,
  handler: async ({ db, auth, body }) => await createSchedule(db, auth, body),
});
