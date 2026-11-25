/** `POST /api/company/mail/test` `{ to }` — sends a test email with the saved delivery settings. */
import { defineRoute } from '@/server/api/define-route';
import { mailTestSchema } from '@/lib/grid-defs/admin/company-mail';
import { sendCompanyMail } from '@/server/repositories/company-mail';
import { mailTestEmail } from '@/server/mail/templates';
import { renderText } from '@kitstak/mail/layout';

const TEST_LIMIT = { name: 'company-mail-test', limit: 10, windowMs: 15 * 60_000 } as const;

export const POST = defineRoute({
  permission: 'settings.company_settings.update',
  body: mailTestSchema,
  rateLimit: TEST_LIMIT,
  transaction: false,
  handler: async ({ db, auth, body, audit }) => {
    try {
      const content = mailTestEmail({ sentBy: auth.user.name });
      const result = await sendCompanyMail(db, {
        to: body.to,
        subject: content.subject,
        text: renderText(content),
        content,
      });
      await audit({
        action: 'company.mail_test',
        entity: 'company',
        entityId: 'company',
        detail: { to: body.to, delivery: result.delivered ? result.transport : 'server log only' },
      });
      return result;
    } catch (error: unknown) {
      await audit({
        action: 'company.mail_test',
        entity: 'company',
        entityId: 'company',
        outcome: 'failure',
        detail: { to: body.to, error: error instanceof Error ? error.message : 'failed' },
      });
      throw error;
    }
  },
});
