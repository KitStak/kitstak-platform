import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/ledger/button-link';
import { EmptyState } from '@/components/ui';
import { PageBlocked } from '@/features/access/page-blocked';
import { SETTINGS_SECTIONS } from '@/features/routes/catalog';
import { PeopleList } from '@/features/settings/people-list';
import { MathPage } from '@/features/settings/math';
import { listNumbering, listPeople, listReminderRules } from '@/server/domain/setup-reads';
import { AccountsSection, AppsSection, ItemsSection, TaxSection, TermsSection } from '@/features/setup/sections';
import { ShowTabs } from '@/features/setup/parts';
import { ledgerPage, type LedgerPage } from '@/server/page';

export const metadata: Metadata = { title: 'Settings' };

const LISTS = new Set(['accounts', 'terms', 'items', 'tax']);
const DOC_WORDS: Readonly<Record<string, string>> = { invoice: 'Invoices', credit_note: 'Credit notes', journal: 'Entries', bill: 'Bills', payment: 'Payments', expense: 'Expenses' };

const EMPTY: Readonly<Record<string, string>> = {
  general: 'Your company name, address and logo go on every invoice. Payment instructions are printed at the foot.',
  approvals: 'By default the person who enters a bill cannot approve it when two or more people can approve bills. Write offs above $500.00 need an owner or admin.',
  close: 'Add your own month end tasks, with an owner and a due day of the next month. Each shows on the close checklist.',
  accounting: 'Connect QuickBooks Online to send every posted entry there. Ledger keeps its own books either way.',
  sample: 'Load a small sample to try Ledger: 3 customers, 6 invoices, 4 bills and a statement. Clear it in one step.',
  audit: 'Every change in Ledger writes who did it and when. The log shows here.',
};

async function SectionBody({ slug, page, archived }: { readonly slug: string; readonly page: LedgerPage; readonly archived: boolean }) {
  if (slug === 'people') {
    const people = await listPeople(page.ctx);
    return <PeopleList people={people} actorRole={page.access.role} canManage={page.can('roles:manage')} />;
  }
  if (slug === 'accounts') return <AccountsSection page={page} archived={archived} />;
  if (slug === 'terms') return <TermsSection page={page} archived={archived} />;
  if (slug === 'items') return <ItemsSection page={page} archived={archived} />;
  if (slug === 'tax') return <TaxSection page={page} archived={archived} />;
  if (slug === 'apps') return <AppsSection page={page} />;
  if (slug === 'numbering') {
    const rows = await listNumbering(page.ctx);
    return (
      <ul className="divide-y divide-border-subtle" data-testid="numbering-list">
        {rows.map((row) => (
          <li key={row.docType} className="flex justify-between py-2 text-sm">
            <span className="text-fg">{DOC_WORDS[row.docType] ?? row.docType}</span>
            <span className="font-mono text-fg-muted tabular-nums">Next: {row.next}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (slug === 'reminders') {
    const rows = await listReminderRules(page.ctx);
    return (
      <ul className="divide-y divide-border-subtle" data-testid="reminder-rules">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col py-2 text-sm">
            <span className="text-fg">
              {row.offsetDays < 0 ? `${-row.offsetDays} days before the due date` : `${row.offsetDays} days after the due date`}
              {row.repeatEveryDays ? `, then every ${row.repeatEveryDays} days` : ''}
            </span>
            <span className="text-fg-muted">{row.subject}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (slug === 'math') return <MathPage />;
  return <EmptyState title="Nothing set here yet" description={EMPTY[slug] ?? ''} illustration="workspace" />;
}

export default async function RoutePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly section: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  const { show } = await searchParams;
  const archived = show === 'archived' && LISTS.has(section);
  const meta = SETTINGS_SECTIONS.find((entry) => entry.slug === section);
  if (!meta) notFound();
  const page = await ledgerPage(`/settings/${section}`, 'settings');
  if (page.blocked) return <PageBlocked title={meta.title} role={page.access.role} />;
  return (
    <Page
      title={meta.title}
      subtitle={meta.description}
      actions={
        <ButtonLink href="/settings" variant="secondary">
          All settings
        </ButtonLink>
      }
      tabs={LISTS.has(section) ? <ShowTabs path={`/settings/${section}`} archived={archived} /> : undefined}
    >
      <Panel>
        <SectionBody slug={section} page={page} archived={archived} />
      </Panel>
    </Page>
  );
}
