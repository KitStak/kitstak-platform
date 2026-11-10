/**
 * Minimal product creation (BUILD_PLAN F5 `products.ts`): used by imports and channel
 * downloads ("Create Nonexistent Products"). M09 owns the full wizard and API on top.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { PRODUCT_CATEGORIES } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { recordCreate } from "./change-log";
import { DomainError } from "./errors";
import { checkScope, type DomainCtx, type Tx } from "./types";

export type ProductRow = typeof schema.products.$inferSelect;

export const createProductSchema = z.object({
  clientId: z.string().min(1),
  sku: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(300),
  barcode: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).default("General"),
  productCategory: z.enum(PRODUCT_CATEGORIES).default("Product"),
  uom: z.string().trim().min(1).max(50).default("Each"),
  weightOz: z.number().min(0).default(0),
  lengthIn: z.number().min(0).default(0),
  widthIn: z.number().min(0).default(0),
  heightIn: z.number().min(0).default(0),
  price: z.number().min(0).default(0),
  purchasePrice: z.number().min(0).default(0),
  description: z.string().max(4000).nullish(),
  imageUrl: z.url().nullish(),
  trackLot: z.boolean().default(false),
  trackExpiry: z.boolean().default(false),
  trackSerial: z.boolean().default(false),
});
export type CreateProductInput = z.input<typeof createProductSchema>;

export function createProduct(tx: Tx, ctx: DomainCtx, raw: CreateProductInput): ProductRow {
  const input = createProductSchema.parse(raw);
  checkScope(ctx, { clientId: input.clientId }, "Client");
  const client = tx.select().from(schema.clients).where(eq(schema.clients.id, input.clientId)).get();
  if (!client) throw new DomainError("VALIDATION", "Client not found");
  const dup = tx.select({ id: schema.products.id }).from(schema.products)
    .where(and(eq(schema.products.clientId, input.clientId), eq(schema.products.sku, input.sku))).get();
  if (dup) throw new DomainError("DUPLICATE", `SKU ${input.sku} already exists for client ${client.code}.`);
  const barcode = input.barcode && input.barcode.length > 0 ? input.barcode : input.sku;
  const product = tx.insert(schema.products).values({
    ...input, barcode, status: "Active", isKit: input.productCategory === "Kit", createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  const pack = tx.insert(schema.productPackTypes).values({
    productId: product.id, packType: input.uom, kind: "Primary", uomQty: 1, length: input.lengthIn, width: input.widthIn,
    height: input.heightIn, weight: input.weightOz / 16, weightUnit: "Pound", createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning({ id: schema.productPackTypes.id }).get();
  tx.insert(schema.productBarcodes).values({ productId: product.id, packTypeId: pack.id, barcode }).run();
  recordCreate(tx, ctx, { entityType: "product", entityId: product.id, entityCode: product.sku });
  return product;
}

/** Finds the client's product by seller SKU, creating it when missing. */
export function ensureProductForListing(
  tx: Tx, ctx: DomainCtx,
  input: { clientId: string; sellerSku: string; name: string; price?: number; barcode?: string; weightOz?: number },
): { product: ProductRow; created: boolean } {
  const existing = tx.select().from(schema.products)
    .where(and(eq(schema.products.clientId, input.clientId), eq(schema.products.sku, input.sellerSku.trim()))).get();
  if (existing) return { product: existing, created: false };
  const product = createProduct(tx, ctx, {
    clientId: input.clientId, sku: input.sellerSku, name: input.name, price: input.price ?? 0, barcode: input.barcode, weightOz: input.weightOz ?? 0,
  });
  return { product, created: true };
}
