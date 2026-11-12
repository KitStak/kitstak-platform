/** `GET /api/jobs/print?doc=<pick-list|job-content|pick-short|cart-layout|packing-list>&ids=a,b` — PDF. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { forbiddenError } from '@/server/api/errors';
import { can } from '@/server/auth/permissions';
import { JOB_PERMISSIONS } from '@/server/repositories/jobs';
import {
  JOB_PRINT_DOCS,
  JOB_PRINT_TITLES,
  renderJobsPdf,
  type JobPrintDoc,
} from '@/server/repositories/jobs-print';

const PERMISSION: Readonly<Record<JobPrintDoc, string>> = {
  'pick-list': JOB_PERMISSIONS.pickList,
  'job-content': JOB_PERMISSIONS.content,
  'pick-short': JOB_PERMISSIONS.pickShort,
  'cart-layout': JOB_PERMISSIONS.cartLayout,
  'packing-list': JOB_PERMISSIONS.packingList,
};

export const GET = defineRoute({
  permission: Object.values(PERMISSION),
  query: z.object({
    doc: z.enum(JOB_PRINT_DOCS),
    ids: z
      .string()
      .min(1)
      .transform((s) =>
        s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().max(64)).min(1).max(200)),
  }),
  handler: async ({ db, auth, query }) => {
    if (!can(auth, PERMISSION[query.doc])) throw forbiddenError();
    const bytes = await renderJobsPdf(db, auth, query.doc, query.ids);
    return new Response(Buffer.from(bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${JOB_PRINT_TITLES[query.doc].replace(/\s+/g, '-')}.pdf"`,
      },
    });
  },
});
