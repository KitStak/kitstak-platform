import Link from 'next/link';
import { CalendarCheck2, ChevronRight, CircleCheck, CircleDashed, CircleSlash, Plug } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { cn } from '@/components/ui/cn';
import { routes } from '@/lib/routes';
import { orgModuleFlags } from '@/server/entitlements';
import { appUrls } from '@/server/env';
import { pulsePage } from '@/server/page';
import { SettingsTabs } from './settings-tabs';

/** Month close: the checklist, the payroll check, and locking a month so its numbers stay put. */
export async function SettingsClosePage() {
  const page = await pulsePage(routes.settingsClose(), 'settings');
  if (page.blocked) return <PageBlocked title="Month close" role={page.access.role} />;
  return (
    <Page title="Settings" subtitle="How Pulse is set up for your workspace." tabs={<SettingsTabs active="close" />} width="narrow">
      <Panel>
        <Teach
          icon={CalendarCheck2}
          title="No months to close yet"
          why="Closing a month locks its numbers. After that nobody can change an entry, a cost or a rate inside it by accident, so the profit you reported stays the profit you reported."
          points={['A checklist: every day logged, every cost in, payroll checked', 'One click to close, with who did it and when', 'An owner can reopen a month, with a reason that is kept on record']}
          actions={page.can('production:log') ? <ButtonLink href={routes.log()}>Log work</ButtonLink> : null}
          footnote={page.can('period:close') ? 'A month shows up here once it has at least one logged day.' : 'Only an admin or owner can close a month.'}
        />
      </Panel>
    </Page>
  );
}

const APP_COPY = {
  crm: { name: 'KitStak CRM', gives: 'Won deals become jobs with the deal value as the quote, and clients match your CRM accounts.' },
  wms: { name: 'KitStak WMS', gives: 'Kits built on work orders flow in as units, and parts used flow in as material cost.' },
  projects: { name: 'KitStak Projects', gives: 'Time logged on a project counts as labor on its job, and alerts can become tasks.' },
} as const;

/** Connected apps: which sibling KitStak apps Pulse can read for this workspace. */
export async function SettingsAppsPage() {
  const page = await pulsePage(routes.settingsApps(), 'settings');
  if (page.blocked) return <PageBlocked title="Connected apps" role={page.access.role} />;
  const [modules, integrations] = await Promise.all([orgModuleFlags(page.ctx.orgId), page.integrations()]);
  const urls = appUrls();
  const rows = (['crm', 'wms', 'projects'] as const).map((id) => {
    const licensed = modules[id];
    const ready = integrations[id];
    const state = ready ? 'connected' : licensed ? 'not-set-up' : 'not-licensed';
    return { id, state, ...APP_COPY[id] };
  });
  const anyConnected = rows.some((row) => row.state === 'connected');
  return (
    <Page title="Settings" subtitle="How Pulse is set up for your workspace." tabs={<SettingsTabs active="apps" />} width="narrow">
      <div className="flex flex-col gap-5">
        <Panel title="KitStak apps" bodyClassName="p-0">
          <ul className="divide-y divide-border-subtle">
            {rows.map((row) => {
              const Icon = row.state === 'connected' ? CircleCheck : row.state === 'not-set-up' ? CircleDashed : CircleSlash;
              const label = row.state === 'connected' ? 'Connected' : row.state === 'not-set-up' ? 'Not set up yet' : 'Not on your plan';
              return (
                <li key={row.id} data-testid={`app-${row.id}`} data-state={row.state} className="flex items-start gap-3 px-4 py-3.5">
                  <span aria-hidden className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-icon-strong">
                    <Plug className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-fg">{row.name}</h2>
                    <p className="mt-0.5 text-sm text-fg-muted">{row.gives}</p>
                  </div>
                  <span className={cn('mt-1 inline-flex shrink-0 items-center gap-1.5 text-xs font-medium', row.state === 'connected' ? 'text-success-text' : 'text-fg-muted')}>
                    <Icon aria-hidden className="size-4" />
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
        <p className="text-sm text-fg-muted">
          {anyConnected
            ? 'Pulse reads connected apps for this workspace only, and keeps working if one of them is switched off.'
            : 'Nothing is connected, and nothing has to be. Every kind of data can come in from a spreadsheet instead.'}{' '}
          <Link href={anyConnected ? `${urls.portal}/billing` : routes.importCenter()} className="font-medium text-fg-link hover:underline">
            {anyConnected ? 'Manage apps in the Portal' : 'Go to Import and export'}
          </Link>
          <ChevronRight aria-hidden className="ml-0.5 inline size-3.5 align-[-2px] text-fg-link" />
        </p>
      </div>
    </Page>
  );
}
