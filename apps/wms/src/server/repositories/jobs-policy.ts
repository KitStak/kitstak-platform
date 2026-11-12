/**
 * Server side of the M03 supervisor-only rule (src/lib/grid-defs/jobs/supervisor-policy.ts):
 * the plain permission check plus "floor-only users never get supervisor-only keys".
 */
import { forbiddenError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { can } from "@/server/auth/permissions";
import { allowsJobAction } from "@/lib/grid-defs/jobs/supervisor-policy";

export function canJobAction(auth: AuthContext, key: string): boolean {
  return allowsJobAction(key, can(auth, key), auth.roleKeys, auth.user.role);
}

/** Throws 403 (same envelope as a missing permission) when the user may not run the action. */
export function assertJobAction(auth: AuthContext, key: string): void {
  if (!canJobAction(auth, key)) throw forbiddenError();
}
