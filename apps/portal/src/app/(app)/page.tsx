import type { Metadata } from 'next';
import { after } from 'next/server';
import { CalendarDays, ClipboardPen, CreditCard, FolderKanban, LayoutGrid, ListChecks, Package, PackagePlus, Plus, Settings2, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { Module } from '@kitstak/entitlements';
import { env } from '@/server/env';
import { requirePageSession } from '@/server/session';
import { getOrgGlance, listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { getOrgModuleStates } from '@/server/entitlements';
import { getCustomerWork, getLauncherStats, getPulseAttention } from '@/server/product-stats';
import { CustomerWorkPanel } from '@/features/launcher/customer-work';
import { PulseAttentionPanel } from '@/features/launcher/pulse-attention';
import { getSetupState, markGuideSeen } from '@/server/onboarding';
import { CreateOrgForm } from '@/features/launcher/create-org-form';
import { ProductTile } from '@/features/launcher/product-tile';
import { SetupGuide } from '@/features/setup/setup-guide';
import { LogoMark } from '@/features/shell/logo';
import { Badge, cn } from '@/components/ui';

export const metadata: Metadata = { title: 'Apps' };

interface ProductCopy {
  readonly name: string;
  readonly tagline: string;
}

const PRODUCTS: Readonly<Record<Module, ProductCopy>> = {
  crm: {
    name: 'KitStak CRM',
    tagline: 'Pipelines, boards and automations',
  },
  wms: {
    name: 'KitStak WMS',
    tagline: 'Warehouse operations',
  },
  projects: {
    name: 'KitStak Projects',
    tagline: 'Projects, tasks and timelines',
  },
  pulse: {
    name: 'KitStak Pulse',
    tagline: 'Know which jobs make money',
  },
};

function productUrl(module: Module): string {
  switch (module) {
    case 'crm':
      return env.NEXT_PUBLIC_CRM_URL;
    case 'wms':
      return env.NEXT_PUBLIC_WMS_URL;
    case 'projects':
      return env.NEXT_PUBLIC_PROJECTS_URL;
    case 'pulse':
      return env.NEXT_PUBLIC_PULSE_URL;
  }
}

/** Where the tile's empty-state CTA deep-links: straight to the screen that creates the first record. */
function emptyStateUrl(module: Module, orgSlug: string): string {
  switch (module) {
    case 'crm':
      return `${env.NEXT_PUBLIC_CRM_URL}/${orgSlug}/crm/pipeline`;
    case 'wms':
      return `${env.NEXT_PUBLIC_WMS_URL}/orders`;
    case 'projects':
      return `${env.NEXT_PUBLIC_PROJECTS_URL}/projects/new`;
    case 'pulse':
      return `${env.NEXT_PUBLIC_PULSE_URL}/jobs/new`;
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

interface QuickLink {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly external: boolean;
}

const glanceDateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });

interface GlanceItem {
  readonly label: string;
  readonly value: string;
  readonly icon: LucideIcon;
}

function GlanceCell({ item }: { readonly item: GlanceItem }) {
  const Icon = item.icon;
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sunken">
        <Icon aria-hidden className="size-4 text-icon" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-md font-semibold text-fg tabular-nums">{item.value}</span>
        <span className="text-xs text-fg-muted">{item.label}</span>
      </div>
    </div>
  );
}

function QuickLinkChip({ link }: { readonly link: QuickLink }) {
  const Icon = link.icon;
  const className = cn(
    'inline-flex h-9 items-center gap-2 rounded-lg border border-border-default bg-panel px-3',
    'text-sm font-medium text-fg-secondary shadow-xs',
    'transition-colors duration-[var(--duration-fast)] hover:border-border-strong hover:text-fg',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
  );
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener" className={className}>
        <Icon aria-hidden className="size-4 text-icon" />
        {link.label}
      </a>
    );
  }
  return (
    <Link href={link.href} className={className}>
      <Icon aria-hidden className="size-4 text-icon" />
      {link.label}
    </Link>
  );
}

