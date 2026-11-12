/**
 * Import handler "user-roles" (owner M14). Import User-Role — assigns or unassigns one role of an existing user (by email). A user always keeps at least one role.
 * Goes through `updateUser` (scope, admin rules, session revoke, change log); see
 * `repositories/users-import.ts`.
 */
import { importUserLinkRow } from "@/server/repositories/users-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M14",
  apply: async ({ db, auth, actor }, row) => await importUserLinkRow(db, auth, actor, "role", row),
};
