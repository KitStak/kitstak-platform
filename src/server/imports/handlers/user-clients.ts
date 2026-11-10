/**
 * Import handler "user-clients" (owner M14). Assign/Unassign User-Client — gives or removes access to one client; switches the user to Select manually.
 * Goes through `updateUser` (scope, admin rules, session revoke, change log); see
 * `repositories/users-import.ts`.
 */
import { importUserLinkRow } from "@/server/repositories/users-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M14",
  apply: ({ db, auth, actor }, row) => importUserLinkRow(db, auth, actor, "client", row),
};
