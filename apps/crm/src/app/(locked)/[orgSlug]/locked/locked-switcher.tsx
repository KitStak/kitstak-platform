'use client';
/** The app switcher on the CRM lock screen, so a person can go to an app that is in their plan. */
import { AppSwitcher, type AppSwitcherPlanBadge } from '@kitstak/ui/app-switcher';

const URLS = {
  portal: (process.env.NEXT_PUBLIC_PORTAL_URL || 'http://localhost:3300').replace(/\/+$/, ''),
  crm: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3100',
  wms: process.env.NEXT_PUBLIC_WMS_URL || 'http://localhost:3000',
  projects: process.env.NEXT_PUBLIC_PROJECTS_URL || 'http://localhost:3400',
  pulse: process.env.NEXT_PUBLIC_PULSE_URL,
};

export function LockedSwitcher({
  badges,
  billingOnly = false,
}: {
  readonly badges?: Readonly<Record<'crm' | 'wms' | 'projects' | 'pulse', AppSwitcherPlanBadge>>;
  /** A person who only manages billing: the apps are listed as text, and the Portal row opens Billing. */
  readonly billingOnly?: boolean;
}) {
  return (
    <AppSwitcher
      current="crm"
      urls={URLS}
      planBadges={badges}
      addHref={(app) => `${URLS.portal}/billing/plan?add=${app}&from=crm`}
      billingOnly={billingOnly}
    />
  );
}
