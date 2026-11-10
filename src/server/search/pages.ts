/**
 * Pages search provider, generated from the nav config. The walker is structural (any
 * object with string `label` + `href`, plus optional `permission` and `aliases`), so it
 * works with the current layout nav and the F4 `src/config/nav-config.ts` item shape.
 */
import { canAny } from "@/server/auth/permissions";
import { NAV_MENUS } from "@/components/layout/nav-config";
import { hitRank, type SearchHit, type SearchProvider } from "./types";

export interface PageEntry {
  readonly label: string;
  readonly href: string;
  /** Breadcrumb trail of parent labels/headings. */
  readonly trail: readonly string[];
  readonly permission: readonly string[];
  readonly aliases: readonly string[];
}

const MAX_DEPTH = 8;

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function nodeName(node: Record<string, unknown>): string | null {
  for (const key of ["label", "heading", "title"]) {
    if (typeof node[key] === "string") return node[key];
  }
  return null;
}

/** Flattens any nav tree into page entries (deduplicated by href, first wins). */
export function collectPages(tree: unknown): PageEntry[] {
  const seen = new Set<string>();
  const out: PageEntry[] = [];
  const visit = (value: unknown, trail: readonly string[], depth: number): void => {
    if (depth > MAX_DEPTH || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, trail, depth + 1));
      return;
    }
    const node = value as Record<string, unknown>;
    const name = nodeName(node);
    if (typeof node.href === "string" && name && node.href.startsWith("/") && !seen.has(node.href)) {
      seen.add(node.href);
      out.push({ label: name, href: node.href, trail, permission: stringArray(node.permission), aliases: stringArray(node.aliases) });
    }
    const nextTrail = name ? [...trail, name] : trail;
    for (const child of Object.values(node)) {
      if (child !== null && typeof child === "object") visit(child, nextTrail, depth + 1);
    }
  };
  visit(tree, [], 0);
  return out;
}

/** 3 = label starts with q, 2 = a word starts with q, 1 = contains (label or alias), 0 = no match. */
export function scorePage(page: PageEntry, q: string): number {
  const needle = q.toLowerCase();
  const label = page.label.toLowerCase();
  if (label.startsWith(needle)) return 3;
  if (label.split(/[\s/&()-]+/).some((word) => word.startsWith(needle))) return 2;
  const haystacks = [label, ...page.aliases.map((a) => a.toLowerCase()), ...page.trail.map((t) => t.toLowerCase())];
  return haystacks.some((h) => h.includes(needle)) ? 1 : 0;
}

export function searchPages(pages: readonly PageEntry[], q: string, limit: number, allowed: (permission: readonly string[]) => boolean): SearchHit[] {
  return pages
    .filter((page) => page.permission.length === 0 || allowed(page.permission))
    .map((page) => ({ page, score: scorePage(page, q) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.page.label.localeCompare(b.page.label))
    .slice(0, limit)
    .map(({ page }) => ({ id: page.href, title: page.label, subtitle: page.trail.join(" › ") || undefined, href: page.href }));
}

let cachedPages: readonly PageEntry[] | undefined;

export function navPages(): readonly PageEntry[] {
  cachedPages ??= Object.freeze(collectPages(NAV_MENUS));
  return cachedPages;
}

export const pagesProvider: SearchProvider = {
  key: "pages",
  label: "Pages",
  singular: "Page",
  owner: "foundation",
  configured: true,
  permission: null,
  search: (ctx) => searchPages(navPages(), ctx.q, ctx.limit, (permission) => canAny(ctx.auth, permission))
    .map((hit) => ({ ...hit, rank: hitRank(ctx.q, [hit.title]) })),
};
