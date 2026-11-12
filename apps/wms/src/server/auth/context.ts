/**
 * AuthContext = session user + effective permissions + restrictions + data scope.
 * Built once per request by `defineRoute`, `/api/me` and server components.
 */
import { cookies } from 'next/headers';
import { getAppDb, type AppDb } from '@/server/api/db';
import { loadPermissions, type PermissionGrant } from './permissions';
import { CONTEXT_CLIENT_COOKIE, CONTEXT_WAREHOUSE_COOKIE, getScope, narrowScope, type Scope } from './scope';
import { getSessionUser, type SessionUser } from './session';

export interface AuthContext extends PermissionGrant {
  readonly user: SessionUser;
  /** Full entitlement. Use for authorization (404 on cross-scope). */
  readonly scope: Scope;
  /** Scope narrowed by the header context switcher. Use for default list filtering. */
  readonly viewScope: Scope;
  readonly context: { readonly warehouseId: string | null; readonly clientId: string | null };
}

export interface ContextSelection {
  readonly warehouseId?: string | null;
  readonly clientId?: string | null;
}

export async function buildAuthContext(
  db: AppDb,
  user: SessionUser,
  selection: ContextSelection = {},
): Promise<AuthContext> {
  const grant = await loadPermissions(db, user);
  const scope = await getScope(db, user);
  const viewScope = narrowScope(scope, selection.warehouseId, selection.clientId);
  const warehouseId =
    viewScope.warehouseIds.length === 1 && selection.warehouseId === viewScope.warehouseIds[0]
      ? selection.warehouseId
      : null;
  const clientId =
    Array.isArray(viewScope.clientIds) &&
    selection.clientId &&
    viewScope.clientIds.length === 1 &&
    viewScope.clientIds[0] === selection.clientId
      ? selection.clientId
      : null;
  return { ...grant, user, scope, viewScope, context: { warehouseId: warehouseId ?? null, clientId } };
}

/** Server components: the signed-in user's AuthContext, or null. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const store = await cookies();
  return await buildAuthContext(await getAppDb(), user, {
    warehouseId: store.get(CONTEXT_WAREHOUSE_COOKIE)?.value ?? null,
    clientId: store.get(CONTEXT_CLIENT_COOKIE)?.value ?? null,
  });
}
