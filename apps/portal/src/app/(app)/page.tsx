import type { Metadata } from 'next';
import { after } from 'next/server';
import { CalendarDays, ClipboardPen, CreditCard, FolderKanban, LayoutGrid, ListChecks, Package, PackagePlus, Plus, Settings2, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Module } from '@kitstak/entitlements';
import { env } from '@/server/env';
import { requirePageSession } from '@/server/session';
import { getOrgGlance, listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { CATALOG, formatDayShort } from '@kitstak/billing/catalog';
import { getBillingContext } from '@/server/billing/context';
import { getOrgPlan, type ModuleState } from '@/server/entitlements';
import { addAppPriceNote, plural, viewOnlyFix } from '@/features/billing/format';
import { getCustomerWork, getLauncherStats, getPulseAttention } from '@/server/product-stats';
import { CustomerWorkPanel } from '@/features/launcher/customer-work';
import { PulseAttentionPanel } from '@/features/launcher/pulse-attention';
import { getSetupState, markGuideSeen } from '@/server/onboarding';
import { CreateOrgForm } from '@/features/launcher/create-org-form';
import { ProductTile } from '@/features/launcher/product-tile';
import { SetupGuide } from '@/features/setup/setup-guide';
import { LogoMark } from '@/features/shell/logo';
import { AppIcon } from '@kitstak/ui/app-icon';
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

  // A person who only manages billing has no apps to open (review round 2). Billing is their home.
  if (activeOrg.role === 'billing') redirect('/billing');

  // The billing context is cached per request: the setup guide needs it to know who may pay.
  const billing = await getBillingContext();
  const [{ devAllowAll, modules, state: plan }, stats, customerWork, pulseAttention, glance, setup, params] = await Promise.all([
    getOrgPlan(activeOrg.id),
    getLauncherStats(activeOrg.id, session.user.id),
    getCustomerWork(activeOrg.id),
    getPulseAttention(activeOrg.id, session.user.id),
    getOrgGlance(activeOrg.id),
    getSetupState(activeOrg, { timeZone: billing?.timeZone, canManageBilling: billing?.access.canManage ?? false }),
    searchParams,
  ]);
  const canManageSetup = activeOrg.role === 'owner' || activeOrg.role === 'admin';
  const forceSetupGuide = params.setup === '1';
  // Rollout guard (ONBOARDING.md): an org that was already fully set up before ever
  // seeing the guide never gets a surprise card or celebration. The guide on the launcher is the
  // quick start (3 to 5 steps), so "set up" means those steps.
  const showSetupGuide =
    forceSetupGuide || (!setup.dismissed && (!setup.quick.summary.allDone || setup.seen));
  if (showSetupGuide && !setup.quick.summary.allDone && !setup.seen) {
    after(() => markGuideSeen(activeOrg.id));
  }
  const entitledFor = (module: Module): boolean =>
    modules.find((state) => state.module === module)?.entitled ?? false;

  // Plan words on each tile (docs/billing/SPEC.md 9.5). The same PlanState drives billing home.
  const access = billing?.access ?? null;
  const timeZone = billing?.timeZone ?? 'UTC';
  const mayAdd =
    access !== null && (access.canManage || (access.canStartTrial && (plan.phase === 'trial' || plan.phase === 'none')));
  const askWho = access?.ownerName ?? 'your organization owner';
  const planNoteFor = (state: ModuleState): string | null => {
    switch (state.badge) {
      case 'trial':
        if (!plan.trial) return null;
        return plan.phase === 'active'
          ? `Free trial. First payment on ${formatDayShort(plan.nextCharge?.at ?? plan.trial.endsAt, timeZone)}.`
          : `${plural(plan.trial.daysLeft, 'day', 'days')} left in your free trial`;
      case 'past_due':
        return plan.pastDue ? `Payment due. Open until ${formatDayShort(plan.pastDue.accessChangesAt, timeZone)}.` : 'Payment due';
      case 'view_only':
        // The same fix the plan banner names for this state ("Pick a plan", "Update card", "Start again now").
        return access?.canView ? `View only. ${viewOnlyFix(plan.phase)}` : `View only. Ask ${askWho} to pick a plan.`;
      case 'not_in_plan':
        return mayAdd ? addAppPriceNote(plan, state.module) : `Ask ${askWho} to add it.`;
      case 'included':
      case 'active':
        return null;
    }
  };
  const addActionFor = (state: ModuleState) =>
    state.badge === 'not_in_plan' && mayAdd
      ? {
          label: plan.phase === 'none' && plan.trialEligible ? 'Start free trial' : plan.phase === 'trial' ? `Add ${CATALOG.products[state.module].shortName}` : 'Add to plan',
          href: `/billing/plan?add=${state.module}`,
        }
      : null;

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

  const ownTiles = modules.filter((state) => state.badge !== 'not_in_plan');
  const moreTiles = modules.filter((state) => state.badge === 'not_in_plan');
  const renderTile = (state: ModuleState, index: number, count: number) => {
    const copy = PRODUCTS[state.module];
    // An odd last tile spans the row so the grid never ends on a lonely half-width card.
    const spanRow = count % 2 === 1 && index === count - 1;
    return (
      <ProductTile
        key={state.module}
        className={spanRow ? 'sm:col-span-2' : undefined}
        module={state.module}
        name={copy.name}
        tagline={copy.tagline}
        href={productUrl(state.module)}
        entitled={state.entitled}
        badge={state.badge}
        planNote={planNoteFor(state)}
        addAction={addActionFor(state)}
        stats={stats[state.module]}
        emptyStateHref={emptyStateUrl(state.module, activeOrg.slug)}
      />
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <section className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-muted">{activeOrg.name}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-fg">
            Good to see you, {firstName(session.user.name)}
          </h1>
        </div>
        {/*
          The apps this person has, one press away at the very top, above the setup guide. On a
          laptop and on a phone the app they signed up for is on the first screen, whatever the
          guide and the banners above the tiles take.
        */}
        {ownTiles.length > 0 ? (
          <nav aria-label="Open an app" data-testid="launcher-open" className="flex flex-wrap gap-2">
            {ownTiles.map((state) => (
              <a
                key={state.module}
                href={productUrl(state.module)}
                target="_blank"
                rel="noopener"
                data-testid={`launcher-open-${state.module}`}
                className={cn(
                  'inline-flex h-10 items-center gap-2 rounded-lg border border-border-default bg-panel pr-3.5 pl-2 text-sm font-semibold text-fg shadow-xs pointer-coarse:h-11',
                  'transition-colors duration-[var(--duration-fast)] hover:border-border-strong hover:bg-muted',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                )}
              >
                <AppIcon app={state.module} size={22} />
                Open {CATALOG.products[state.module].shortName}
              </a>
            ))}
          </nav>
        ) : null}
      </section>

      {showSetupGuide ? (
        <SetupGuide orgName={activeOrg.name} state={setup} canManage={canManageSetup} />
      ) : null}

      {/*
        The apps this organization has (in its trial or its plan) come first, so the app a person
        signed up for is on the first screen under the guide, also on a phone. The rest sit below
        under "More apps", each with its price. An organization with no plan yet sees all four.
      */}
      <section aria-label="Your apps" data-testid="launcher-apps" className="grid gap-4 sm:grid-cols-2">
        {(ownTiles.length > 0 ? ownTiles : moreTiles).map((state, index, list) => renderTile(state, index, list.length))}
      </section>

      {ownTiles.length > 0 && moreTiles.length > 0 ? (
        <section aria-labelledby="more-apps-heading" data-testid="launcher-more-apps">
          <h2 id="more-apps-heading" className="text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">
            More apps
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">{moreTiles.map((state, index, list) => renderTile(state, index, list.length))}</div>
        </section>
      ) : null}

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
          Every app is open on this environment. In production, access follows your plan.
        </p>
      ) : null}
    </div>
  );
}
