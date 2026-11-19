'use client';
/**
 * The Workspace tab of Settings: a list of sections on the left (a picker on small screens) and
 * the chosen section on the right. The section lives in the address (`?section=`), so a link can
 * point straight at one.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BellRing, BookOpen, Boxes, Building2, CalendarCheck2, HandCoins, History, MonitorSmartphone, Plug, Scale, Settings2, Shapes, TestTubeDiagonal, TriangleAlert, UsersRound, type LucideIcon } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { ScrollX } from '@/components/ui/scroll-x';
import { Panel } from '@/components/layout/page';
import { useShell } from '@/features/shell/shell-context';
import { useSettings } from '@/lib/hooks/use-data';
import { routes } from '@/lib/routes';
import type { SettingsDTO } from '@/lib/types';
import type { SampleStateDTO } from '@/server/domain/sample';
import { CostRulesSection, GeneralSection, LaborDefaultsSection } from './sections/forms';
import { CatalogsSection, JobTypesSection, SitesSection } from './sections/lists';
import { DangerSection, DevicesSection, MathSection, NotificationsSection, SampleDataSection } from './sections/more';
import { PeopleSection } from './sections/people';

interface SectionInfo {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly detail: string;
  /** A section that lives on its own page. */
  readonly href?: string;
}

export const SETTINGS_SECTIONS: readonly SectionInfo[] = [
  { id: 'general', icon: Settings2, title: 'General', detail: 'Currency, week, working days, job numbers' },
  { id: 'sites', icon: Building2, title: 'Sites', detail: 'Buildings and their time zones' },
  { id: 'job-types', icon: Shapes, title: 'Job types', detail: 'The kinds of work you do' },
  { id: 'labor', icon: HandCoins, title: 'Labor defaults', detail: 'Taxes, benefits, overhead, overtime' },
  { id: 'cost-rules', icon: Scale, title: 'Cost rules', detail: 'Parts, shared time, margin and risk limits' },
  { id: 'people', icon: UsersRound, title: 'People and roles', detail: 'Who can do what, who sees money' },
  { id: 'catalogs', icon: Boxes, title: 'Catalogs', detail: 'Clients and items' },
  { id: 'notifications', icon: BellRing, title: 'Notifications', detail: 'What lands under your bell' },
  { id: 'devices', icon: MonitorSmartphone, title: 'Device links', detail: 'Floor tablets and wall TVs' },
  { id: 'close', icon: CalendarCheck2, title: 'Month close', detail: 'Lock a month so it stops moving', href: routes.settingsClose() },
  { id: 'apps', icon: Plug, title: 'Connected apps', detail: 'CRM, WMS and Projects', href: routes.settingsApps() },
  { id: 'audit', icon: History, title: 'Audit log', detail: 'Who changed what, and when', href: routes.settingsAudit() },
  { id: 'sample-data', icon: TestTubeDiagonal, title: 'Sample data', detail: 'A made up shop to try things' },
  { id: 'danger', icon: TriangleAlert, title: 'Danger zone', detail: 'Delete all Pulse data' },
  { id: 'math', icon: BookOpen, title: 'How Pulse does the math', detail: 'The cost model in plain words' },
];

export function SettingsView({ initialSettings, initialSample }: { readonly initialSettings: SettingsDTO; readonly initialSample: SampleStateDTO }) {
  const shell = useShell();
  const params = useSearchParams();
  const wanted = params?.get('section') ?? 'general';
  const active = SETTINGS_SECTIONS.find((section) => section.id === wanted && !section.href)?.id ?? 'general';
  const settings = useSettings({ initialData: initialSettings }).data ?? initialSettings;
  const canEdit = shell.can('settings:manage');
  const canRoles = shell.can('roles:manage');
  const canSample = shell.can('sample:manage');

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start" data-testid="settings" data-section={active}>
      <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-4">
        <ScrollX label="Settings sections" tabStop={false} fade="app" scrollerClassName="pb-1 lg:overflow-visible lg:pb-0" testId="settings-nav-scroll">
        <ul className="flex gap-1 lg:flex-col">
          {SETTINGS_SECTIONS.map((section) => {
            const current = section.id === active;
            return (
              <li key={section.id} className="shrink-0">
                <Link
                  href={section.href ?? routes.settings(section.id)}
                  scroll={false}
                  aria-current={current ? 'page' : undefined}
                  data-testid={`settings-nav-${section.id}`}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                    current ? 'bg-selected font-medium text-fg' : 'text-fg-secondary hover:bg-hover hover:text-fg',
                  )}
                >
                  <section.icon aria-hidden className={cn('size-4 shrink-0', current ? 'text-icon-strong' : 'text-icon')} />
                  <span className="min-w-0">
                    <span className="block whitespace-nowrap">{section.title}</span>
                    <span className="hidden truncate text-xs font-normal text-fg-muted lg:block">{section.detail}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        </ScrollX>
      </nav>
      <div className="min-w-0">
        {active === 'general' ? <GeneralSection settings={settings} canEdit={canEdit} /> : null}
        {active === 'sites' ? <SitesSection canEdit={canEdit} /> : null}
        {active === 'job-types' ? <JobTypesSection canEdit={shell.can('job:manage')} /> : null}
        {active === 'labor' ? <LaborDefaultsSection settings={settings} canEdit={canEdit} /> : null}
        {active === 'cost-rules' ? <CostRulesSection settings={settings} canEdit={canEdit} /> : null}
        {active === 'people' ? (
          canRoles ? (
            <PeopleSection settings={settings} canEdit={canRoles} />
          ) : (
            <Panel title="People and roles">
              <p className="text-sm text-fg-secondary" data-testid="people-admin-only">
                Only an admin or the owner of this workspace can see who uses Pulse and change roles. Ask one of them if you need a different role or need to see money.
              </p>
            </Panel>
          )
        ) : null}
        {active === 'catalogs' ? <CatalogsSection canEdit={shell.can('job:manage')} seesMoney={shell.seesMoney} /> : null}
        {active === 'notifications' ? <NotificationsSection /> : null}
        {active === 'devices' ? <DevicesSection /> : null}
        {active === 'sample-data' ? <SampleDataSection initial={initialSample} canManage={canSample} /> : null}
        {active === 'danger' ? <DangerSection sample={initialSample} canManageSample={canSample} /> : null}
        {active === 'math' ? <MathSection /> : null}
      </div>
    </div>
  );
}
