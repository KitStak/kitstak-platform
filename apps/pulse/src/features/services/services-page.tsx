import { notFound } from 'next/navigation';
import { FileSpreadsheet, SearchX } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import type { VasServiceDTO } from '@/lib/types';
import { getSettings, getVasService, listSites, listVasServices, todayInZone } from '@/server/domain';
import { isDomainError } from '@/server/errors';
import { pulsePage, type PulsePage } from '@/server/page';
import { ServiceView } from './service-view';
import { ServicesView } from './services-view';

const crumbs = [{ label: 'Profit', href: routes.profit() }, { label: 'Extra services', href: routes.services() }];

async function clock(page: PulsePage): Promise<{ today: string; weekStart: number; targetMarginBp: number }> {
  const [settings, sites] = await Promise.all([getSettings(page.ctx).catch(() => undefined), listSites(page.ctx).catch(() => undefined)]);
  const site = sites?.find((item) => item.isDefault) ?? sites?.[0];
  return { today: site?.today ?? todayInZone(settings?.timezone ?? 'UTC'), weekStart: settings?.weekStart ?? 1, targetMarginBp: settings?.defaultTargetMarginBp ?? 3000 };
}

/** Extra services: the catalog (price, standard cost, target pace) and profit by service, with the underpriced ones flagged. */
export async function ServicesPage() {
  const page = await pulsePage(routes.services(), 'profit');
  if (page.blocked || !page.access.seesMoney) return <PageBlocked title="Extra services" role={page.access.role} />;
  const canManage = page.can('vas:manage');
  const [services, time] = await Promise.all([listVasServices(page.ctx, { includeInactive: true }).catch(() => undefined), clock(page)]);
  return (
    <Page
      title="Extra services"
      subtitle="The billable extras around a job, each with its own price, cost and margin."
      width="full"
      breadcrumbs={[crumbs[0]!, { label: 'Extra services' }]}
      actions={
        page.can('import:run') ? (
          <ButtonLink href={routes.newImport('services')} variant="secondary" icon={<FileSpreadsheet aria-hidden />} className="hidden sm:inline-flex">
            Import services
          </ButtonLink>
        ) : null
      }
    >
      <ServicesView initialServices={services} {...time} canManage={canManage} canImport={page.can('import:run')} orgSlug={page.context.org.slug} />
    </Page>
  );
}

/** One extra service: its numbers, price against standard cost, the clients using it and its entries. */
export async function ServicePage({ params }: { readonly params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const page = await pulsePage(routes.service(id), 'profit');
  if (page.blocked || !page.access.seesMoney) return <PageBlocked title="Extra service" role={page.access.role} />;
  let service: VasServiceDTO | null = null;
  try {
    service = await getVasService(page.ctx, id);
  } catch (error) {
    if (isDomainError(error) && error.code === 'NOT_FOUND') notFound();
  }
  if (!service) {
    return (
      <Page title="Extra service" breadcrumbs={[...crumbs, { label: 'Service' }]}>
        <Panel>
          <Teach testId="service-load-failed" icon={SearchX} title="We could not load this service" why="Something went wrong on our side while reading this service. Your data is safe. Go back to the list and open it again." actions={<ButtonLink href={routes.services()}>See all extra services</ButtonLink>} />
        </Panel>
      </Page>
    );
  }
  const time = await clock(page);
  return (
    <Page title={service.name} subtitle={`${service.code} · billed in ${service.unitLabel}`} width="full" breadcrumbs={[...crumbs, { label: service.name }]}>
      <ServiceView service={service} {...time} canManage={page.can('vas:manage')} orgSlug={page.context.org.slug} />
    </Page>
  );
}
