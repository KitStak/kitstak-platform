import { notFound, redirect } from 'next/navigation';
import { ExternalLink, PackagePlus, UserSearch } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import type { ClientDTO } from '@/lib/types';
import { findClientByRef, getClient, getSettings, listSites, todayInZone } from '@/server/domain';
import { isDomainError } from '@/server/errors';
import { appUrls } from '@/server/env';
import { pulsePage } from '@/server/page';
import { ClientView } from './client-view';
import { clientSiblingLinks } from './server/sibling-links';

/** One client: profit, cost to serve, jobs, extra services and where the record lives in the sibling apps. */
export async function ClientPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const page = await pulsePage(routes.client(id), 'profit');
  if (page.blocked || !page.access.seesMoney) return <PageBlocked title="Client" role={page.access.role} />;
  let client: ClientDTO | null = null;
  let failed = false;
  try {
    client = await getClient(page.ctx, id);
  } catch (error) {
    if (isDomainError(error) && error.code === 'NOT_FOUND') notFound();
    failed = true;
  }
  const crumbs = [{ label: 'Profit', href: routes.profit() }, { label: 'Clients', href: routes.profit({ by: 'client' }) }];
  if (!client) {
    return (
      <Page title="Client" breadcrumbs={[...crumbs, { label: 'Client' }]}>
        <Panel>
          <Teach
            testId="client-load-failed"
            icon={UserSearch}
            title={failed ? 'We could not load this client' : 'We could not find that client'}
            why="Something went wrong on our side while reading this client. Your data is safe. Go back to the client list and open it again."
            actions={<ButtonLink href={routes.profit({ by: 'client' })}>See all clients</ButtonLink>}
          />
        </Panel>
      </Page>
    );
  }
  const [settings, sites, available] = await Promise.all([getSettings(page.ctx).catch(() => undefined), listSites(page.ctx).catch(() => undefined), page.integrations()]);
  const links = await clientSiblingLinks(page.ctx, client, available);
  const urls = appUrls();
  const site = sites?.find((item) => item.isDefault) ?? sites?.[0];
  return (
    <Page
      title={client.name}
      subtitle={[client.code, client.status === 'inactive' ? 'Not active' : null, client.contactName].filter(Boolean).join(' · ')}
      width="full"
      breadcrumbs={[...crumbs, { label: client.name }]}
      actions={
        <>
          {links.map((link) => (
            <a key={link.app} href={`${link.app === 'crm' ? urls.crm : urls.wms}${link.path}`} target="_blank" rel="noreferrer" data-testid={`client-link-${link.app}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              {link.label}
              <ExternalLink aria-hidden className="size-3.5 text-icon" />
            </a>
          ))}
          {page.can('job:manage') ? (
            <ButtonLink href={routes.newJob({ client: client.id })} icon={<PackagePlus aria-hidden />} testId="client-new-job">
              New job
            </ButtonLink>
          ) : null}
        </>
      }
    >
      <ClientView client={client} today={site?.today ?? todayInZone(settings?.timezone ?? 'UTC')} weekStart={settings?.weekStart ?? 1} defaultTargetMarginBp={settings?.defaultTargetMarginBp ?? 3000} canManage={page.can('job:manage')} />
    </Page>
  );
}

/**
 * Deep link from a sibling app: `/clients/by-link?coreCustomerId=<id>` or `?crmAccountItemId=<id>`
 * (or `?client=<pulse id>`). Opens the Pulse client tied to that record. When none is tied to it,
 * the person lands on the Clients tab of Profit. The target is always built here, never from a URL in the query.
 */
export async function ClientByLinkPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<never> {
  const query = await searchParams;
  const pick = (value: string | string[] | undefined): string | null => {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
  };
  const ref = { pulseClientId: pick(query.client), coreCustomerId: pick(query.coreCustomerId), crmAccountItemId: pick(query.crmAccountItemId) };
  if (!ref.pulseClientId && !ref.coreCustomerId && !ref.crmAccountItemId) redirect(routes.profit({ by: 'client' }));
  const page = await pulsePage(routes.profit({ by: 'client' }), 'profit');
  let target = routes.profit({ by: 'client' });
  try {
    const client = await findClientByRef(page.ctx, ref);
    // People without money rights cannot open a client page: they get the job list instead.
    if (client) target = page.access.seesMoney && !page.blocked ? routes.client(client.id) : routes.jobs({ tab: 'all' });
  } catch {
    // Fall through to the client list.
  }
  return redirect(target);
}
