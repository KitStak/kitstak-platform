'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronUp } from 'lucide-react';
import { ApiClientError } from '@/lib/api';
import { Breadcrumbs, Button, EmptyState, Illustration, Skeleton, buttonVariants } from '@/components/ui';
import type { ActivityOutcome } from '@/server/services/crm-contracts';
import { formatMoney } from '../lib/format';
import { useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import type { Account360Dto, Contact360Dto, Record360Dto } from '@/server/services/crm-contracts';
import { useRecord360 } from '../api';
import { CardSkeleton, CrmCard, ErrorBlock } from '../components/crm-ui';
import { ActivityComposer, type ComposerOptions } from './activity-composer';
import { AccountCard, ContactsCard, DealsCard, DetailsCard, NextStepsCard } from './record-cards';
import { RecordHeader } from './record-header';
import { Timeline } from './timeline';
import { WmsCard } from './wms-card';

/** Shared width + gutters for every CRM record state (matches PageFrame `wide`). */
const FRAME = 'mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8';

function composerOptions(record: Record360Dto): ComposerOptions {
  const openDeals = record.deals.filter((deal) => deal.stageKind === 'open');
  const deals = record.deals.map((deal) => ({
    id: deal.id,
    name: deal.name,
    boardId: deal.boardId,
    stage: deal.stage,
    amountText: formatMoney(deal.value, record.currency),
  }));
  if (record.kind === 'contacts') {
    return {
      types: record.activityTypes,
      contacts: [{ id: record.id, name: record.name, boardId: record.board.id }],
      deals,
      defaultContactIds: [record.id],
      defaultDealIds: openDeals.length === 1 && openDeals[0] ? [openDeals[0].id] : [],
    };
  }
  const contacts = record.contacts.map((contact) => ({ id: contact.id, name: contact.name, boardId: contact.boardId }));
  return {
    types: record.activityTypes,
    contacts,
    deals,
    defaultContactIds: contacts.slice(0, 1).map((contact) => contact.id),
    defaultDealIds: contacts.length === 0 && openDeals[0] ? [openDeals[0].id] : [],
  };
}

export function Record360Page({ kind, itemId }: { readonly kind: 'contacts' | 'accounts'; readonly itemId: string }) {
  const { org } = useOrg();
  const query = useRecord360(kind, itemId);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerOutcome, setComposerOutcome] = useState<ActivityOutcome>('completed');
  const composerRef = useRef<HTMLDivElement>(null);
  const record = query.data as Record360Dto | undefined;
  const label = kind === 'contacts' ? 'Contacts' : 'Accounts';

  /** The single entry point (header button / Next steps): open the inline composer and focus it. */
  const openComposer = (outcome: ActivityOutcome = 'completed') => {
    setComposerOutcome(outcome);
    setComposerOpen(true);
    window.requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      composerRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    });
  };

  const crumbs = [
    { label: 'Home', href: routes.home(org.slug) },
    { label: 'CRM', href: `/${org.slug}/crm/pipeline` },
    record ? { label: record.board.name, href: routes.board(org.slug, record.board.id) } : { label },
    ...(record ? [{ label: record.name }] : []),
  ];

  if (query.isError && !record) {
    const missing = query.error instanceof ApiClientError && (query.error.status === 404 || query.error.status === 403);
    return (
      <div className="h-full overflow-y-auto">
        <div className={FRAME}>
          <Breadcrumbs items={crumbs} />
          {missing ? (
            <EmptyState
              visual={<Illustration name="error" size={152} />}
              title={kind === 'contacts' ? 'This contact isn’t available' : 'This account isn’t available'}
              description="It may have been deleted or merged, or it lives on a board you can’t access."
              actions={
                <Link href={`/${org.slug}/crm/pipeline`} className={buttonVariants({ variant: 'primary' })}>
                  Back to pipeline
                </Link>
              }
            />
          ) : (
            <ErrorBlock error={query.error} title="Couldn’t load this record" onRetry={() => void query.refetch()} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto" data-testid={`crm-${kind}-360`}>
      <div className={FRAME}>
        <Breadcrumbs items={crumbs} />
        {!record ? (
          <RecordSkeleton />
        ) : (
          <>
            <RecordHeader
              record={record}
              orgSlug={org.slug}
              onLogActivity={() => openComposer()}
              canLog={Boolean(record.activityBoard)}
              composerOpen={composerOpen}
            />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
                <CrmCard
                  id="crm-activity-card"
                  title="Activity"
                  description="Calls, emails, meetings and updates across this record and its deals"
                  aside={
                    composerOpen ? (
                      <Button variant="ghost" size="sm" leadingIcon={<ChevronUp aria-hidden />} onClick={() => setComposerOpen(false)} aria-expanded>
                        Hide composer
                      </Button>
                    ) : null
                  }
                >
                  {composerOpen && record.activityBoard ? (
                    <div ref={composerRef} id="crm-activity-composer" className="mb-6 animate-fade-in rounded-lg border border-border-subtle bg-sunken p-4">
                      <ActivityComposer
                        key={composerOutcome}
                        initialOutcome={composerOutcome}
                        options={composerOptions(record)}
                        fromItemId={record.id}
                        recordKey={{ kind, itemId }}
                        onLogged={() => setComposerOpen(false)}
                        onCancel={() => setComposerOpen(false)}
                      />
                    </div>
                  ) : null}
                  <Timeline entries={record.timeline} orgSlug={org.slug} />
                </CrmCard>
              </div>
              <aside className="flex min-w-0 flex-col gap-6 lg:col-span-4" aria-label="Related records">
                <NextStepsCard
                  steps={record.nextSteps}
                  orgSlug={org.slug}
                  onSchedule={record.activityBoard ? () => openComposer('scheduled') : undefined}
                />
                <DealsCard deals={record.deals} totals={record.dealTotals} currency={record.currency} orgSlug={org.slug} />
                {record.kind === 'contacts' ? <ContactSide record={record} orgSlug={org.slug} /> : <AccountSide record={record} orgSlug={org.slug} />}
                <DetailsCard fields={record.fields} />
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ContactSide({ record, orgSlug }: { readonly record: Contact360Dto; readonly orgSlug: string }) {
  return (
    <>
      <AccountCard account={record.account} orgSlug={orgSlug} />
      <ContactsCard
        testId="crm-related-contacts"
        title="Related contacts"
        contacts={record.relatedContacts}
        orgSlug={orgSlug}
        emptyText="No other contacts at this account."
      />
    </>
  );
}

function AccountSide({ record, orgSlug }: { readonly record: Account360Dto; readonly orgSlug: string }) {
  return (
    <>
      <ContactsCard
        testId="crm-account-contacts"
        title="Contacts"
        contacts={record.contacts}
        orgSlug={orgSlug}
        emptyText="No contacts linked to this account yet."
      />
      <WmsCard itemId={record.id} />
    </>
  );
}

function RecordSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading record" data-skeleton>
      <div className="rounded-xl border border-border-subtle bg-panel p-6">
        <div className="flex items-center gap-4">
          <Skeleton width={64} height={64} rounded="full" className="shrink-0" />
          <div className="flex flex-col gap-2">
            <Skeleton width={240} height={22} rounded="md" className="max-w-full" />
            <Skeleton width={180} height={14} rounded="md" />
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <Skeleton width={220} height={36} rounded="md" />
          <Skeleton width={160} height={36} rounded="md" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-border-subtle bg-panel p-5 lg:col-span-8">
          <CardSkeleton rows={6} height={48} />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-4">
          <div className="rounded-lg border border-border-subtle bg-panel p-5">
            <CardSkeleton rows={3} />
          </div>
          <div className="rounded-lg border border-border-subtle bg-panel p-5">
            <CardSkeleton rows={4} />
          </div>
        </div>
      </div>
    </div>
  );
}
