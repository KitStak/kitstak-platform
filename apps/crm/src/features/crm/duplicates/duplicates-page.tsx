'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Building2, CopyCheck, ShieldCheck, UserRound } from 'lucide-react';
import { EmptyState, Skeleton, Tabs, TabsList, TabsTrigger } from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { PageFrame } from '@/features/shell/pages/page-frame';
import { routes } from '@/features/shell/routes';
import type { DuplicatesDto } from '@/server/services/crm-contracts';
import { useDuplicates } from '../api';
import { ErrorBlock } from '../components/crm-ui';
import { plural } from '../lib/format';
import { ClusterCard, type DuplicateKind } from './cluster-card';

export function DuplicatesPage() {
  const { org } = useOrg();
  const search = useSearchParams();
  const pathname = usePathname() ?? '';
  const kind: DuplicateKind = search?.get('kind') === 'accounts' ? 'accounts' : 'contacts';
  const duplicates = useDuplicates(kind);
  const data = duplicates.data;

  return (
    <PageFrame
      width="wide"
      title="Duplicates"
      icon={<CopyCheck aria-hidden />}
      description="Relations and history move to the record you keep."
      breadcrumbs={[{ label: 'Home', href: routes.home(org.slug) }, { label: 'CRM', href: `/${org.slug}/crm/pipeline` }, { label: 'Duplicates' }]}
    >
      <div className="flex flex-col gap-5" data-testid="crm-duplicates">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={kind} onValueChange={(value) => window.history.replaceState(null, '', value === 'contacts' ? pathname : `${pathname}?kind=${value}`)}>
            <TabsList>
              <TabsTrigger value="contacts">
                <UserRound aria-hidden className="size-4" /> Contacts
              </TabsTrigger>
              <TabsTrigger value="accounts">
                <Building2 aria-hidden className="size-4" /> Accounts
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {data?.board ? (
            <p className="text-sm text-fg-secondary" aria-live="polite">
              Scanned {plural(data.scanned, data.board.itemTerminology.toLowerCase())} on{' '}
              <Link href={routes.board(org.slug, data.board.id)} className="rounded-sm font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                {data.board.name}
              </Link>
              {data.dismissedCount > 0 ? ` · ${plural(data.dismissedCount, 'pair')} marked as not duplicates` : ''}
            </p>
          ) : null}
        </div>
        {duplicates.isError && !data ? (
          <ErrorBlock error={duplicates.error} title="Couldn’t scan for duplicates" onRetry={() => void duplicates.refetch()} />
        ) : !data ? (
          <div className="flex flex-col gap-4" aria-busy="true" aria-label="Scanning for duplicates" data-skeleton>
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} height={220} rounded="lg" />
            ))}
          </div>
        ) : !data.board ? (
          <EmptyState title={`No ${kind} board`} description={`Create a ${kind === 'contacts' ? 'Contacts' : 'Accounts'} board from the CRM template to manage duplicates.`} />
        ) : data.clusters.length === 0 ? (
          <EmptyState
            visual={
              <span className="flex size-20 items-center justify-center rounded-full bg-success-subtle text-success-text">
                <ShieldCheck aria-hidden className="size-10" />
              </span>
            }
            title="No duplicates found"
            description={`All ${plural(data.scanned, kind === 'contacts' ? 'contact' : 'account')} look unique. We match on email, website domain and name, and never pair people at different companies.`}
          />
        ) : (
          <ClusterList data={data} kind={kind} orgSlug={org.slug} />
        )}
      </div>
    </PageFrame>
  );
}

function ClusterList({ data, kind, orgSlug }: { readonly data: DuplicatesDto; readonly kind: DuplicateKind; readonly orgSlug: string }) {
  const high = data.clusters.filter((cluster) => cluster.confidence === 'high').length;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-fg">
        <strong className="font-semibold">{plural(data.clusters.length, 'group')}</strong> of suspected duplicates
        {high > 0 ? <span className="text-fg-secondary"> · {high} high confidence</span> : null}
      </p>
      <ul className="flex flex-col gap-4">
        {data.clusters.map((cluster) => (
          <li key={cluster.key}>
            <ClusterCard cluster={cluster} kind={kind} orgSlug={orgSlug} canEdit={data.canEdit} />
          </li>
        ))}
      </ul>
    </div>
  );
}
