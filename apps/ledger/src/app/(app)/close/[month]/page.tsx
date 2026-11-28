import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/ledger/button-link';
import { PageBlocked } from '@/features/access/page-blocked';
import { CLOSE_STEPS, monthLabel, parseMonth } from '@/features/close/months';
import { ledgerPage } from '@/server/page';

export const metadata: Metadata = { title: 'Close a month' };

export default async function RoutePage({ params }: { readonly params: Promise<{ readonly month: string }> }) {
  const { month } = await params;
  if (!parseMonth(month)) notFound();
  const page = await ledgerPage(`/close/${month}`, 'close');
  if (page.blocked) return <PageBlocked title="Close a month" role={page.access.role} />;
  return (
    <Page
      title={`Close ${monthLabel(month)}`}
      subtitle="Every blocking step must clear. Warnings need a tick that says you checked."
      actions={
        <ButtonLink href="/close" variant="secondary">
          All months
        </ButtonLink>
      }
    >
      <Panel title="Checklist">
        <ol className="divide-y divide-border-subtle" data-testid="close-checklist">
          {CLOSE_STEPS.map((step) => (
            <li key={step.key} className="flex flex-col gap-0.5 py-2.5">
              <span className="font-medium text-fg">
                {step.title}
                <span className="ml-2 text-xs font-normal text-fg-muted">{step.blocks ? 'Must clear' : 'Warning'}</span>
              </span>
              <span className="text-sm text-fg-secondary">{step.detail}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </Page>
  );
}
