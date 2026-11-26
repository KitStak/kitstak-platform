'use client';
/**
 * Request-scoped shell context, filled by the (app) layout on the server: who is signed in,
 * the active org + role, their Pulse role and money rights, every org they belong to, sibling
 * app URLs and module/integration flags. Read it anywhere with `useShell()`.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { PlanBannerNotice } from '@kitstak/ui/plan-banner';
import type { AppSwitcherPlanBadge } from '@kitstak/ui/plan-badges';
import { canPulse, type OrgRole, type PulseAction, type PulseRole } from '@/lib/permissions';

export interface ShellOrg {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo: string | null;
  readonly role: OrgRole;
}

/** Live counts shown as badges in the navigation. Leave a count out when it is not known. */
export interface ShellBadges {
  /** Open jobs that are at risk or losing money. */
  readonly jobsAtRisk?: number;
  readonly openAlerts?: number;
}

export interface ShellContextValue {
  readonly user: { readonly id: string; readonly name: string; readonly email: string; readonly image: string | null };
  readonly org: ShellOrg;
  readonly orgRole: OrgRole;
  readonly orgs: readonly ShellOrg[];
  readonly pulseRole: PulseRole;
  /** May this person see revenue, cost, profit and margin? The server hides them when false. */
  readonly seesMoney: boolean;
  /** May this person see wages, taxes and benefits behind a labor rate? */
  readonly seesWages: boolean;
  readonly appUrls: { readonly portal: string; readonly crm: string; readonly wms: string; readonly projects: string; readonly pulse: string };
  /** Which apps the org is licensed for (app switcher locks). */
  readonly modules: { readonly crm: boolean; readonly wms: boolean; readonly projects: boolean; readonly pulse: boolean };
  /** Which sibling apps Pulse can read for this org (licensed and installed). */
  readonly integrations: { readonly crm: boolean; readonly wms: boolean; readonly projects: boolean };
  /**
   * The program tracker is on (Projects is entitled and its program tables exist): the Programs
   * nav item, its shortcut, palette rows and the Home card show only then. Left out means off.
   */
  readonly programs?: boolean;
  readonly badges?: ShellBadges;
  /** Sibling apps this org cannot use on any plan (app switcher shows them as "Not in your plan"). */
  readonly notInPlan?: readonly ('crm' | 'wms' | 'projects')[];
  /** Plan state per app for the app switcher (`AppPlanView.badges`). */
  readonly planBadges?: Readonly<Partial<Record<ShellProductId, AppSwitcherPlanBadge>>>;
  /** Where a row that is not in the plan goes: the Portal plan picker with that app turned on. */
  readonly addHrefs?: Readonly<Partial<Record<ShellProductId, string>>>;
  /** The organization's plan as the shell needs it. Omitted outside the signed-in app. */
  readonly plan?: ShellPlan;
}

export type ShellProductId = 'crm' | 'wms' | 'projects' | 'pulse';

/** docs/billing/CONTRACTS.md section 18. */
export interface ShellPlan {
  /** `read_only` = view only: everything opens and reads, every change is refused by the server. */
  readonly access: 'full' | 'read_only';
  /** The plan banner under the top bar, or null. Words and link come from `@kitstak/billing`. */
  readonly notice: PlanBannerNotice | null;
}

interface ShellContextApi extends ShellContextValue {
  /** Pulse permission check (pure; the server re-checks). */
  readonly can: (action: PulseAction) => boolean;
}

const ShellContext = createContext<ShellContextApi | null>(null);

export function ShellProvider({ value, children }: { readonly value: ShellContextValue; readonly children: ReactNode }) {
  const api = useMemo<ShellContextApi>(() => ({ ...value, can: (action) => canPulse(value.pulseRole, action) }), [value]);
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
