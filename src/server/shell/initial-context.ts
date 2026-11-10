/**
 * Header working-context label resolved during SSR from the session + context cookies,
 * so the shell never shows a skeleton where the warehouse name belongs while
 * `GET /api/me` is still loading.
 */
import { eq } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { clients, warehouses } from "@/server/db/schema";
import { contextLabel, type InitialShellContext } from "@/lib/context-label";

export type { InitialShellContext } from "@/lib/context-label";

export function loadInitialShellContext(db: AppDb, auth: AuthContext): InitialShellContext {
  const { warehouseId, clientId } = auth.context;
  const warehouse = warehouseId
    ? db.select({ code: warehouses.code, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, warehouseId)).get() ?? null
    : null;
  const client = clientId ? db.select({ code: clients.code, name: clients.name }).from(clients).where(eq(clients.id, clientId)).get() ?? null : null;
  const manyWarehouses = auth.scope.warehouseIds.length > 1;
  const manyClients = auth.scope.clientIds === "all" || auth.scope.clientIds.length > 1;
  return { ...contextLabel({ warehouse, client }), visible: manyWarehouses || manyClients };
}
