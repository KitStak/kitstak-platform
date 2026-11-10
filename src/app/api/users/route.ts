/** `GET /api/users` — Users grid (grid grammar). `POST` — Add User (4-step wizard). */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { requestPasswordReset } from "@/server/auth/password-reset";
import { log } from "@/server/log";
import { userCreateSchema } from "@/lib/grid-defs/admin/users";
import { createUser, listUsers } from "@/server/repositories/users";

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
  body: userCreateSchema,
  transaction: false,
  handler: async ({ db, auth, actor, body, request, ip, audit }) => {
    const user = db.transaction((tx) => createUser(tx, auth, actor, body));
    audit({ action: "user.create", entity: "user", entityId: user.id, detail: { email: user.email, roles: body.roleIds.length, warehouses: body.warehouseIds.length } });
    let welcomeSent = false;
    if (body.sendWelcomeEmail && body.isActive) {
      try {
        await requestPasswordReset(db, { email: user.email, baseUrl: request.nextUrl.origin, ip });
        welcomeSent = true;
      } catch (error: unknown) {
        log.warn("welcome email failed", { component: "users", userId: user.id, err: error });
      }
    }
    return created({ ...user, welcomeSent });
  },
});
