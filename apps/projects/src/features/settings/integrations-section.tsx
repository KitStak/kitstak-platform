'use client';
/**
 * Settings → Integrations: how Projects works with the Portal, CRM and WMS. Each app shows
 * whether it's in the plan and connected, what that unlocks, and how much is linked already.
 */
import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, CircleDashed, Lock } from 'lucide-react';
import { Badge, cn } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { routes } from '@/lib/routes';
import { useShell } from '@/features/shell/shell-context';
import type { IntegrationLinkSummary } from '@/server/domain/integration-summary';

type State = 'connected' | 'licensed' | 'locked';

function StateBadge({ state }: { readonly state: State }) {
  if (state === 'connected')
    return (
      <Badge tone="success" icon={<CheckCircle2 aria-hidden />}>
        Connected
      </Badge>
    );
  if (state === 'licensed')
    return (
      <Badge tone="warning" icon={<CircleDashed aria-hidden />}>
        In your plan, not set up here
      </Badge>
    );
  return <Badge icon={<Lock aria-hidden />}>Not in your plan</Badge>;
}

function Stat({ value, label }: { readonly value: number; readonly label: string }) {
  return (
    <div className="rounded-lg bg-sunken px-3 py-2">
      <p className="text-lg font-semibold text-fg tabular-nums">{value}</p>
      <p className="text-xs text-fg-muted">{label}</p>
    </div>
  );
}

function AppCard({
  icon,
  name,
  state,
  blurb,
  features,
  stats,
  href,
  openLabel,
  lockedHint,
  testId,
}: {
  readonly icon: string;
  readonly name: string;
  readonly state: State;
  readonly blurb: string;
  readonly features: readonly string[];
  readonly stats?: readonly { value: number; label: string }[];
  readonly href: string;
  readonly openLabel: string;
  readonly lockedHint: string;
  readonly testId: string;
}) {
  return (
    <section
      className="rounded-xl border border-border-subtle bg-panel shadow-xs"
      data-testid={testId}
      data-state={state}
    >
      <header className="flex flex-wrap items-start gap-3 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={icon}
          alt=""
          width={40}
          height={40}
          className={cn('size-10 shrink-0 rounded-lg', state === 'locked' && 'opacity-50 grayscale')}
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-md font-semibold text-fg">{name}</h3>
          <p className="mt-0.5 text-sm text-fg-secondary">{blurb}</p>
        </div>
        <StateBadge state={state} />
      </header>
      <div className="border-t border-border-subtle px-4 py-3">
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {features.map((feature) => (
            <li
              key={feature}
              className={cn(
                'flex items-start gap-2 text-sm',
                state === 'connected' ? 'text-fg' : 'text-fg-muted',
              )}
            >
              <CheckCircle2
                aria-hidden
                className={cn('mt-0.5 size-4 shrink-0', state === 'connected' ? 'text-success' : 'text-icon')}
              />
              {feature}
            </li>
          ))}
        </ul>
        {state === 'connected' && stats?.length ? (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map((stat) => (
              <Stat key={stat.label} {...stat} />
            ))}
          </div>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-4 py-3">
        <p className="text-xs text-fg-muted">
          {state === 'connected' ? 'Works both ways.' : lockedHint}
        </p>
        <a
          href={href}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg hover:bg-muted"
        >
          {openLabel} <ArrowUpRight aria-hidden className="size-4 text-icon" />
        </a>
      </footer>
    </section>
  );
}

export function IntegrationsSection({ summary }: { readonly summary: IntegrationLinkSummary }) {
  const { modules, integrations, appUrls, org, can } = useShell();
  const canManage = can('workspace:manage');
  const crmState: State = integrations.crm ? 'connected' : modules.crm ? 'licensed' : 'locked';
  const wmsState: State = integrations.wms ? 'connected' : modules.wms ? 'licensed' : 'locked';
  const n = (type: keyof IntegrationLinkSummary['links']) => summary.links[type] ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <AppCard
        testId="integration-portal"
        icon="/brand/kitstak-icon-portal.svg"
        name="KitStak Portal"
        state="connected"
        blurb="Sign-in, people, billing and the app launcher."
        features={[
          'One sign-in for every app',
          'Invite people once, use them everywhere',
          'Open tasks and at-risk projects on your launcher',
          'Switch apps from the grid at the top',
        ]}
        href={appUrls.portal}
        openLabel="Open Portal"
        lockedHint=""
      />
      <AppCard
        testId="integration-crm"
        icon="/brand/kitstak-icon-crm.svg"
        name="KitStak CRM"
        state={crmState}
        blurb="Turn won deals into projects."
        features={[
          'Link tasks and projects to deals and accounts',
          'Start a project from a deal with one click',
          'See the deal’s stage right on the task',
          'Automations that run when a deal changes stage',
        ]}
        stats={[
          { value: n('crm_item') + n('crm_account'), label: 'Linked deals and accounts' },
          { value: summary.projectsWithDeal, label: 'Projects from deals' },
          { value: summary.projectsWithClient, label: 'Projects for a client' },
          { value: summary.automationsUsingApps, label: 'CRM or WMS automations' },
        ]}
        href={crmState === 'locked' ? `${appUrls.portal}/billing` : `${appUrls.crm}/${org.slug}`}
        openLabel={crmState === 'locked' ? 'See CRM plans' : 'Open CRM'}
        lockedHint={
          crmState === 'licensed'
            ? 'CRM is in your plan. Open it once to set up your boards and it connects here.'
            : canManage
              ? 'Add CRM to your plan in the Portal to link deals.'
              : 'Ask an admin to add CRM to your plan.'
        }
      />
      <AppCard
        testId="integration-wms"
        icon="/brand/kitstak-icon-wms.svg"
        name="KitStak WMS"
        state={wmsState}
        blurb="Link work to warehouse orders, receipts and counts."
        features={[
          'Link tasks to orders, work orders, receipts and counts',
          'See order status on the task',
          'Automations that run when an order ships',
          'Warehouse go-live and client onboarding templates',
        ]}
        stats={[
          { value: n('wms_order'), label: 'Linked orders' },
          { value: n('wms_work_order'), label: 'Linked work orders' },
          { value: n('wms_receipt'), label: 'Linked receipts' },
          { value: n('wms_count'), label: 'Linked counts' },
        ]}
        href={wmsState === 'locked' ? `${appUrls.portal}/billing` : appUrls.wms}
        openLabel={wmsState === 'locked' ? 'See WMS plans' : 'Open WMS'}
        lockedHint={
          wmsState === 'licensed'
            ? 'WMS is in your plan but this workspace isn’t the warehouse workspace, so records can’t be linked here.'
            : canManage
              ? 'Add WMS to your plan in the Portal to link orders.'
              : 'Ask an admin to add WMS to your plan.'
        }
      />
      <Panel title="Shared clients">
        <p className="text-sm text-fg-secondary">
          Clients from the CRM and WMS appear when you make a project from the{' '}
          <Link href={routes.templates()} className="font-medium text-fg-link hover:underline">
            Client onboarding
          </Link>{' '}
          or Warehouse go-live templates.
          {n('core_customer')
            ? ` ${n('core_customer')} ${n('core_customer') === 1 ? 'link points' : 'links point'} at a shared client today.`
            : ''}
        </p>
      </Panel>
    </div>
  );
}
