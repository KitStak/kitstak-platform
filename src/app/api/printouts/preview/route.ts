/**
 * `POST /api/printouts/preview` `{ typeKey, layout, sampleIds, format? }` — live designer preview.
 * `format: "pdf"` (default) returns PDF bytes inline; `format: "zpl"` returns the ZPL II text a
 * Zebra label printer receives (label types only); `format: "record"` returns the preview records
 * and branding as JSON for the in-browser canvas.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { familyOf, layoutSchema } from "@/lib/grid-defs/admin/printouts";
import { idSchema } from "@/server/repositories/platform-common";
import { previewPdf, previewRecords, previewZpl } from "@/server/repositories/printouts";

const PREVIEW_LIMIT = { name: "printout-preview", limit: 90, windowMs: 60_000 } as const;

export const POST = defineRoute({
  permission: ["settings.printouts_labels.create", "settings.printouts_labels.edit", "settings.printouts_labels.view"],
  body: z.object({ typeKey: z.string().min(1).max(80), layout: layoutSchema, sampleIds: z.array(idSchema).max(5).default([]), format: z.enum(["pdf", "zpl", "record"]).default("pdf"), copies: z.number().int().min(1).max(20).default(1) }),
  rateLimit: PREVIEW_LIMIT,
  transaction: false,
  handler: async ({ db, auth, body }) => {
    if (body.format === "record") return previewRecords(db, auth, body.typeKey, body.sampleIds);
    if (body.format === "zpl") {
      if (familyOf(body.typeKey) !== "label") throw new AppError("VALIDATION", "ZPL is only available for label printouts");
      const zpl = previewZpl(db, auth, body.typeKey, body.layout, body.sampleIds, body.copies);
      return new NextResponse(zpl, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    }
    const bytes = await previewPdf(db, auth, body.typeKey, body.layout, body.sampleIds);
    return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
  },
});
