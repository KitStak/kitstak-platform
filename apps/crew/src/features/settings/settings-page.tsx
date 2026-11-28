import 'server-only';
import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { BlockedPage } from '@/features/people/blocked';
import { listLaborClasses } from '@/server/domain/labor-classes';
import { listRoles } from '@/server/domain/roles';
import { loadSettings } from '@/server/domain/settings';
import { listSitesWithAreas } from '@/server/domain/sites';
import { pageFor } from '@/server/page';
import { arrivesIn } from '@/lib/pages';
import { assignableRoles } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { ClassesPanel } from './classes-panel';
import { GeneralPanel } from './general-panel';
import { RolesPanel } from './roles-panel';
import { SitesPanel } from './sites-panel';

const LATER = [
  { title: 'Labor rules', href: routes.settingsRules(), phase: 3 as const },
  { title: 'Time clocks', href: routes.settingsKiosks(), phase: 3 as const },
  { title: 'Phone clock and fence', href: null, phase: 3 as const },
  { title: 'Time off types', href: null, phase: 5 as const },
  { title: 'Schedule notices', href: null, phase: 2 as const },
  { title: 'Connected apps', href: routes.settingsApps(), phase: 8 as const },
];

/** `/settings` (docs/crew/SPEC.md 6.1): General, Sites and areas, Labor classes, People and roles. */
export async function SettingsPage() {
  const { ctx, can, locked, access } = await pageFor('/settings');
  if (locked) return null;
  if (!can('settings:manage')) return <BlockedPage title="Settings" role={access.role} />;
  const [settings, sites, classes, members] = await Promise.all([loadSettings(ctx.orgId), listSitesWithAreas(ctx), listLaborClasses(ctx), can('roles:manage') ? listRoles(ctx) : Promise.resolve([])]);
  return (
    <Page title="Settings" icon={<Settings2 aria-hidden className="size-6 text-icon" />} subtitle="Set Crew up for how your floor works.">
      <div className="flex flex-col gap-4">
        <GeneralPanel
          settings={{ weekStart: settings.weekStart, pinLength: settings.pinLength === 6 ? 6 : 4, numberPrefixTemp: settings.numberPrefixTemp, defaultMemberRole: settings.defaultMemberRole, defaultTimezone: settings.defaultTimezone, agencyLinks: settings.agencyLinks }}
        />
        <SitesPanel sites={sites} />
        <ClassesPanel classes={classes} />
        {can('roles:manage') ? (
          <RolesPanel
            members={members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, orgRole: m.orgRole, role: m.access.role, siteIds: m.access.siteIds ? [...m.access.siteIds] : null, source: m.access.source }))}
            sites={sites.map((site) => ({ value: site.id, label: site.name }))}
            assignable={[...assignableRoles(access.role)]}
            me={ctx.userId}
          />
        ) : null}
        <Panel title="More settings">
          <ul className="grid gap-2 sm:grid-cols-3">
            {LATER.map((entry) => (
              <li key={entry.title} className="rounded-lg border border-border-subtle bg-sunken p-3">
                {entry.href ? (
                  <Link href={entry.href} className="text-sm font-medium text-fg-link hover:underline">
                    {entry.title}
                  </Link>
                ) : (
                  <p className="text-sm font-medium text-fg">{entry.title}</p>
                )}
                <p className="text-xs text-fg-muted">{arrivesIn(entry.phase)}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </Page>
  );
}
