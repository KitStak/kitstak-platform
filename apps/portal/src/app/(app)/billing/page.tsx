import type { Metadata } from 'next';
import { AppMark } from '@/features/launcher/app-mark';
import { CreditCard } from 'lucide-react';
import { isModule } from '@kitstak/entitlements';
import { requirePageSession } from '@/server/session';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { getOrgModuleStates } from '@/server/entitlements';
import { Badge } from '@/components/ui';
import type { ModuleAccess } from '@/server/entitlements';

export const metadata: Metadata = { title: 'Billing' };

const MODULE_NAMES: Readonly<Record<string, string>> = {
  crm: 'KitStak CRM',
  wms: 'KitStak WMS',
  projects: 'KitStak Projects',
};

const STATUS_BADGE: Readonly<
  Record<ModuleAccess, { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' }>
> = {
  active: { label: 'Active', tone: 'success' },
  trial: { label: 'Trial', tone: 'info' },
  grace: { label: 'Past due, in grace', tone: 'warning' },
  dev: { label: 'Dev access', tone: 'info' },
  locked: { label: 'Not enabled', tone: 'neutral' },
};

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Production-shaped period-end copy: a real date, or an honest reason there is none. */
function periodEndLabel(source: string | undefined): string {
  if (source === 'manual') return 'Manual grant, no renewal';
  if (source === 'trial') return 'Trial, no end date set';
  if (source === 'stripe') return 'No renewal date on file';
  return 'No subscription';
}

/** Friendly names for access sources (never show the raw value). */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  manual: 'Manual grant',
  trial: 'Trial',
  stripe: 'Stripe',
};

function sourceLabel(source: string | undefined, access: ModuleAccess): string {
  if (source) return SOURCE_LABELS[source] ?? 'Other';
  return access === 'dev' ? 'Dev override' : 'None';
}

/**
 * Honest billing stub (owner decision: Stripe is deferred). Shows the org's real
 * entitlement rows and points at the administrator — no fake checkout.
 */
export default async function BillingPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await requirePageSession('/billing');
  const orgs = await listUserOrgs(session.user.id);
  const activeOrg = await resolveActiveOrg(session, orgs);

  const requested = typeof params.module === 'string' && isModule(params.module) ? params.module : null;

  if (!activeOrg) {
    return (
      <section className="py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">Billing</h1>
        <p className="mt-2 text-md text-fg-secondary">Join or create an organization to see its plan.</p>
      </section>
    );
  }

  const { devAllowAll, modules } = await getOrgModuleStates(activeOrg.id);

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-8">
      <header>
        <p className="text-sm font-medium text-fg-muted">{activeOrg.name}</p>
        <h1 className="mt-1 flex items-center gap-2.5 text-2xl font-semibold tracking-[-0.02em] text-fg">
          Billing
          {devAllowAll ? (
            <Badge
              tone="info"
              title="Development override is on. Every module opens on this environment regardless of plan status."
            >
              Dev override
            </Badge>
          ) : null}
        </h1>
        <p className="mt-2 text-md text-fg-secondary">The modules your organization can run today.</p>
      </header>

      {requested ? (
        <div
          role="status"
          className="rounded-lg border border-warning/25 bg-warning-subtle px-4 py-3 text-sm text-warning-text"
        >
          <span className="font-semibold">{MODULE_NAMES[requested]}</span> isn’t enabled for {activeOrg.name}.
          Your administrator can arrange access. See below.
        </div>
      ) : null}

      <section
        aria-label="Module access"
        className="overflow-hidden rounded-xl border border-border-default bg-panel shadow-xs"
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-subtle bg-sunken text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">
              <th scope="col" className="px-5 py-3">
                Module
              </th>
              <th scope="col" className="px-5 py-3">
                Status
              </th>
              <th scope="col" className="px-5 py-3">
                Source
              </th>
              <th scope="col" className="px-5 py-3">
                Period end
              </th>
            </tr>
          </thead>
          <tbody>
            {modules.map((state) => {
              const badge = STATUS_BADGE[state.access];
              return (
                <tr key={state.module} className="border-b border-border-subtle last:border-b-0">
                  <td className="px-5 py-4 font-medium text-fg">
                    <span className="flex items-center gap-3">
                      <AppMark module={state.module} locked={!state.entitled} className="size-8" />
                      {MODULE_NAMES[state.module]}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </td>
                  <td className="px-5 py-4 text-fg-secondary">
                    {sourceLabel(state.entitlement?.source, state.access)}
                  </td>
                  <td className="px-5 py-4 text-fg-secondary">
                    {state.entitlement?.periodEnd ? (
                      dateFormat.format(state.entitlement.periodEnd)
                    ) : (
                      <span className="text-fg-muted">{periodEndLabel(state.entitlement?.source)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="flex items-start gap-4 rounded-xl border border-border-default bg-panel p-6 shadow-xs">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-sunken text-icon">
          <CreditCard aria-hidden className="size-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-fg">Online billing coming soon</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            Self-serve checkout and plan management aren’t available yet. To enable or change modules for{' '}
            {activeOrg.name}, contact your administrator.
          </p>
        </div>
      </section>
    </div>
  );
}
