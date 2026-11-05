import { connection } from "next/server";
import { ok, serverError } from "@/server/api-utils";
import { getDashboardData } from "@/server/repositories/dashboard";

export async function GET(): Promise<Response> {
  await connection();
  try {
    return ok(getDashboardData());
  } catch (error: unknown) {
    return serverError("GET /api/dashboard", error);
  }
}
