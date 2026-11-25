'use client';
/**
 * The frame around the lock screen when Projects is not in the plan (docs/billing/SPEC.md 9.3).
 *
 * The same quiet frame as in the CRM and the WMS (`PlanLockFrame` in `@kitstak/ui`): the logo, the
 * organization name and the app switcher. The full app shell is NOT used here on purpose. Its
 * navigation and its create buttons ("New task", "New project" and the phone "+" button)
 * would all open things that cannot work in a locked app.
 */
import Link from 'next/link';
import { AppSwitcher } from '@kitstak/ui/app-switcher';
import { PlanLockFrame, PlanLockScreen, type PlanLockView } from '@kitstak/ui/plan-lock';
import { Logo } from './logo';
import type { ShellContextValue } from './shell-context';

export interface LockedFrameProps {
  readonly lock: PlanLockView;
  readonly context: Pick<ShellContextValue, 'org' | 'appUrls' | 'modules' | 'notInPlan' | 'planBadges' | 'addHrefs'>;
}

export function LockedFrame({ lock, context }: LockedFrameProps) {
  const { org, appUrls, modules, notInPlan, planBadges, addHrefs } = context;
  return (
    <PlanLockFrame
      logo={
        <Link href="/" aria-label="KitStak Projects home">
          <Logo size={24} />
        </Link>
      }
      orgName={org.name}
      switcher={
        <AppSwitcher
          current="projects"
          urls={appUrls}
          entitled={{ crm: modules.crm, wms: modules.wms, projects: modules.projects, pulse: modules.pulse }}
          notInPlan={notInPlan}
          planBadges={planBadges}
          addHref={addHrefs ? (app) => (app === 'portal' ? undefined : addHrefs[app]) ?? `${appUrls.portal}/billing/plan?add=${app}` : undefined}
        />
      }
    >
      <PlanLockScreen app="projects" lock={lock} />
    </PlanLockFrame>
  );
}
