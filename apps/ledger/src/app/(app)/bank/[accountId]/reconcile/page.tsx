import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Page } from '@/components/layout/page';
import { ButtonLink } from '@/components/ledger/button-link';
import { EmptyState } from '@/components/ui';
import { PageBlocked } from '@/features/access/page-blocked';
import { findRecord } from '@/server/domain/records';
import { ledgerPage } from '@/server/page';

export const metadata: Metadata = { title: 'Match to the bank' };

export default async function RoutePage({ params }: { readonly params: Promise<{ readonly accountId: string }> }) {
  const { accountId } = await params;
  const page = await ledgerPage(`/bank/${accountId}/reconcile`, 'bank');
  if (page.blocked) return <PageBlocked title="Match to the bank" role={page.access.role} />;
  const account = await findRecord(page.ctx, 'bank_account', accountId);
  if (!account) notFound();
  return (
    <Page
      title={`Match ${account.label} to a statement`}
      subtitle="Statement end date and balance, the cleared balance and the difference."
      actions={
        <ButtonLink href={`/bank/${account.id}`} variant="secondary">
          Back
        </ButtonLink>
      }
    >
      <EmptyState title="No statement to match yet" description="Bring in a statement first. You can finish when the difference between the statement and the cleared balance is $0.00." illustration="search" />
    </Page>
  );
}
