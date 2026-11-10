/**
 * Import handler "user-warehouses" (owner M14). Assign/Unassign User-Warehouse — gives or removes access to one warehouse (caller scope only). A user always keeps one warehouse.
 * Goes through `updateUser` (scope, admin rules, session revoke, change log); see
 * `repositories/users-import.ts`.
 */
import { importUserLinkRow } from "@/server/repositories/users-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M14",
  apply: ({ db, auth, actor }, row) => importUserLinkRow(db, auth, actor, "warehouse", row),
};
