/**
 * Print rendering entry point (BUILD_PLAN F6 `print/render.ts`):
 * `{ typeKey, records, options }` -> PDF (pdf-lib) or ZPL bytes. `printToFile` stores the
 * result for `POST /api/print`, which returns the file id.
 *
 * Types without a renderer yet throw INVALID_STATE ("not configured yet"); no fake output.
 */
import type { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { AppError, fromZodError, notFoundError } from "@/server/api/errors";
import { fileStore, type FileRecord, type FileStore } from "@/server/files/files";
import { getPrintType, type PrintTypeDef } from "./catalog";
import { locationLabelTemplate, lpLabelTemplate, mobileCartLabelTemplate, productLabelTemplate } from "./templates/barcode-label";
import { manifestBolTemplate } from "./templates/manifest-bol";
import { packingSlipTemplate } from "./templates/packing-slip";
import { pickListTemplate } from "./templates/pick-list";
import { poBillingChargesTemplate, purchaseOrderTemplate } from "./templates/purchase-order";
import { shippingLabelTemplate } from "./templates/shipping-label";
import { printRequestSchema, type PrintOutput, type PrintRequest, type PrintTemplate, type RenderContext } from "./types";

interface AnyTemplate {
  readonly recordSchema: z.ZodType;
  render(records: readonly unknown[], ctx: RenderContext): Promise<PrintOutput>;
}

/** Erases the record type: records are validated by the template's own schema first. */
const erase = <R>(template: PrintTemplate<R>): AnyTemplate => ({
  recordSchema: template.recordSchema,
  render: (records, ctx) => template.render(records as readonly R[], ctx),
});

const TEMPLATES: ReadonlyMap<string, AnyTemplate> = new Map<string, AnyTemplate>([
  ["packing-list", erase(packingSlipTemplate)],
  ["packing-slip", erase(packingSlipTemplate)],
  ["picking-list", erase(pickListTemplate)],
  ["consolidated-picking-list", erase(pickListTemplate)],
  ["work-order-picking-list", erase(pickListTemplate)],
  ["work-order-consolidated-picking-list", erase(pickListTemplate)],
  ["manifest-bol", erase(manifestBolTemplate)],
  ["lp-label", erase(lpLabelTemplate)],
  ["location-label", erase(locationLabelTemplate)],
  ["product-label", erase(productLabelTemplate)],
  ["mobile-cart-label", erase(mobileCartLabelTemplate)],
  ["shipping-label", erase(shippingLabelTemplate)],
  ["purchase-order-list", erase(purchaseOrderTemplate)],
  ["po-billing-charges", erase(poBillingChargesTemplate)],
]);

export function hasRenderer(typeKey: string): boolean {
  return TEMPLATES.has(typeKey);
}

function resolve(typeKey: string): { readonly def: PrintTypeDef; readonly template: AnyTemplate } {
  const def = getPrintType(typeKey);
  if (!def) throw new AppError("VALIDATION", `Unknown printout type "${typeKey}"`, { fieldErrors: { typeKey: ["Unknown printout type"] } });
  const template = TEMPLATES.get(typeKey);
  if (!template || !def.renderer) throw new AppError("INVALID_STATE", `The ${def.name} printout is not configured yet`);
  return { def, template };
}

export async function renderPrint(request: PrintRequest, now: Date = new Date()): Promise<PrintOutput> {
  const parsed = printRequestSchema.safeParse(request);
  if (!parsed.success) throw fromZodError(parsed.error, "Invalid print request");
  const { typeKey, records, options } = parsed.data;
  const { def, template } = resolve(typeKey);
  const format = options.format ?? def.formats[0] ?? "pdf";
  if (!def.formats.includes(format)) {
    throw new AppError("VALIDATION", `${def.name} cannot be printed as ${format.toUpperCase()}`, { fieldErrors: { "options.format": [`Use ${def.formats.join(" or ")}`] } });
  }
  const validated = records.map((record, index) => {
    const result = template.recordSchema.safeParse(record);
    if (!result.success) throw fromZodError(result.error, `Record ${index + 1} is invalid`);
    return result.data;
  });
  return template.render(validated, { typeKey, typeName: def.name, format, options, now });
}

export interface PrintToFileInput {
  readonly request: PrintRequest;
  readonly userId: string;
  readonly ownerEntityType?: string | null;
  readonly ownerEntityId?: string | null;
  readonly store?: FileStore;
  readonly now?: Date;
}

export function printFileName(typeName: string, now: Date, extension: string): string {
  return `${typeName} ${now.toISOString().slice(0, 16).replace("T", " ").replace(":", "")}.${extension}`;
}

/** Renders and stores a printout (expires after 7 days). */
export async function printToFile(db: AppDb, input: PrintToFileInput): Promise<FileRecord> {
  const now = input.now ?? new Date();
  const output = await renderPrint(input.request, now);
  const def = getPrintType(input.request.typeKey);
  if (!def) throw notFoundError("Printout type");
  return (input.store ?? fileStore()).store(db, {
    name: printFileName(def.name, now, output.extension),
    bytes: output.bytes,
    purpose: "print",
    uploadedBy: input.userId,
    ownerEntityType: input.ownerEntityType ?? null,
    ownerEntityId: input.ownerEntityId ?? null,
  });
}
