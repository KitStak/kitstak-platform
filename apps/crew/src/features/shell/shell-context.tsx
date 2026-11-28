'use client';
/**
 * Request scoped shell context, filled by the (app) layout on the server: who is signed in, the
 * active org and role, their Crew role and rights, every org they belong to, sibling app URLs and
 * module flags. Read it anywhere with `useShell()`.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { canCrew, type CrewAction, type CrewRole, type OrgRole } from '@/lib/permissions';

export interface ShellOrg {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo: string | null;
  readonly role: OrgRole;
}

/** Live counts shown as badges in the navigation. Leave a count out when it is not known. */
export interface ShellBadges {
  /** Time cards that need a fix (Phase 4). */
  readonly needsFix?: number;
}

export interface ShellAppUrls {
  readonly portal: string;
  readonly crm: string;
  readonly wms: string;
  readonly projects: string;
  readonly pulse: string;
  readonly ledger: string | null;
  readonly crew: string;
}

export interface ShellContextValue {
  readonly user: { readonly id: string; readonly name: string; readonly email: string; readonly image: string | null };
  readonly org: ShellOrg;
  readonly orgRole: OrgRole;
  readonly orgs: readonly ShellOrg[];
  readonly crewRole: CrewRole;
  /** The server fills pay fields only when true (SPEC 3.3). */
  readonly canSeePay: boolean;
  /** The live Crew person linked to this login (phone clock and My work), or null. */
  readonly linkedPersonId: string | null;
  readonly appUrls: ShellAppUrls;
  /** Which billed sibling apps the org may open (app switcher locks). */
  readonly modules: { readonly crm: boolean; readonly wms: boolean; readonly projects: boolean; readonly pulse: boolean };
  readonly badges?: ShellBadges;
}

interface ShellContextApi extends ShellContextValue {
  /** Crew permission check (pure; the server re-checks). */
  readonly can: (action: CrewAction) => boolean;
}

const ShellContext = createContext<ShellContextApi | null>(null);

export function ShellProvider({ value, children }: { readonly value: ShellContextValue; readonly children: ReactNode }) {
  const api = useMemo<ShellContextApi>(() => ({ ...value, can: (action) => canCrew(value.crewRole, action) }), [value]);
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
