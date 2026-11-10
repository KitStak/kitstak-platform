/** `GET /api/products/[id]` (detail, or `?view=form` for the edit wizard) · `PATCH` (wizard edit). M09. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { notFoundError } from "@/server/api/errors";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { updateProductFromWizard } from "@/server/repositories/products-commands";
import { getProductDetail, getProductForm } from "@/server/repositories/products-detail";
import type { ProductInput } from "@/lib/grid-defs/products/product-form";

export const GET = defineRoute({
  permission: "settings.products.view",
  params: idParamsSchema,
  query: z.object({ view: z.enum(["detail", "form"]).default("detail") }),
  handler: ({ db, auth, params, query }) => {
    const data = query.view === "form" ? getProductForm(db, auth.scope, params.id) : getProductDetail(db, auth.scope, auth.viewScope, params.id);
    if (!data) throw notFoundError("Product");
    return data;
  },
});

export const PATCH = defineRoute({
  permission: "settings.products.edit",
  params: idParamsSchema,
  body: z.record(z.string(), z.unknown()),
  handler: ({ db, auth, actor, params, body }) => {
    const row = updateProductFromWizard(db, { ...domainCtx(actor, auth), scope: auth.scope }, params.id, body as ProductInput);
    return { id: row.id, sku: row.sku, version: row.version };
  },
});
