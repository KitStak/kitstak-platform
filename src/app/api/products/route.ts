/** `GET /api/products` (grid grammar) · `POST /api/products` (wizard create). M09. */
import { z } from "zod";
import { PRODUCT_READ_PERMISSIONS } from "@/lib/grid-defs/products/permissions";
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { parseGridQuery } from "@/server/query/grid-query";
import { aliasProductListParams } from "@/lib/grid-defs/products/list-query";
import { created, listResult } from "@/server/api/envelope";
import { domainCtx } from "@/server/repositories/platform-common";
import { listProducts } from "@/server/repositories/products";
import { createProductFromWizard } from "@/server/repositories/products-commands";
import type { ProductInput } from "@/lib/grid-defs/products/product-form";

export const GET = defineRoute({
  permission: PRODUCT_READ_PERMISSIONS,
  handler: ({ db, auth, searchParams }) => {
    const query = parseProductListQuery(searchParams);
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

function parseProductListQuery(searchParams: URLSearchParams) {
  const parsed = parseGridQuery(aliasProductListParams(searchParams));
  const first = parsed.issues[0];
  if (first) {
    const fieldErrors = Object.fromEntries(parsed.issues.map((i) => [i.param, [i.message]]));
    throw new AppError("VALIDATION", `Invalid query: ${first.param} — ${first.message}`, { fieldErrors });
  }
  return parsed.query;
}
