/** `GET /api/users` — Users grid (grid grammar). `POST` — Add User (4-step wizard). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { log } from "@/server/log";
import { createUser, listUsers, parseUserSave } from "@/server/repositories/users";
import { sendUserInvite } from "@/server/repositories/users-invite";

export const GET = defineRoute({
  permission: "settings.users.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listUsers(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.users.create",
  // Parsed in the handler so the company password policy reports with every other field error.
  body: z.unknown(),
  transaction: false,
  handler: async ({ db, auth, actor, body: raw, request, audit }) => {
    const body = parseUserSave(db, "create", raw);
    const user = db.transaction((tx) => createUser(tx, auth, actor, body));
    audit({ action: "user.create", entity: "user", entityId: user.id, detail: { email: user.email, roles: body.roleIds.length, warehouses: body.warehouseIds.length } });
    // Dedicated invite (own template, 72 h link) via the company mail transport. The response
    // says what really happened so the toast never claims an email that wasn't sent.
    const welcomeRequested = Boolean(body.sendWelcomeEmail && body.isActive);
    let welcome: { transport: "smtp" | "log" | null; delivered: boolean; error: string | null } = { transport: null, delivered: false, error: null };
    if (welcomeRequested) {
      try {
        const r = await sendUserInvite(db, { userId: user.id, baseUrl: request.nextUrl.origin, invitedBy: auth.user.name });
        welcome = { transport: r.transport, delivered: r.delivered, error: null };
        audit({ action: "user.invite_sent", entity: "user", entityId: user.id, detail: { email: user.email, delivery: r.delivered ? "smtp" : "server log only", linkExpires: r.expiresAt } });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown error";
        welcome = { transport: null, delivered: false, error: message };
        audit({ action: "user.invite_sent", entity: "user", entityId: user.id, outcome: "failure", detail: { email: user.email, error: message } });
        log.warn("welcome email failed", { component: "users", userId: user.id, err: error });
      }
    }
    return created({ ...user, welcomeRequested, welcomeSent: welcome.delivered, welcomeTransport: welcome.transport, welcomeError: welcome.error });
  },
});
