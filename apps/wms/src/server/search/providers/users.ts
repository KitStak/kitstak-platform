/**
 * Search provider "users" (Users). Matches name, email, first and last name. Admin data, so it
 * needs `settings.users.view`; password hashes and session data never leave the query. Owner: M14.
 */
import { or, type SQL } from "drizzle-orm";
import { asc } from "@/server/db/order";
import { users } from "@/server/db/schema";
import { COUNT_ALL, containsText, matchRank } from "../match";
import { hitRank, listSearchHref, type SearchContext, type SearchProvider } from "../types";

function where({ q }: Pick<SearchContext, "q">): SQL {
  return or(containsText(users.name, q), containsText(users.email, q), containsText(users.firstName, q), containsText(users.lastName, q)) as SQL;
}

export const provider: SearchProvider = {
  key: "users",
  label: "Users",
  singular: "User",
  owner: "M14",
  configured: true,
  permission: "settings.users.view",
  seeAllHref: (q) => listSearchHref("/settings/users", q),
  count: async (ctx) => (await ctx.db.select({ n: COUNT_ALL }).from(users).where(where(ctx)).limit(1))[0]?.n ?? 0,
  search: async (ctx) =>
    (await ctx.db
      .select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive, userType: users.userType })
      .from(users)
      .where(where(ctx))
      .orderBy(matchRank(users.email, ctx.q), asc(users.name))
      .limit(ctx.limit))
      .map((u) => ({
        id: u.id,
        title: u.name,
        subtitle: [u.email, u.userType].filter(Boolean).join(" · "),
        status: { label: u.isActive ? "Active" : "Inactive", domain: "active" as const },
        href: `/settings/users?id=${encodeURIComponent(u.id)}`,
        rank: hitRank(ctx.q, [u.email, u.name]),
      })),
};
