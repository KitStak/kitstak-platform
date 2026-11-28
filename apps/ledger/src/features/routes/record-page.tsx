import 'server-only';
import { notFound } from 'next/navigation';
import { Page } from '@/components/layout/page';
import { ButtonLink } from '@/components/ledger/button-link';
import { EmptyState } from '@/components/ui';
import { PageBlocked } from '@/features/access/page-blocked';
import { findRecord, type RecordKind } from '@/server/domain/records';
import { ledgerPage } from '@/server/page';
import { LEDGER_STATUS_LABELS } from '@kitstak/ledger-bridge/types';
import type { NavId } from '@/lib/nav';

const WORDS: Readonly<Record<RecordKind, { readonly noun: string; readonly back: string; readonly empty: string }>> = {
  invoice: { noun: 'Invoice', back: '/invoices', empty: 'Lines, payments, credits and the timeline of this invoice show here.' },
  recurring: { noun: 'Recurring invoice', back: '/invoices/recurring', empty: 'The template lines and the drafts it made show here.' },
  customer: { noun: 'Customer', back: '/customers', empty: 'Open invoices, payments, credits and statements for this customer show here once you invoice them.' },
  payment: { noun: 'Payment', back: '/payments', empty: 'The invoices this payment pays show here.' },
  bill: { noun: 'Bill', back: '/bills', empty: 'Lines, the photo of the bill, approval and payments show here.' },
  vendor: { noun: 'Vendor', back: '/vendors', empty: 'Open bills, payments and totals by year for this vendor show here once they bill you.' },
  expense: { noun: 'Expense', back: '/expenses', empty: 'The receipt, the lines and the approval show here.' },
  bank_account: { noun: 'Bank account', back: '/bank', empty: 'Statement lines and their suggested matches show here once you bring in a statement.' },
  journal: { noun: 'Entry', back: '/journal', empty: 'The lines of this entry and the document it came from show here.' },
  import: { noun: 'Import', back: '/import', empty: 'The rows of this file and what happened to each show here.' },
};

/** A detail route (SPEC 6): the record the URL names, or the helpful not found page. */
export async function RecordPage({ kind, refValue, path, nav }: { readonly kind: RecordKind; readonly refValue: string; readonly path: string; readonly nav: NavId }) {
  const page = await ledgerPage(path, nav);
  const words = WORDS[kind];
  if (page.blocked) return <PageBlocked title={words.noun} role={page.access.role} />;
  const record = await findRecord(page.ctx, kind, decodeURIComponent(refValue));
  if (!record) notFound();
  const status = record.status && record.status in LEDGER_STATUS_LABELS ? LEDGER_STATUS_LABELS[record.status as keyof typeof LEDGER_STATUS_LABELS] : null;
  return (
    <Page title={record.label} subtitle={status ? `${words.noun} · ${status}` : words.noun} actions={<ButtonLink href={words.back} variant="secondary">Back</ButtonLink>}>
      <div data-testid={`record-${kind}`}>
        <EmptyState title="Nothing here yet" description={words.empty} illustration="board" />
      </div>
    </Page>
  );
}
