/**
 * `/api/imports/[key]`
 *   GET  — import page definition + upload history (paged).
 *   POST — multipart `file` (+ `dryRun=true` for the validation preview). A real run
 *          applies valid rows in chunked transactions and returns the finished batch.
 */
import { defineRoute } from "@/server/api/define-route";
import { RATE_LIMITS } from "@/server/auth/rate-limit";
import { created, listResult, result } from "@/server/api/envelope";
import { validationError } from "@/server/api/errors";
import { MAX_UPLOAD_BYTES } from "@/server/files";
import { previewImport, runImport } from "@/server/imports";
import { readUpload } from "@/server/repositories/platform-files";
import {
  importHistoryQuerySchema, importKeyParamsSchema, importOverview, importUploadFieldsSchema, requireImport,
} from "@/server/repositories/platform-imports";

export const GET = defineRoute({
  params: importKeyParamsSchema,
  query: importHistoryQuerySchema,
  handler: async ({ db, auth, params, query }) => {
    const { definition, history, total } = await importOverview(db, auth, params.key, query);
    return listResult(history, { total, page: query.page, pageSize: query.ps, definition });
  },
});

export const POST = defineRoute({
  transaction: false,
  rateLimit: RATE_LIMITS.bulkIo,
  params: importKeyParamsSchema,
  handler: async ({ db, auth, params, request }) => {
    const def = requireImport(auth, params.key);
    const upload = await readUpload(request, MAX_UPLOAD_BYTES);
    const fields = importUploadFieldsSchema.safeParse(upload.fields);
    if (!fields.success) throw validationError("Invalid dryRun flag", { dryRun: ["Use true or false"] });
    const input = { def, auth, fileName: upload.fileName, bytes: upload.bytes };
    if (fields.data.dryRun) return result(await previewImport(input, db));
    return created(await runImport(db, input));
  },
});
