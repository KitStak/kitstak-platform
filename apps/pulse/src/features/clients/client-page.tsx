import { UserSearch } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { pulsePage } from '@/server/page';

/** One client: profit, cost to serve, jobs, services and billing. Reached from the Clients tab of Profit. */
export async function ClientPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const page = await pulsePage(routes.client(id), 'profit');
  if (page.blocked || !page.access.seesMoney) return <PageBlocked title="Client" role={page.access.role} />;
  return (
    <Page title="Client" breadcrumbs={[{ label: 'Profit', href: routes.profit() }, { label: 'Clients', href: routes.profit({ by: 'client' }) }, { label: 'Client' }]}>
      <Panel>
        <Teach
          testId="client-not-found"
          icon={UserSearch}
          title="We could not find that client"
          why={`This link does not match a client in ${page.context.org.name}. The client may have been removed, or the link may belong to another workspace.`}
          actions={
            <>
              <ButtonLink href={routes.profit({ by: 'client' })}>See all clients</ButtonLink>
              {page.can('import:run') ? (
                <ButtonLink href={routes.newImport('clients')} variant="secondary">
                  Import clients
                </ButtonLink>
              ) : null}
            </>
          }
        />
      </Panel>
    </Page>
  );
}
