/** `POST /api/company/mail/test` `{ to }` — sends a test email with the saved delivery settings. */
import { defineRoute } from "@/server/api/define-route";
import { mailTestSchema } from "@/lib/grid-defs/admin/company-mail";
import { sendCompanyMail } from "@/server/repositories/company-mail";

const TEST_LIMIT = { name: "company-mail-test", limit: 10, windowMs: 15 * 60_000 } as const;

export const POST = defineRoute({
  permission: "settings.company_settings.update",
  body: mailTestSchema,
  rateLimit: TEST_LIMIT,
  transaction: false,
  handler: async ({ db, auth, body, audit }) => {
    try {
      const result = await sendCompanyMail(db, {
        to: body.to,
        subject: "KitStaks test email",
        text: `This is a test email sent by ${auth.user.name} from Company Settings › Email delivery.\nIf you can read it, KitStaks can send invites and password reset emails.`,
      });
      audit({ action: "company.mail_test", entity: "company", entityId: "company", detail: { to: body.to, delivery: result.delivered ? "smtp" : "server log only" } });
      return result;
    } catch (error: unknown) {
      audit({ action: "company.mail_test", entity: "company", entityId: "company", outcome: "failure", detail: { to: body.to, error: error instanceof Error ? error.message : "failed" } });
      throw error;
    }
  },
});
