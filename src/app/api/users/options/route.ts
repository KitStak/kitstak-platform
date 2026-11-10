/** `GET /api/users/options` — roles, warehouses (caller scope), clients and users for the user wizard and filters. */
import { asc } from "drizzle-orm";
import { defineRoute } from "@/server/api/define-route";
import * as s from "@/server/db/schema";

export const GET = defineRoute({
  permission: ["settings.users.view", "settings.roles.view", "settings.printouts_labels.view", "settings.screen_configuration.view"],
  handler: ({ db, auth }) => {
    const roles = db.select({ id: s.roles.id, key: s.roles.key, name: s.roles.name, category: s.roles.category, description: s.roles.description, isSystem: s.roles.isSystem }).from(s.roles).orderBy(asc(s.roles.name)).all();
    const warehouses = db.select({ id: s.warehouses.id, code: s.warehouses.code, name: s.warehouses.name }).from(s.warehouses).orderBy(asc(s.warehouses.code)).all()
      .filter((w) => auth.scope.warehouseIds.includes(w.id));
    const clients = db.select({ id: s.clients.id, code: s.clients.code, name: s.clients.name }).from(s.clients).orderBy(asc(s.clients.name)).all()
      .filter((c) => auth.scope.clientIds === "all" || auth.scope.clientIds.includes(c.id));
    const users = db.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.users).orderBy(asc(s.users.name)).all();
    return { roles: roles.map((r) => ({ ...r, isSystem: Boolean(r.isSystem) })), warehouses, clients, users };
  },
});
