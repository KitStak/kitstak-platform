import 'server-only';
import { Building2 } from 'lucide-react';
import { Page } from '@/components/layout/page';
import { BlockedPage } from '@/features/people/blocked';
import { getAgency, listAgencies } from '@/server/domain/agencies';
import { isDomainError } from '@/server/errors';
import { pageFor } from '@/server/page';
import { routes } from '@/lib/routes';
import { AgenciesView } from './agencies-view';
import { AgencyView } from './agency-view';

/** `/people/agencies` (docs/crew/SPEC.md 6.1): the temp agencies, each one shared vendor. */
export async function AgenciesPage() {
  const { ctx, can, locked, access } = await pageFor('/people/agencies');
  if (locked) return null;
  if (!can('person:manage')) return <BlockedPage title="Agencies" role={access.role} />;
  const agencies = await listAgencies(ctx);
  return (
    <Page title="Agencies" breadcrumbs={[{ label: 'People', href: routes.people() }, { label: 'Agencies' }]} icon={<Building2 aria-hidden className="size-6 text-icon" />} subtitle="The temp agencies that send you people. Each one is a shared vendor, the same one Ledger pays.">
      <AgenciesView agencies={agencies} />
    </Page>
  );
}

/** `/people/agencies/[vendorId]`: contact, people, links and pending submissions. */
export async function AgencyPage({ vendorId }: { readonly vendorId: string }) {
  const { ctx, can, locked, access, context } = await pageFor(routes.agency(vendorId));
  if (locked) return null;
  if (!can('person:manage')) return <BlockedPage title="Agency" role={access.role} />;
  let detail;
  try {
    detail = await getAgency(ctx, vendorId);
  } catch (error) {
    if (isDomainError(error) && error.code === 'NOT_FOUND') return <BlockedPage title="Agency" role={access.role} />;
    throw error;
  }
  void context;
  return (
    <Page title={detail.agency.name} breadcrumbs={[{ label: 'People', href: routes.people() }, { label: 'Agencies', href: routes.agencies() }, { label: detail.agency.name }]} icon={<Building2 aria-hidden className="size-6 text-icon" />} subtitle={`${detail.agency.activePeople} active ${detail.agency.activePeople === 1 ? 'person' : 'people'}. Approved hours per week arrive with phase 4.`}>
      <AgencyView detail={detail} />
    </Page>
  );
}
