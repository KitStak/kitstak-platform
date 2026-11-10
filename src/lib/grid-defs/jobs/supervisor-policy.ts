/**
 * Supervisor-only job / task actions (critic R4 major, foundation request R4-1).
 *
 * Logiwa keeps priority changes, job cancel, assignment and task cancel away from floor users.
 * The seeded Warehouse Clerk role (`operator`) still holds these keys in `role_permissions`, so
 * M03 enforces the rule itself: a user whose only roles are floor roles is denied these exact keys,
 * on the API (403) and in the UI (disabled with a reason). A user with any other role (Supervisor,
 * Admin or a custom role that grants the key) keeps the normal `can()` result.
 *
 * Pure module: shared by the API routes and the client components.
 */

export const SUPERVISOR_ONLY_KEYS: ReadonlySet<string> = new Set([
  "fulfillment.job_management.update_priority",
  "fulfillment.job_management.cancel",
  "fulfillment.job_management.assign",
  "fulfillment.job_management.unassign",
  "fulfillment.job_management.override_job_cancel_warning",
  "fulfillment.task_details.cancel_task",
]);

/** System role keys that are floor (execution-only) roles. */
const FLOOR_ROLE_KEYS: ReadonlySet<string> = new Set(["operator"]);

/** True when every role the user holds is a floor role (legacy role used when no role is assigned). */
export function isFloorOnly(roleKeys: readonly string[] | null | undefined, legacyRole: string | null | undefined): boolean {
  const keys = roleKeys ?? [];
  if (keys.length > 0) return keys.every((k) => FLOOR_ROLE_KEYS.has(k));
  return legacyRole ? FLOOR_ROLE_KEYS.has(legacyRole) : false;
}

/** `granted` is the plain permission check; floor-only users never get supervisor-only keys. */
export function allowsJobAction(key: string, granted: boolean, roleKeys: readonly string[] | null | undefined, legacyRole: string | null | undefined): boolean {
  if (!granted) return false;
  return !(SUPERVISOR_ONLY_KEYS.has(key) && isFloorOnly(roleKeys, legacyRole));
}