/** The launcher: org-aware product tiles with live operational signal (BLUEPRINT.md §6). */
export default async function LauncherPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePageSession('/');
  const orgs = await listUserOrgs(session.user.id);
  const activeOrg = await resolveActiveOrg(session, orgs);

  if (!activeOrg) {
    return (
      <section className="flex flex-col items-center py-20 text-center">
        <LogoMark size={40} />
        <h1 className="mt-8 text-2xl font-semibold tracking-[-0.02em] text-fg">Create your organization</h1>
        <p className="mt-2 max-w-md text-md text-fg-secondary">
          You’re not in an organization yet. Create one, or ask a teammate for an invitation.
        </p>
        <div className="mt-8 flex w-full justify-center">
          <CreateOrgForm />
        </div>
      </section>
    );
  }

  const [{ devAllowAll, modules }, stats, customerWork, pulseAttention, glance, setup, params] = await Promise.all([
    getOrgModuleStates(activeOrg.id),
    getLauncherStats(activeOrg.id, session.user.id),
    getCustomerWork(activeOrg.id),
    getPulseAttention(activeOrg.id, session.user.id),
    getOrgGlance(activeOrg.id),
    getSetupState(activeOrg),
    searchParams,
  ]);
  const canManageSetup = activeOrg.role === 'owner' || activeOrg.role === 'admin';
  const forceSetupGuide = params.setup === '1';
  // Rollout guard (ONBOARDING.md): an org that was already fully set up before ever
  // seeing the guide never gets a surprise card or celebration.
  const showSetupGuide =
    forceSetupGuide || (!setup.dismissed && (!setup.summary.allDone || setup.seen));
  if (showSetupGuide && !setup.summary.allDone && !setup.seen) {
    after(() => markGuideSeen(activeOrg.id));
  }
  const entitledFor = (module: Module): boolean =>
    modules.find((state) => state.module === module)?.entitled ?? false;

  const quickLinks: readonly QuickLink[] = [
    ...(entitledFor('crm')
      ? [
          {
            label: 'New deal',
            href: `${env.NEXT_PUBLIC_CRM_URL}/${activeOrg.slug}/crm/pipeline`,
            icon: Plus,
            external: true,
          },
        ]
      : []),
    ...(entitledFor('wms')
      ? [{ label: 'Orders', href: `${env.NEXT_PUBLIC_WMS_URL}/orders`, icon: Package, external: true }]
      : []),
    ...(entitledFor('projects')
      ? [
          { label: 'New project', href: `${env.NEXT_PUBLIC_PROJECTS_URL}/projects/new`, icon: FolderKanban, external: true },
          { label: 'My work', href: `${env.NEXT_PUBLIC_PROJECTS_URL}/my-work`, icon: ListChecks, external: true },
        ]
      : []),
    ...(entitledFor('pulse')
      ? [
          { label: 'New job', href: `${env.NEXT_PUBLIC_PULSE_URL}/jobs/new`, icon: PackagePlus, external: true },
          { label: 'Log work', href: `${env.NEXT_PUBLIC_PULSE_URL}/log`, icon: ClipboardPen, external: true },
        ]
      : []),
    { label: 'Billing', href: '/billing', icon: CreditCard, external: false },
    { label: 'Org settings', href: '/settings/organization', icon: Settings2, external: false },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <section>
        <p className="text-sm font-medium text-fg-muted">{activeOrg.name}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-fg">
          Good to see you, {firstName(session.user.name)}
        </h1>
      </section>

      {showSetupGuide ? (
        <SetupGuide orgName={activeOrg.name} state={setup} canManage={canManageSetup} />
      ) : null}

      <section aria-label="Your apps" className="grid gap-4 sm:grid-cols-2">
        {modules.map((state, index) => {
          const copy = PRODUCTS[state.module];
          // An odd last tile spans the row so the grid never ends on a lonely half-width card.
          const spanRow = modules.length % 2 === 1 && index === modules.length - 1;
          return (
            <ProductTile
              key={state.module}
              className={spanRow ? 'sm:col-span-2' : undefined}
              module={state.module}
              name={copy.name}
              tagline={copy.tagline}
              href={productUrl(state.module)}
              entitled={state.entitled}
              access={state.access}
              periodEnd={state.entitlement?.periodEnd ?? null}
              stats={stats[state.module]}
              emptyStateHref={emptyStateUrl(state.module, activeOrg.slug)}
            />
          );
        })}
      </section>

      {entitledFor('pulse') && pulseAttention ? (
        <PulseAttentionPanel attention={pulseAttention} pulseUrl={env.NEXT_PUBLIC_PULSE_URL} />
      ) : null}

      {entitledFor('projects') ? (
        <CustomerWorkPanel rows={customerWork} projectsUrl={env.NEXT_PUBLIC_PROJECTS_URL} />
      ) : null}

      <section aria-label="Quick links">
        <h2 className="text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">Quick links</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {quickLinks.map((link) => (
            <QuickLinkChip key={link.label} link={link} />
          ))}
        </div>
      </section>

      {glance ? (
        <section aria-label="Organization at a glance">
          <h2 className="text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">
            {activeOrg.name} at a glance
          </h2>
          <div className="mt-3 grid grid-cols-1 divide-y divide-border-subtle rounded-xl border border-border-default bg-panel shadow-xs sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <GlanceCell
              item={{
                label: glance.memberCount === 1 ? 'Member' : 'Members',
                value: String(glance.memberCount),
                icon: Users,
              }}
            />
            <GlanceCell
              item={{
                // Counts the licensed apps (CRM, WMS, Projects, Pulse); the Portal itself is always on.
                label: 'Apps on your plan',
                value: `${modules.filter((state) => state.entitled).length} of ${modules.length} apps`,
                icon: LayoutGrid,
              }}
            />
            <GlanceCell
              item={{
                label: 'Org created',
                value: glanceDateFormat.format(glance.createdAt),
                icon: CalendarDays,
              }}
            />
          </div>
        </section>
      ) : null}

      {devAllowAll ? (
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <Badge tone="info">Dev</Badge>
          Every module is unlocked on this environment. In production, access follows your plan.
        </p>
      ) : null}
    </div>
  );
}
