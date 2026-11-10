/** `POST /api/printouts/preview` `{ typeKey, layout, sampleIds }` — live designer preview (PDF bytes, inline). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { layoutSchema } from "@/lib/grid-defs/admin/printouts";
import { idSchema } from "@/server/repositories/platform-common";
import { previewPdf } from "@/server/repositories/printouts";

const PREVIEW_LIMIT = { name: "printout-preview", limit: 90, windowMs: 60_000 } as const;

export const POST = defineRoute({
  permission: ["settings.printouts_labels.create", "settings.printouts_labels.edit", "settings.printouts_labels.view"],
  body: z.object({ typeKey: z.string().min(1).max(80), layout: layoutSchema, sampleIds: z.array(idSchema).max(5).default([]) }),
  rateLimit: PREVIEW_LIMIT,
  transaction: false,
  handler: async ({ db, auth, body }) => {
    const bytes = await previewPdf(db, auth, body.typeKey, body.layout, body.sampleIds);
    return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
  },
});
