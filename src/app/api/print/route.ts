/**
 * `POST /api/print` `{ typeKey, records, options, ownerEntityType?, ownerEntityId? }` —
 * renders a printout (PDF or ZPL) to a 7-day file and returns its id and download URL.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { printRequestSchema, printToFile } from "@/server/print";
import { idSchema } from "@/server/repositories/platform-common";
import { requireEntity } from "@/server/repositories/platform-entities";

const bodySchema = printRequestSchema.extend({
  ownerEntityType: z.string().max(40).optional(),
  ownerEntityId: idSchema.optional(),
}).refine((b) => (b.ownerEntityType === undefined) === (b.ownerEntityId === undefined), {
  message: "Send both ownerEntityType and ownerEntityId",
  path: ["ownerEntityId"],
});

export const POST = defineRoute({
  transaction: false,
  body: bodySchema,
  handler: async ({ db, auth, body }) => {
    const { ownerEntityType, ownerEntityId, ...request } = body;
    if (ownerEntityType && ownerEntityId) await requireEntity(db, auth, ownerEntityType, ownerEntityId, "view");
    const file = await printToFile(db, { request, userId: auth.user.id, ownerEntityType, ownerEntityId });
    return created({ fileId: file.id, name: file.name, mime: file.mime, size: file.size, url: `/api/files/${file.id}?inline=1` });
  },
});
