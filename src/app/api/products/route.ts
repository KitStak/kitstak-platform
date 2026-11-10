/** `GET /api/products` (grid grammar) · `POST /api/products` (wizard create). M09. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { domainCtx } from "@/server/repositories/platform-common";
import { listProducts } from "@/server/repositories/products";
import { createProductFromWizard } from "@/server/repositories/products-commands";
import type { ProductInput } from "@/lib/grid-defs/products/product-form";

export const GET = defineRoute({
  permission: "settings.products.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listProducts(db, auth.viewScope, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.products.create",
  body: z.record(z.string(), z.unknown()),
  handler: ({ db, auth, actor, body }) => {
    const row = createProductFromWizard(db, { ...domainCtx(actor, auth), scope: auth.scope }, body as ProductInput);
    return created({ id: row.id, sku: row.sku, version: row.version });
  },
});
