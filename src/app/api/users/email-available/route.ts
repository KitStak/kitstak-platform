/**
 * `POST /api/users/email-available` `{ email, exceptId? }` — live uniqueness check for the
 * Add/Edit user wizard (step 1). Returns `{ available }` only, never which user owns the
 * address. POST (not GET) keeps email addresses out of URLs and access logs. Read-only.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { isEmailTaken } from "@/server/repositories/users";

export const POST = defineRoute({
  permission: ["settings.users.create", "settings.users.edit"],
  body: z.object({ email: z.string().trim().min(3).max(254), exceptId: z.string().max(64).optional() }),
  handler: ({ db, body }) => ({ available: !isEmailTaken(db, body.email, body.exceptId) }),
});
