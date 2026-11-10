/** `GET /api/channels?provider=` — store connections. `POST` — Connect Store (validates credentials live). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { connectStoreSchema } from "@/lib/grid-defs/integrations/channels";
import { connectStore, listChannelConnections } from "@/server/repositories/channels";

export const GET = defineRoute({
  permission: ["integrations.integrations.create_setup", "integrations.integrations.edit_setup", "integrations.integrations.delete_setup", "integrations.integration_logs.view", "integrations.integration_monitoring.view"],
  query: z.object({ provider: z.string().trim().max(40).optional() }),
  handler: ({ db, auth, query }) => listChannelConnections(db, auth, query.provider ?? null),
});

export const POST = defineRoute({
  permission: "integrations.integrations.create_setup",
  body: connectStoreSchema,
  transaction: false,
  handler: async ({ db, auth, actor, body }) => created(await connectStore(db, auth, actor, body)),
});
