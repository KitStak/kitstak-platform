/**
 * `GET /api/locations/[id]/ledger?page=&ps=&kind=movements|reservations|all` — the location's
 * ledger, newest first, paged. Direction and quantity follow the signed quantity (an adjustment
 * of −2 is Out 2); allocation reservations are a separate kind, not stock movements.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { listLocationLedger } from "@/server/repositories/locations";
import { LEDGER_KINDS } from "@/lib/grid-defs/facility/location-ledger";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  ps: z.coerce.number().int().min(1).max(200).default(25),
  kind: z.enum(LEDGER_KINDS).default("movements"),
});

export const GET = defineRoute({
  permission: ["settings.locations.view", "inventory.inventory_by_location.view"],
  params: idParamsSchema,
  query: querySchema,
  handler: async ({ db, auth, params, query }) => {
    const { rows, total } = await listLocationLedger(db, auth, params.id, query);
    return listResult(rows, { total, page: query.page, pageSize: query.ps, kind: query.kind });
  },
});
