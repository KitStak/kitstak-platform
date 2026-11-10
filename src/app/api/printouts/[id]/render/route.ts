/**
 * `POST /api/printouts/[id]/render` `{ orderIds }` — prints real records with this template's
 * saved layout (PDF, inline). Used by template-aware printing (REQ-1) and the list "Preview".
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema, idSchema } from "@/server/repositories/platform-common";
import { getPrintout, previewPdf } from "@/server/repositories/printouts";

export const POST = defineRoute({
  params: idParamsSchema,
  body: z.object({ orderIds: z.array(idSchema).max(200).default([]) }),
  transaction: false,
  handler: async ({ db, auth, params, body }) => {
    const t = getPrintout(db, params.id);
    const bytes = await previewPdf(db, auth, t.typeKey, t.layout, body.orderIds);
    return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${t.name.replace(/[^A-Za-z0-9 _-]/g, "")}.pdf"` } });
  },
});
