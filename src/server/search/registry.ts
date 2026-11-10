/**
 * Global search registry (BUILD_PLAN F6 `search/registry.ts`) and the fan-out used by
 * `GET /api/search`. Providers run in parallel; one failing or slow provider is logged
 * and dropped, never failing the whole search.
 */
import { z } from "zod";
import { canAny } from "@/server/auth/permissions";
import { log } from "@/server/log";
import { pagesProvider } from "./pages";
import { provider as clients } from "./providers/clients";
import { provider as jobs } from "./providers/jobs";
import { provider as locations } from "./providers/locations";
import { provider as lps } from "./providers/lps";
import { provider as orders } from "./providers/orders";
import { provider as pos } from "./providers/pos";
import { provider as products } from "./providers/products";
import { provider as roles } from "./providers/roles";
import { provider as users } from "./providers/users";
import { RANK_OTHER_FIELD, type SearchContext, type SearchHit, type SearchProvider } from "./types";

export const SEARCH_PROVIDERS: readonly SearchProvider[] = Object.freeze([
  pagesProvider, orders, pos, products, locations, lps, jobs, clients, users, roles,
]);

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;
export const DEFAULT_GROUP_LIMIT = 5;
export const PROVIDER_TIMEOUT_MS = 3000;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(SEARCH_MIN_LENGTH).max(SEARCH_MAX_LENGTH),
  limit: z.coerce.number().int().min(1).max(25).default(DEFAULT_GROUP_LIMIT),
  /** Restrict to some provider keys (comma separated). */
  types: z.string().max(200).optional(),
});

export interface SearchGroup {
  readonly key: string;
  readonly label: string;
  /** Per-row type label ("Order"). */
  readonly singular: string;
  readonly hits: readonly SearchHit[];
  /** Matches in scope (may exceed `hits.length`). */
  readonly total: number;
  /** Best (lowest) hit rank; groups are returned best first. */
  readonly bestRank: number;
  readonly seeAllHref?: string;
}

export function visibleProviders(ctx: Pick<SearchContext, "auth">, keys?: readonly string[]): SearchProvider[] {
  return SEARCH_PROVIDERS.filter((p) =>
    p.configured
    && (keys === undefined || keys.includes(p.key))
    && (p.permission === null || canAny(ctx.auth, typeof p.permission === "string" ? [p.permission] : p.permission)));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}

interface ProviderResult {
  readonly hits: readonly SearchHit[];
  readonly total: number | null;
}

async function runProvider(provider: SearchProvider, ctx: SearchContext): Promise<ProviderResult> {
  const [hits, total] = await Promise.all([
    Promise.resolve().then(() => provider.search(ctx)),
    provider.count ? Promise.resolve().then(() => provider.count?.(ctx) ?? null) : Promise.resolve(null),
  ]);
  return { hits, total };
}

function toGroup(provider: SearchProvider, ctx: SearchContext, result: ProviderResult): SearchGroup | null {
  const hits = [...result.hits.slice(0, ctx.limit)].sort((a, b) => (a.rank ?? RANK_OTHER_FIELD) - (b.rank ?? RANK_OTHER_FIELD));
  if (hits.length === 0) return null;
  const bestRank = Math.min(...hits.map((h) => h.rank ?? RANK_OTHER_FIELD));
  return {
    key: provider.key,
    label: provider.label,
    singular: provider.singular ?? provider.label,
    hits,
    total: Math.max(result.total ?? 0, hits.length),
    bestRank,
    ...(provider.seeAllHref ? { seeAllHref: provider.seeAllHref(ctx.q) } : {}),
  };
}

/**
 * Runs every visible provider; returns non-empty groups ordered by their best match
 * (an exact client code beats five "contains" orders), ties in registry order.
 */
export async function globalSearch(ctx: SearchContext, keys?: readonly string[]): Promise<SearchGroup[]> {
  const providers = visibleProviders(ctx, keys);
  const settled = await Promise.allSettled(providers.map((p) => withTimeout(runProvider(p, ctx), PROVIDER_TIMEOUT_MS)));
  const groups = providers.flatMap((provider, index) => {
    const outcome = settled[index];
    if (!outcome || outcome.status === "rejected") {
      log.warn("search provider failed", { provider: provider.key, err: outcome?.status === "rejected" ? outcome.reason : undefined });
      return [];
    }
    const group = toGroup(provider, ctx, outcome.value);
    return group ? [group] : [];
  });
  return groups.map((group, order) => ({ group, order }))
    .sort((a, b) => a.group.bestRank - b.group.bestRank || a.order - b.order)
    .map(({ group }) => group);
}
