/**
 * Put-to-cart (REQ-R10-6):
 * - `GET /api/mobile-carts/[id]/job` lists the open picking jobs of the cart's warehouse that can take it.
 * - `POST { jobId }` puts the job on the cart and gives each of its orders a cell (A01, A02, … scanned as <CART>-A01).
 * - `DELETE` empties the cart: frees every cell and unlinks its open jobs.
 * Writers: whoever edits carts, assigns jobs or executes tasks (pickers start a cart job on the floor).
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { assignCartJob, cartJobCandidates, releaseMobileCart } from "@/server/repositories/mobile-carts";

const WRITERS = ["settings.mobile_carts.edit", "fulfillment.job_management.assign", "fulfillment.task_details.execute_task"] as const;

export const GET = defineRoute({
  permission: ["settings.mobile_carts.view", "inventory.inventory_by_location.view"],
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await cartJobCandidates(db, auth, params.id),
});

export const POST = defineRoute({
  permission: WRITERS,
  params: idParamsSchema,
  body: z.object({ jobId: z.string().min(1, "Choose a job").max(64) }),
  handler: async ({ db, auth, actor, params, body }) => await assignCartJob(db, auth, actor, params.id, body.jobId),
});

export const DELETE = defineRoute({
  permission: WRITERS,
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => await releaseMobileCart(db, auth, actor, params.id),
});
