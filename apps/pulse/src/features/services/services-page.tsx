import { FileSpreadsheet, Sparkles, SearchX } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { pulsePage } from '@/server/page';

const crumbs = [{ label: 'Profit', href: routes.profit() }, { label: 'Extra services', href: routes.services() }];

/** Extra services: the catalog (price, unit, target pace) and profit by service. */
export async function ServicesPage() {
  const page = await pulsePage(routes.services(), 'profit');
  if (page.blocked || !page.access.seesMoney) return <PageBlocked title="Extra services" role={page.access.role} />;
  const canManage = page.can('vas:manage');
  return (
    <Page
      title="Extra services"
      subtitle="The billable extras around a job, each with its own price, cost and margin."
      breadcrumbs={[crumbs[0]!, { label: 'Extra services' }]}
      actions={
        canManage ? (
          <ButtonLink href={routes.newImport('services')} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
            Import services
          </ButtonLink>
        ) : null
      }
    >
      <Panel>
        <Teach
          icon={Sparkles}
          title="No extra services yet"
          why="Extra services are the things you bill on top of a job: labeling, rework, special packing, storage. List each one with its price and Pulse shows which ones earn their keep."
          points={['Revenue and cost per unit for each service', 'Margin, volume and trend', 'Which clients use it, and entries with no price to fix']}
          actions={
            canManage ? (
              <ButtonLink href={routes.newImport('services')} icon={<FileSpreadsheet aria-hidden />}>
                Import your service list
              </ButtonLink>
            ) : null
          }
          footnote={canManage ? 'The template has one row per service: code, name, unit, price and target pace.' : 'Ask a manager to add the first service.'}
        />
      </Panel>
    </Page>
  );
}

/** One extra service: its entries, price history and the clients using it. */
export async function ServicePage({ params }: { readonly params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const page = await pulsePage(routes.service(id), 'profit');
  if (page.blocked || !page.access.seesMoney) return <PageBlocked title="Extra service" role={page.access.role} />;
  return (
    <Page title="Extra service" breadcrumbs={[...crumbs, { label: 'Service' }]}>
      <Panel>
        <Teach
          testId="service-not-found"
          icon={SearchX}
          title="We could not find that service"
          why={`This link does not match an extra service in ${page.context.org.name}. It may have been removed, or the link may belong to another workspace.`}
          actions={<ButtonLink href={routes.services()}>See all extra services</ButtonLink>}
        />
      </Panel>
    </Page>
  );
}
