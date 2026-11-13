'use client';
/**
 * Request-scoped shell context, filled by the (app) layout on the server: who is signed in,
 * the active org + role, every org they belong to, sibling app URLs and module/integration
 * flags. Read it anywhere with `useShell()`.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { canOrg, type OrgAction, type OrgRole } from '@/lib/permissions';

export interface ShellOrg {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo: string | null;
  readonly role: OrgRole;
}

export interface ShellContextValue {
  readonly user: { readonly id: string; readonly name: string; readonly email: string; readonly image: string | null };
  readonly org: ShellOrg;
  readonly orgRole: OrgRole;
  readonly orgs: readonly ShellOrg[];
  readonly appUrls: { readonly portal: string; readonly crm: string; readonly wms: string; readonly projects: string };
  readonly modules: { readonly crm: boolean; readonly wms: boolean; readonly projects: boolean };
  readonly integrations: { readonly crm: boolean; readonly wms: boolean };
  /** Sibling apps this org cannot use on any plan (app switcher shows them as "Not in your plan"). */
  readonly notInPlan?: readonly ('crm' | 'wms')[];
}

interface ShellContextApi extends ShellContextValue {
  /** Org-level permission check (pure; server re-checks). */
  readonly can: (action: OrgAction) => boolean;
}

const ShellContext = createContext<ShellContextApi | null>(null);

export function ShellProvider({ value, children }: { readonly value: ShellContextValue; readonly children: ReactNode }) {
  const api = useMemo<ShellContextApi>(() => ({ ...value, can: (action) => canOrg(value.orgRole, action) }), [value]);
  return <ShellContext.Provider value={api}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextApi {
  const context = useContext(ShellContext);
  if (!context) throw new Error('useShell must be used inside the signed-in app shell');
  return context;
}

/** Same as useShell but null outside the shell (public pages). */
export function useOptionalShell(): ShellContextApi | null {
  return useContext(ShellContext);
}
