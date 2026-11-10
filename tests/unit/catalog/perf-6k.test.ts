/**
 * Catalog scale check: 6,500 SKUs and 6,500 listings, measured (not extrapolated).
 * The Products and Product Listings first page must come back well under the 1 s
 * first-render budget (DESIGN_SPEC grid budget). Timings are printed for the progress notes.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { Scope } from "@/server/auth/scope";
import { EMPTY_GRID_QUERY, type GridQuery } from "@/server/query/grid-query";
import { listProducts } from "@/server/repositories/products";
import { listListings } from "@/server/repositories/listings";
import { createWorld, type World } from "../foundation/domain/fixtures";

const N = 6500;
const BUDGET_MS = 250; // server share of the 1 s first render
let w: World;
let scope: Scope;

function timed<T>(fn: () => T): { ms: number; out: T } {
  fn(); // warm the statement cache like a running server
  const runs: number[] = [];
  let out!: T;
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    out = fn();
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  return { ms: runs[2] ?? 0, out };
}

beforeAll(() => {
  w = createWorld();
  scope = { warehouseIds: [w.warehouseId], clientIds: "all" } as unknown as Scope;
  const channelId = w.db.insert(schema.channelConnections).values({ provider: "shopify", storeName: "Perf Shop", clientId: w.clientId, settings: {} as never }).returning().get().id;
  const loc = w.loc.storageA;
  w.db.run(sql`BEGIN`);
  for (let i = 0; i < N; i++) {
    const sku = `PERF-${String(i).padStart(5, "0")}`;
    const pid = w.db.insert(schema.products).values({ clientId: w.clientId, sku, barcode: sku, name: `Perf product ${i}`, category: "General", weightOz: 8, lengthIn: 4, widthIn: 4, heightIn: 2, price: 10, status: "Active" }).returning({ id: schema.products.id }).get().id;
    if (i % 3 === 0) w.db.insert(schema.inventory).values({ warehouseId: w.warehouseId, locationId: loc, clientId: w.clientId, productId: pid, onHand: 5, receivedAt: "2026-01-01" }).run();
    w.db.insert(schema.productListings).values({ channelConnectionId: channelId, clientId: w.clientId, sellerSku: i % 2 ? sku : `SHOP-${i}`, channelProductId: `gid-${i}`, name: `Listing ${i}`, productId: i % 2 ? pid : null }).run();
  }
  w.db.run(sql`COMMIT`);
}, 120_000);
afterAll(() => w.close());

const q = (extra: Partial<GridQuery> = {}): GridQuery => ({ ...EMPTY_GRID_QUERY, pageSize: 50, ...extra });

describe(`catalog grids at ${N} SKUs`, () => {
  it("Products first page (default sort, with total)", () => {
    const { ms, out } = timed(() => listProducts(w.db, scope, q()));
    console.info(`[perf] products page1 ${ms.toFixed(1)} ms, total ${out.total}`);
    expect(out.total).toBeGreaterThanOrEqual(N);
    expect(out.rows.length).toBe(50);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("Products quick search (starts with) and deep page", () => {
    const s = timed(() => listProducts(w.db, scope, q({ q: "PERF-012" })));
    const deep = timed(() => listProducts(w.db, scope, q({ page: 100 })));
    console.info(`[perf] products search ${s.ms.toFixed(1)} ms (${s.out.total}), page 100 ${deep.ms.toFixed(1)} ms`);
    expect(s.ms).toBeLessThan(BUDGET_MS);
    expect(deep.ms).toBeLessThan(BUDGET_MS);
  });

  it("Listings first page, unlinked and linked, with counts", () => {
    const un = timed(() => listListings(w.db, scope, q(), "unlinked"));
    const li = timed(() => listListings(w.db, scope, q(), "linked"));
    console.info(`[perf] listings unlinked ${un.ms.toFixed(1)} ms (${un.out.total}), linked ${li.ms.toFixed(1)} ms (${li.out.total})`);
    expect(un.out.counts.linked + un.out.counts.unlinked).toBe(N);
    expect(un.ms).toBeLessThan(BUDGET_MS);
    expect(li.ms).toBeLessThan(BUDGET_MS);
  });
});
