/** `GET /api/carriers?provider=` — carrier setups. `POST` — Add New Connection (validates Production credentials live). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { createCarrierSchema } from "@/lib/grid-defs/integrations/carriers";
import { createCarrierConnection, listCarrierConnections } from "@/server/repositories/carriers";

export const GET = defineRoute({
  permission: ["integrations.integrations.create_setup", "integrations.integrations.edit_setup", "integrations.integrations.delete_setup", "integrations.carrier_monitoring.view"],
  query: z.object({ provider: z.string().trim().max(40).optional() }),
  handler: ({ db, auth, query }) => listCarrierConnections(db, auth, query.provider ?? null),
});

export const POST = defineRoute({
  permission: "integrations.integrations.create_setup",
  body: createCarrierSchema,
  transaction: false,
  handler: async ({ db, auth, actor, body }) => created(await createCarrierConnection(db, auth, actor, body)),
});
