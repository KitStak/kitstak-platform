import { connection } from "next/server";
import { z } from "zod";
import {
  badRequest,
  listQuerySchema,
  ok,
  queryOf,
  requireSession,
  serverError,
  zodMessage,
} from "@/server/api-utils";
import { JOB_STATUSES, JOB_TYPES, listJobs } from "@/server/repositories/jobs";

const querySchema = listQuerySchema.extend({
  status: z.enum(JOB_STATUSES).optional(),
  jobType: z.enum(JOB_TYPES).optional(),
});

export async function GET(request: Request): Promise<Response> {
  await connection();
  try {
    const denied = await requireSession();
    if (denied) return denied;
    const parsed = querySchema.safeParse(queryOf(request));
    if (!parsed.success) return badRequest(zodMessage(parsed.error));
    const { page, pageSize, search, status, jobType } = parsed.data;
    const { rows, total } = listJobs({ page, pageSize, search, status, jobType });
    return ok(rows, { total, page, pageSize });
  } catch (error: unknown) {
    return serverError("GET /api/jobs", error);
  }
}
