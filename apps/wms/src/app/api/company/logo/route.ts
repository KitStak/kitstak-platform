/**
 * `GET /api/company/logo` — the company logo (any signed-in user; shell and printouts).
 * `POST` multipart `file` — replace it (JPG/PNG < 2 MB, checked by magic bytes). `DELETE` — remove.
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { fileStore } from '@/server/files';
import { readUpload } from '@/server/repositories/platform-files';
import { readCompanyLogo, removeCompanyLogo, setCompanyLogo } from '@/server/repositories/company';
import { LOGO_MAX_BYTES } from '@/lib/grid-defs/admin/company';
import { withWriteTx } from '@/server/db/sql';

export const GET = defineRoute({
  handler: async ({ db }) => {
    const logo = await readCompanyLogo(db, fileStore());
    if (!logo) throw new AppError('NOT_FOUND', 'No company logo');
    return new NextResponse(new Uint8Array(logo.bytes), {
      headers: {
        'content-type': logo.mime,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  },
});

export const POST = defineRoute({
  permission: 'settings.company_settings.update',
  transaction: false,
  handler: async ({ db, auth, actor, request, audit }) => {
    const upload = await readUpload(request, LOGO_MAX_BYTES);
    const result = await withWriteTx(
      db,
      async (tx) => await setCompanyLogo(tx, fileStore(), auth, actor, upload),
    );
    await audit({
      action: 'company.update',
      entity: 'company',
      entityId: 'company',
      detail: { section: 'logo' },
    });
    return result;
  },
});

export const DELETE = defineRoute({
  permission: 'settings.company_settings.update',
  handler: async ({ db, auth, actor, audit }) => {
    const result = await removeCompanyLogo(db, fileStore(), auth, actor);
    await audit({
      action: 'company.update',
      entity: 'company',
      entityId: 'company',
      detail: { section: 'logo removed' },
    });
    return result;
  },
});
