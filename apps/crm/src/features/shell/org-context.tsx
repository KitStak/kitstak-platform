'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { PlanBannerNotice } from '@kitstak/ui/plan-banner';
import type { AppSwitcherPlanBadge } from '@kitstak/ui/plan-badges';
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
  /** Apps this org cannot use on any plan. Kept for dev harnesses; the shell passes plan badges. */
  readonly notInPlan?: readonly ('crm' | 'wms' | 'projects' | 'pulse')[];
  /** Plan state per app for the app switcher (`AppPlanView.badges`). */
  readonly planBadges?: Readonly<Partial<Record<ShellProductId, AppSwitcherPlanBadge>>>;
  /** Where a row that is not in the plan goes: the Portal plan picker with that app turned on. */
  readonly addHrefs?: Readonly<Partial<Record<ShellProductId, string>>>;
}

export type ShellProductId = 'crm' | 'wms' | 'projects' | 'pulse';

/** The organization's plan as the CRM shell needs it (docs/billing/CONTRACTS.md section 18). */
export interface ShellPlan {
  /** `read_only` = view only: everything opens and reads, every change is refused by the server. */
  readonly access: 'full' | 'read_only';
  /** The plan banner under the top bar, or null. Words and link come from `@kitstak/billing`. */
  readonly notice: PlanBannerNotice | null;
}

export interface OrgContextValue {
  readonly org: ShellOrg;
  readonly user: ShellUser;
  readonly role: OrgRole;
  readonly permissions: readonly Permission[];
  /** Omitted in dev harnesses; the shell then shows every app unlocked. */
  readonly apps?: ShellApps;
  /** Omitted in dev harnesses; the shell then shows no banner and treats the plan as full. */
  readonly plan?: ShellPlan;
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

/** True while the organization's plan is view only. UI hint only; the server refuses every write. */
export function usePlanReadOnly(): boolean {
  return useContext(OrgContext)?.plan?.access === 'read_only';
}

/** UI-only affordance check; the server re-checks every request. */
export function useCan(permission: Permission): boolean {
  return useOrg().permissions.includes(permission);
}
