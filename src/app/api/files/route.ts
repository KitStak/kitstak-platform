/**
 * `POST /api/files` — multipart upload (`file`, optional `ownerEntityType` + `ownerEntityId`).
 * Images and PDFs up to 10 MB; an owner record must be editable by the caller.
 */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { fileStore } from "@/server/files";
import { readUpload, storeUpload } from "@/server/repositories/platform-files";

export const POST = defineRoute({
  transaction: false,
  handler: async ({ db, auth, request }) => {
    const upload = await readUpload(request);
    return created(db.transaction((tx) => storeUpload(tx, fileStore(), auth, upload)));
  },
});
