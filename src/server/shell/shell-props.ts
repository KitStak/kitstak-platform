/**
 * Props for the authenticated AppShell, resolved from the session cookie. Shared by the
 * (app) layout (which redirects when signed out) and the root 404 (which falls back to
 * a branded frame), so both render the identical shell.
 */
import type { InitialShellContext } from "@/lib/context-label";
import { getAppDb } from "@/server/api/db";
import { getAuthContext } from "@/server/auth/context";
import { loadInitialShellContext } from "./initial-context";

export interface ShellProps {
  readonly user: { readonly id: string; readonly name: string; readonly email: string; readonly role: string };
  readonly permissions: readonly string[];
  readonly initialContext: InitialShellContext | null;
}

/** Null when there is no valid session. */
export async function loadShellProps(): Promise<ShellProps | null> {
  const auth = await getAuthContext();
  if (!auth) return null;
  const user = { id: auth.user.id, name: auth.user.name, email: auth.user.email, role: auth.user.role };
  const initialContext = loadInitialShellContext(await getAppDb(), auth);
  return { user, permissions: [...auth.permissions].sort(), initialContext };
}
