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
  handler: ({ db, auth, query }) => listSchedules(db, auth, query.gridKey),
});

export const POST = defineRoute({
  name: "POST /api/reports/schedules",
  body: scheduleInputSchema,
  handler: ({ db, auth, body }) => createSchedule(db, auth, body),
});
