/** `GET /api/imports/[key]/template` — xlsx template (example row + Notes sheet). */
import { defineRoute } from '@/server/api/define-route';
import { buildImportTemplate, templateFileName } from '@/server/imports';
import { contentDisposition } from '@/server/repositories/platform-files';
import { importKeyParamsSchema, requireImport } from '@/server/repositories/platform-imports';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const GET = defineRoute({
  params: importKeyParamsSchema,
  handler: async ({ auth, params }) => {
    const def = requireImport(auth, params.key);
    const bytes = await buildImportTemplate(def);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': XLSX_MIME,
        'content-length': String(bytes.length),
        'content-disposition': contentDisposition(templateFileName(def), false),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  },
});
