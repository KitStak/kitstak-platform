/**
 * `POST /api/account/feedback` `{ type, message, page, rating }` — Help panel › Feedback & Updates.
 * Any signed-in user. Stored in the audit log (`feedback.submitted`, visible in Settings › Audit)
 * and sent to administrators as an in-app notification. Rate limited per user.
 */
import { defineRoute } from "@/server/api/define-route";
import { notify } from "@/server/domain/notify";
import { FEEDBACK_TYPE_LABELS, feedbackSchema } from "@/lib/grid-defs/admin/account";

const FEEDBACK_LIMIT = { name: "account-feedback", limit: 10, windowMs: 60 * 60_000 } as const;

export const POST = defineRoute({
  body: feedbackSchema,
  rateLimit: FEEDBACK_LIMIT,
  handler: async ({ db, auth, body, audit }) => {
    await audit({ action: "feedback.submitted", entity: "feedback", entityId: auth.user.id, detail: { type: body.type, page: body.page, rating: body.rating, message: body.message } });
    const who = auth.user.name || auth.user.email;
    const notified = await notify(db, { roleKey: "admin" }, {
      kind: "feedback.submitted",
      title: `New feedback from ${who}: ${FEEDBACK_TYPE_LABELS[body.type]}`,
      body: `${body.message.slice(0, 280)}${body.message.length > 280 ? "…" : ""} (on ${body.page})`,
      href: "/settings/audit",
      severity: body.type === "problem" ? "warning" : "info",
    });
    return { received: true, notified };
  },
});
