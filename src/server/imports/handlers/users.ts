/**
 * Import handler "users" (owner M14) — Bulk Import Users. Creates a user with a role, default
 * warehouse and all-client access, or updates an existing email (name, type, status, adds the
 * role / warehouse). Rules and change log come from the Users repository; see
 * `repositories/users-import.ts`.
 */
import { importUserRow } from "@/server/repositories/users-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M14",
  apply: async ({ db, auth, actor }, row) => await importUserRow(db, auth, actor, row),
};
