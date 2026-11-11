/** `GET /api/clients/options[?all=1]` — slim, fast client picker options (id, code, name, status, currency) inside the caller's scope; Active only unless `all=1`. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { clientOptions } from "@/server/repositories/clients";

export const GET = defineRoute({
  query: z.object({ all: z.enum(["0", "1"]).optional() }),
  handler: async ({ db, auth, query }) => await clientOptions(db, auth, query.all === "1"),
});
