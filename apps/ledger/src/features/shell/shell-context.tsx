'use client';
/**
 * Request scoped shell context, filled by the (app) layout on the server: who is signed in, the
 * active org and role, their Ledger role and rights, every org they belong to, sibling app URLs
 * and module flags. Read it anywhere with `useShell()`.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { LedgerRight, LedgerRole, OrgRole } from '@/lib/permissions';
import type { BadgeKey } from '@/lib/nav';

export interface ShellOrg {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo: string | null;
  readonly role: OrgRole;
}

/** Live counts shown as badges in the navigation. Leave a count out when it is not known. */
export type ShellBadges = Partial<Record<BadgeKey, number>>;

export interface ShellAppUrls {
  readonly portal: string;
  readonly crm: string;
  readonly wms: string;
  readonly projects: string;
  readonly pulse: string;
  readonly crew: string;
  readonly ledger: string;
}

export interface ShellContextValue {
  readonly user: { readonly id: string; readonly name: string; readonly email: string; readonly image: string | null };
  readonly org: ShellOrg;
  readonly orgRole: OrgRole;
  readonly orgs: readonly ShellOrg[];
  readonly ledgerRole: LedgerRole;
  readonly rights: readonly LedgerRight[];
  readonly appUrls: ShellAppUrls;
  /** Which billed apps the org is licensed for (app switcher locks). */
  readonly modules: { readonly crm: boolean; readonly wms: boolean; readonly projects: boolean; readonly pulse: boolean };
  readonly badges?: ShellBadges;
}

interface ShellContextApi extends ShellContextValue {
  /** Ledger right check (pure; the server re-checks). */
  readonly can: (right: LedgerRight) => boolean;
}

const ShellContext = createContext<ShellContextApi | null>(null);

export function ShellProvider({ value, children }: { readonly value: ShellContextValue; readonly children: ReactNode }) {
  const api = useMemo<ShellContextApi>(() => ({ ...value, can: (right) => value.rights.includes(right) }), [value]);
  return <ShellContext.Provider value={api}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextApi {
  const context = useContext(ShellContext);
  if (!context) throw new Error('useShell must be used inside the signed in app shell');
  return context;
}

/** Same as useShell but null outside the shell (public pages). */
export function useOptionalShell(): ShellContextApi | null {
  return useContext(ShellContext);
}
