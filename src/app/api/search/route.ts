/** `GET /api/search?q=&limit=&types=` — global search: Pages + scoped record groups. */
import { defineRoute } from "@/server/api/define-route";
import { globalSearch, searchQuerySchema } from "@/server/search";

export const GET = defineRoute({
  query: searchQuerySchema,
  handler: async ({ db, auth, query }) => {
    const keys = query.types ? query.types.split(",").map((k) => k.trim()).filter(Boolean) : undefined;
    return globalSearch({ db, auth, q: query.q, limit: query.limit }, keys);
  },
});
