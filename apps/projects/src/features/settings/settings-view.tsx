'use client';
/**
 * Settings: Profile (name, password, notifications), Appearance, Workspace (spaces), Integrations
 * (Portal / CRM / WMS) and Keyboard shortcuts. URL: /settings?section=<id>.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Blocks, Building2, CalendarDays, Keyboard, Palette, UserRound } from 'lucide-react';
import { routes } from '@/lib/routes';
import { cn } from '@/components/ui';
import { Page } from '@/components/layout/page';
import type { NotificationKind } from '@/lib/constants';
import type { SpaceDTO } from '@/lib/types';
import type { IntegrationLinkSummary } from '@/server/domain/integration-summary';
import { AppearanceSection } from './appearance-section';
import { IntegrationsSection } from './integrations-section';
import { ProfileSection, type EmailDigest } from './profile-section';
import { ShortcutsSection } from './shortcuts-section';
import { WorkspaceSection } from './workspace-section';

export type SettingsSectionId = 'profile' | 'appearance' | 'workspace' | 'integrations' | 'shortcuts';

const SECTIONS: readonly { id: SettingsSectionId; label: string; hint: string; icon: ReactNode }[] = [
  {
    id: 'profile',
    label: 'Profile',
    hint: 'Name, password, notifications',
    icon: <UserRound aria-hidden className="size-4" />,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    hint: 'Light or dark, sidebar size',
    icon: <Palette aria-hidden className="size-4" />,
  },
  {
    id: 'workspace',
    label: 'Workspace',
    hint: 'Plan, spaces and people',
    icon: <Building2 aria-hidden className="size-4" />,
  },
  {
    id: 'integrations',
    label: 'Integrations',
    hint: 'Portal, CRM and WMS',
    icon: <Blocks aria-hidden className="size-4" />,
  },
  {
    id: 'shortcuts',
    label: 'Keyboard shortcuts',
    hint: 'Work without the mouse',
    icon: <Keyboard aria-hidden className="size-4" />,
  },
];

export function SettingsView({
  spaces,
  notificationPrefs,
  emailDigest,
  integrationSummary,
  planCard = null,
}: {
  readonly spaces: SpaceDTO[];
  readonly notificationPrefs: Partial<Record<NotificationKind, boolean>>;
  readonly emailDigest: EmailDigest;
  readonly integrationSummary: IntegrationLinkSummary;
  /** The "Plan and payment" row, rendered on the server from `@kitstak/billing`. */
  readonly planCard?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '/settings';
  const params = useSearchParams();
  const raw = params?.get('section');
  const section: SettingsSectionId = SECTIONS.some((s) => s.id === raw)
    ? (raw as SettingsSectionId)
    : 'profile';
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const go = (id: SettingsSectionId) =>
    router.replace(id === 'profile' ? pathname : `${pathname}?section=${id}`, { scroll: false });

  return (
    <Page title="Settings">
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <nav aria-label="Settings sections" className="md:sticky md:top-4 md:w-60 md:shrink-0">
          <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 max-md:pr-6 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-32px),transparent)] md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
            {SECTIONS.map((item) => {
              const active = item.id === section;
              return (
                <li key={item.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => go(item.id)}
                    aria-current={active ? 'page' : undefined}
                    data-testid={`settings-nav-${item.id}`}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                      active ? 'bg-selected font-medium text-primary-text' : 'text-fg hover:bg-hover',
                    )}
                  >
                    <span className={cn('shrink-0', active ? 'text-primary-text' : 'text-icon')}>
                      {item.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap">{item.label}</span>
                      <span className="hidden truncate text-xs font-normal text-fg-muted md:block">
                        {item.hint}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            <li className="shrink-0">
              <Link
                href={routes.calendarSettings()}
                data-testid="settings-nav-calendar"
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-fg transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
              >
                <span className="shrink-0 text-icon">
                  <CalendarDays aria-hidden className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block whitespace-nowrap">Work calendar</span>
                  <span className="hidden truncate text-xs font-normal text-fg-muted md:block">Work days, holidays, capacity</span>
                </span>
              </Link>
            </li>
          </ul>
        </nav>
        <section className="min-w-0 flex-1" aria-labelledby="settings-section-title">
          <h2 id="settings-section-title" className="mb-4 text-lg font-semibold text-fg">
            {current.label}
          </h2>
          {section === 'profile' ? <ProfileSection notificationPrefs={notificationPrefs} emailDigest={emailDigest} /> : null}
          {section === 'appearance' ? <AppearanceSection /> : null}
          {section === 'workspace' ? (
            <div className="flex flex-col gap-5">
              {planCard}
              <WorkspaceSection spaces={spaces} />
            </div>
          ) : null}
          {section === 'integrations' ? <IntegrationsSection summary={integrationSummary} /> : null}
          {section === 'shortcuts' ? <ShortcutsSection /> : null}
        </section>
      </div>
    </Page>
  );
}
