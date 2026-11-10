"use client";

import * as React from "react";
import type { InitialShellContext } from "@/lib/context-label";

export interface ShellUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
}

export interface ShellContextValue {
  readonly user: ShellUser | null;
  /**
   * Effective permission keys resolved on the server for this request. `null` outside the
   * authenticated shell (tests, public pages): every nav item is then shown.
   */
  readonly permissions: ReadonlySet<string> | null;
  /** Working-context label resolved during SSR (shown until `/api/me` loads). */
  readonly initialContext: InitialShellContext | null;
}

const ShellContext = React.createContext<ShellContextValue>({ user: null, permissions: null, initialContext: null });

export function ShellProvider({ user, permissions, initialContext = null, children }: { readonly user: ShellUser; readonly permissions: readonly string[]; readonly initialContext?: InitialShellContext | null; readonly children: React.ReactNode }) {
  const value = React.useMemo<ShellContextValue>(() => ({ user, permissions: new Set(permissions), initialContext }), [user, permissions, initialContext]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  return React.useContext(ShellContext);
}

/** Permission check against the shell's server-resolved set (`null` set = allow). */
export function useShellAllows(): (permission: readonly string[]) => boolean {
  const { permissions } = useShell();
  return React.useCallback(
    (permission: readonly string[]) => permissions === null || permission.length === 0 || permission.some((key) => permissions.has(key)),
    [permissions],
  );
}
