/**
 * Search provider "clients" (Clients). Matches client code and name inside the caller's
 * client scope; M11 may replace it with a repository-backed provider.
 */
import { and, asc, inArray, or, type SQL } from "drizzle-orm";
import { clients } from "@/server/db/schema";
import { COUNT_ALL, containsText, matchRank } from "../match";
import { hitRank, listSearchHref, type SearchContext, type SearchProvider } from "../types";

/** null when the caller can see no clients at all. */
function where({ auth, q }: Pick<SearchContext, "auth" | "q">): SQL | null {
  const scope = auth.scope.clientIds;
  if (scope !== "all" && scope.length === 0) return null;
  const parts: SQL[] = [or(containsText(clients.code, q), containsText(clients.name, q)) as SQL];
  if (scope !== "all") parts.push(inArray(clients.id, [...scope]));
  return and(...parts) as SQL;
}

export const provider: SearchProvider = {
  key: "clients",
  label: "Clients",
  singular: "Client",
  owner: "foundation",
  configured: true,
  permission: "settings.clients.view",
  seeAllHref: (q) => listSearchHref("/clients", q),
  count: (ctx) => {
    const w = where(ctx);
    return w ? (ctx.db.select({ n: COUNT_ALL }).from(clients).where(w).get()?.n ?? 0) : 0;
  },
  search: (ctx) => {
    const w = where(ctx);
    if (!w) return [];
    return ctx.db
      .select({ id: clients.id, code: clients.code, name: clients.name })
      .from(clients)
      .where(w)
      .orderBy(matchRank(clients.name, ctx.q), asc(clients.name))
      .limit(ctx.limit)
      .all()
      .map((c) => ({ id: c.id, title: c.name, subtitle: c.code, href: `/clients/${c.id}`, rank: hitRank(ctx.q, [c.code, c.name]) }));
  },
};
