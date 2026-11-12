/**
 * `GET /api/company/mail` — Email delivery settings (the SMTP password is never returned).
 * `PUT` — save them (optimistic `version`, field-level change log).
 */
import { defineRoute } from '@/server/api/define-route';
import { mailSettingsSchema } from '@/lib/grid-defs/admin/company-mail';
import { getMailSettings, updateMailSettings } from '@/server/repositories/company-mail';

export const GET = defineRoute({
  permission: 'settings.company_settings.view',
  handler: async ({ db }) => await getMailSettings(db),
});

export const PUT = defineRoute({
  permission: 'settings.company_settings.update',
  body: mailSettingsSchema,
  handler: async ({ db, auth, actor, body, audit }) => {
    const result = await updateMailSettings(db, auth, actor, body);
    await audit({
      action: 'company.mail',
      entity: 'company',
      entityId: 'company',
      detail: {
        transport: body.transport,
        host: body.host || null,
        passwordChanged: Boolean(body.password?.trim()) || Boolean(body.clearPassword),
      },
    });
    return result;
  },
});
