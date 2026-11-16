import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Check } from 'lucide-react';
import { AppIcon } from '@kitstak/ui/app-icon';
import { isModule, type Module } from '@kitstak/entitlements';
import { requirePageSession } from '@/server/session';
import { getOrgOwner, listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { getOrgModuleStates } from '@/server/entitlements';
import { CheckoutGate } from '@/features/billing/checkout-gate';
import { Badge } from '@/components/ui';

export const metadata: Metadata = { title: 'Upgrade' };

interface UpgradeCopy {
  readonly name: string;
  readonly tagline: string;
  readonly features: readonly string[];
}

const UPGRADE_COPY: Readonly<Record<Module, UpgradeCopy>> = {
  crm: {
    name: 'KitStak CRM',
    tagline: 'Pipelines, boards and automations',
    features: [
      'Boards, pipelines and dashboards for every team',
      'Automations that run your follow-ups and hand-offs',
      'Contacts, companies and deal history in one place',
      'CSV import/export and public intake forms',
      'Members, teams and role-based permissions',
    ],
  },
  wms: {
    name: 'KitStak WMS',
    tagline: 'Warehouse operations',
    features: [
      'Receiving, putaway and license-plate inventory',
      'Waves, picking, packing and shipping stations',
      'Shipment and receipt orders with full audit trails',
      'Carrier setup, labels and tracking',
      'Client-scoped access for 3PL customers',
    ],
  },
  projects: {
    name: 'KitStak Projects',
    tagline: 'Projects, tasks and timelines',
    features: [
      'List, board, timeline, calendar and workload views',
      'Templates, goals, forms and automations',
      'Tasks linked to CRM deals and WMS orders',
      'Time tracking, comments and an inbox for every update',
      'Members, teams and role-based permissions',
    ],
  },
};

/**
 * The upsell page behind every locked module tile. No prices are shown (Stripe is
 * deferred) and "Proceed to checkout" opens the owner-contact gate, never a charge.
 */
export default async function UpgradePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await requirePageSession('/billing/upgrade');
  const moduleParam = typeof params.module === 'string' ? params.module : '';
  if (!isModule(moduleParam)) redirect('/billing');

  const orgs = await listUserOrgs(session.user.id);
  const activeOrg = await resolveActiveOrg(session, orgs);
  if (!activeOrg) redirect('/billing');

  const { modules } = await getOrgModuleStates(activeOrg.id);
  const state = modules.find((entry) => entry.module === moduleParam);
  // Already licensed (a real row, not the dev switch): nothing to upsell.
  if (state && (state.access === 'active' || state.access === 'trial' || state.access === 'grace')) {
    redirect('/billing');
  }

  const copy = UPGRADE_COPY[moduleParam];
  const owner = await getOrgOwner(activeOrg.id);
  const isOwner = activeOrg.role === 'owner';

  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-8">
      <div>
        <Link
          href="/billing"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-secondary hover:text-fg"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Billing
        </Link>
      </div>

      <header>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-11 items-center justify-center rounded-lg bg-sunken">
            <AppIcon app={moduleParam} size={40} />
          </span>
          <Badge tone="neutral">Not in your plan</Badge>
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-fg">
          Add {copy.name} to {activeOrg.name}
        </h1>
      </header>

      <section
        aria-label="What's included"
        className="rounded-xl border border-border-default bg-panel p-6 shadow-xs"
      >
        <h2 className="text-sm font-semibold tracking-[0.08em] text-fg-muted uppercase">
          What&rsquo;s included
        </h2>
        <ul className="mt-4 flex flex-col gap-3">
          {copy.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm text-fg">
              <span className="mt-0.5 inline-flex size-4.5 shrink-0 items-center justify-center rounded-full bg-success-subtle">
                <Check aria-hidden className="size-3 text-success-text" />
              </span>
              {feature}
            </li>
          ))}
        </ul>
        <p className="mt-5 border-t border-border-subtle pt-4 text-xs text-fg-muted">
          Per-organization licensing. Pricing is confirmed at checkout — no charge happens on this page.
        </p>
      </section>

      <CheckoutGate
        moduleName={copy.name}
        orgName={activeOrg.name}
        isOwner={isOwner}
        owner={owner}
      />
    </div>
  );
}
