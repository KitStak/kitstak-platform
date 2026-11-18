'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { OrgRole, Permission } from '@/server/rbac/permissions';

export interface ShellUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
}

export interface ShellOrg {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly logo: string | null;
}

/** Sibling KitStak apps: origins and per-module unlock state (app switcher, cross-app panels). */
export interface ShellApps {
  readonly urls: { readonly portal: string; readonly crm: string; readonly wms: string; readonly projects: string; readonly pulse?: string };
  readonly entitled: { readonly crm: boolean; readonly wms: boolean; readonly projects: boolean; readonly pulse?: boolean };
  /** Apps this org cannot use on any plan (WMS outside the platform org). */
  readonly notInPlan?: readonly ('crm' | 'wms' | 'projects' | 'pulse')[];
}

export interface OrgContextValue {
  readonly org: ShellOrg;
  readonly user: ShellUser;
  readonly role: OrgRole;
  readonly permissions: readonly Permission[];
  /** Omitted in dev harnesses; the shell then shows every app unlocked. */
  readonly apps?: ShellApps;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({
  value,
  children,
}: {
  readonly value: OrgContextValue;
  readonly children: ReactNode;
}) {
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

/** Current organization, user and permissions (inside the authenticated app shell). */
export function useOrg(): OrgContextValue {
  const context = useContext(OrgContext);
  if (!context) throw new Error('useOrg must be used inside the app shell');
  return context;
}

/** Like `useOrg`, but null outside the app shell (dev harnesses, embedded panels). */
export function useOptionalOrg(): OrgContextValue | null {
  return useContext(OrgContext);
}

/** UI-only affordance check; the server re-checks every request. */
export function useCan(permission: Permission): boolean {
  return useOrg().permissions.includes(permission);
}
