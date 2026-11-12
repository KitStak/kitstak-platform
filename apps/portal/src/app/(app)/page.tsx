import type { Metadata } from 'next';
import type { Module } from '@kitstak/entitlements';
import { env } from '@/server/env';
import { requirePageSession } from '@/server/session';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { getOrgModuleStates } from '@/server/entitlements';
import { CreateOrgForm } from '@/features/launcher/create-org-form';
import { ProductTile } from '@/features/launcher/product-tile';
import { LogoMark } from '@/features/shell/logo';

export const metadata: Metadata = { title: 'Apps' };

interface ProductCopy {
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
}

const PRODUCTS: Readonly<Record<Module, ProductCopy>> = {
  crm: {
    name: 'KitStak CRM',
    tagline: 'Pipelines, boards and automations',
    description: 'Every deal, contact and next step on one board your whole revenue team trusts.',
  },
  wms: {
    name: 'KitStak WMS',
    tagline: 'Warehouse operations',
    description: 'Receiving, inventory, picking and shipping for high-volume fulfillment.',
  },
};

function productUrl(module: Module): string {
  return module === 'crm' ? env.NEXT_PUBLIC_CRM_URL : env.NEXT_PUBLIC_WMS_URL;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** The launcher: org-aware product tiles with live entitlement state (BLUEPRINT.md §6). */
export default async function LauncherPage() {
  const session = await requirePageSession('/');
  const orgs = await listUserOrgs(session.user.id);
  const activeOrg = await resolveActiveOrg(session, orgs);

  if (!activeOrg) {
    return (
      <section className="flex flex-col items-center py-20 text-center">
        <LogoMark size={40} />
        <h1 className="mt-8 text-2xl font-semibold tracking-[-0.02em] text-fg">Create your organization</h1>
        <p className="mt-2 max-w-md text-md text-fg-secondary">
          You’re signed in, but you don’t belong to an organization yet. Create one to start using KitStak —
          or ask a teammate for an invitation.
        </p>
        <div className="mt-8 flex w-full justify-center">
          <CreateOrgForm />
        </div>
      </section>
    );
  }

  const { devAllowAll, modules } = await getOrgModuleStates(activeOrg.id);

  return (
    <div className="flex flex-col gap-10">
      <section>
        <p className="text-sm font-medium text-fg-muted">{activeOrg.name}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-fg">
          Good to see you, {firstName(session.user.name)}
        </h1>
        <p className="mt-2 max-w-xl text-md text-fg-secondary">
          Pick an app to open. Your session carries over — no second sign-in.
        </p>
      </section>

      <section aria-label="Your apps" className="grid gap-5 sm:grid-cols-2">
        {modules.map((state) => {
          const copy = PRODUCTS[state.module];
          return (
            <ProductTile
              key={state.module}
              module={state.module}
              name={copy.name}
              tagline={copy.tagline}
              description={copy.description}
              href={productUrl(state.module)}
              entitled={state.entitled}
              access={state.access}
              periodEnd={state.entitlement?.periodEnd ?? null}
            />
          );
        })}
      </section>

      {devAllowAll ? (
        <p className="rounded-lg border border-info/25 bg-info-subtle px-4 py-3 text-sm text-info-text">
          Development mode: <code className="font-semibold">ENTITLEMENTS_DEV_ALLOW_ALL=1</code> grants every
          module. Production requires explicit entitlements — see Billing.
        </p>
      ) : null}
    </div>
  );
}
