import Link from 'next/link';
import {
  BookOpen,
  Building2,
  CalendarCheck2,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  History,
  Lock,
  MonitorSmartphone,
  Plug,
  Scale,
  Settings2,
  Shapes,
  TestTubeDiagonal,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { cn } from '@/components/ui/cn';
import { routes } from '@/lib/routes';
import { orgModuleFlags } from '@/server/entitlements';
import { appUrls } from '@/server/env';
import { pulsePage } from '@/server/page';

type SettingsView = 'all' | 'close' | 'apps' | 'audit';

function SettingsTabs({ active }: { readonly active: SettingsView }) {
  return (
    <RouteTabs
      label="Settings sections"
      active={active}
      tabs={[
        { id: 'all', label: 'Workspace', href: routes.settings() },
        { id: 'close', label: 'Month close', href: routes.settingsClose() },
        { id: 'apps', label: 'Connected apps', href: routes.settingsApps() },
        { id: 'audit', label: 'Audit log', href: routes.settingsAudit() },
      ]}
    />
  );
}

interface Section {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly detail: string;
  readonly state?: string;
}

const SECTIONS: readonly Section[] = [
  { id: 'general', icon: Settings2, title: 'General', detail: 'Currency, the first day of your week, working days, shift length and how jobs are numbered.' },
  { id: 'sites', icon: Building2, title: 'Sites', detail: 'Each building or floor you run, with its name and time zone.', state: 'No sites yet' },
  { id: 'job-types', icon: Shapes, title: 'Job types', detail: 'The kinds of work you do, like kitting, relabeling or returns.', state: 'No job types yet' },
  { id: 'people', icon: UsersRound, title: 'People and roles', detail: 'Who can use Pulse, what they can do, and who can see money.' },
  { id: 'cost-rules', icon: Scale, title: 'Cost rules', detail: 'Who buys the parts, how time not on a job is shared out, your target margin and when a job counts as at risk.' },
  { id: 'devices', icon: MonitorSmartphone, title: 'Device links', detail: 'Links for the floor tablet and the wall TV, so shared screens never hold a personal login.', state: 'No device links yet' },
  { id: 'sample-data', icon: TestTubeDiagonal, title: 'Sample data', detail: 'A made up shop with jobs, logged days and costs, to try Pulse before you type anything real.', state: 'Not loaded' },
];

/** The spec's plain words cost model. This text is the in app "How Pulse does the math" page. */
const MATH: readonly { readonly term: string; readonly text: string }[] = [
  { term: 'A job', text: 'One piece of work for one client, like building 5,000 holiday gift kits. One job has one kind of unit and one price. If you build three kit versions at three prices, make three jobs.' },
  { term: 'Money in', text: 'What the client pays: the price per unit times units finished, plus any extra services, plus other fees.' },
  { term: 'Money out', text: 'Four buckets. Labor: hours times what an hour really costs you. Materials: parts and supplies that you pay for. Other costs: freight, packaging, outside help. Time not on a job: meetings, cleanup and waiting, spread across the jobs that ran that week.' },
  { term: 'Profit and margin', text: 'Profit is money in minus money out. Margin is profit as a share of money in.' },
  { term: 'Real cost of an hour', text: 'The wage, plus payroll taxes and benefits, plus overhead per hour.' },
  { term: 'Quote, budget, actual', text: 'The quote is what you told the client. The budget is what you think it will cost you. Actual is what happened.' },
  { term: 'Status', text: 'Pulse watches every open job and says if it is on track, needs a heads up, is at risk, or is losing money, and tells you why.' },
  { term: 'Job profit and company profit', text: 'These are two numbers. Jobs carry the costs you put on them. The company also pays for rent, salaried staff and paid time nobody logged. Pulse shows the walk from one number to the other, line by line.' },
  { term: 'One place per cost', text: 'Put each cost in one place only. A supervisor’s pay goes either in overhead per hour, or in logged hours, or in company costs. Never two of them.' },
];

/** Settings: every workspace section, plus How Pulse does the math. */
export async function SettingsPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).section;
  const focus = Array.isArray(raw) ? raw[0] : raw;
  const page = await pulsePage(routes.settings(), 'settings');
  if (page.blocked) return <PageBlocked title="Settings" role={page.access.role} />;
  const canManage = page.can('settings:manage');
  return (
    <Page title="Settings" subtitle="How Pulse is set up for your workspace." tabs={<SettingsTabs active="all" />} width="narrow">
      <div className="flex flex-col gap-5">
        {canManage ? null : (
          <p className="flex items-center gap-2 rounded-lg border border-border-subtle bg-sunken px-3 py-2 text-sm text-fg-secondary" data-testid="settings-read-only">
            <Lock aria-hidden className="size-4 shrink-0 text-icon" />
            You can read these settings. Only an admin or owner can change them.
          </p>
        )}
        <Panel bodyClassName="p-0">
          <ul className="divide-y divide-border-subtle">
            {SECTIONS.map((section) => (
              <li key={section.id} id={section.id} data-testid={`settings-${section.id}`} className={cn('flex scroll-mt-4 items-start gap-3 px-4 py-3.5', focus === section.id && 'bg-selected')}>
                <span aria-hidden className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-icon-strong">
                  <section.icon className="size-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-fg">{section.title}</h2>
                  <p className="mt-0.5 text-sm text-fg-muted">{section.detail}</p>
                </div>
                {section.state ? <span className="mt-1 shrink-0 text-xs text-fg-muted">{section.state}</span> : null}
              </li>
            ))}
          </ul>
        </Panel>
        <section id="math" aria-labelledby="math-title" data-testid="settings-math" className={cn('scroll-mt-4 rounded-xl border border-border-subtle bg-panel shadow-xs', focus === 'math' && 'ring-2 ring-[color:var(--border-focus,var(--primary))]')}>
          <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
            <BookOpen aria-hidden className="size-[18px] text-icon" />
            <h2 id="math-title" className="text-base font-semibold text-fg">
              How Pulse does the math
            </h2>
          </header>
          <dl className="divide-y divide-border-subtle">
            {MATH.map((row) => (
              <div key={row.term} className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                <dt className="text-sm font-medium text-fg">{row.term}</dt>
                <dd className="text-sm text-fg-secondary">{row.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Page>
  );
}

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

/** Audit log: who changed what, and when, with the before and after. */
export async function SettingsAuditPage() {
  const page = await pulsePage(routes.settingsAudit(), 'settings');
  if (page.blocked) return <PageBlocked title="Audit log" role={page.access.role} />;
  return (
    <Page title="Settings" subtitle="How Pulse is set up for your workspace." tabs={<SettingsTabs active="audit" />} width="narrow">
      <Panel>
        <Teach
          icon={History}
          title="No changes recorded yet"
          why="Every change in Pulse is written down: who did it, when, and what the value was before and after. Nothing here can be edited or deleted."
          points={['Filter by person, record and date', 'See the before and after of any change', 'Export the log as a CSV file']}
          actions={<ButtonLink href={routes.settings()}>Back to settings</ButtonLink>}
        />
      </Panel>
    </Page>
  );
}
