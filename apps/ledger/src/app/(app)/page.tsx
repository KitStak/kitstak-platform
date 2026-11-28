import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/ledger/button-link';
import { EmptyState } from '@/components/ui';
import { ClaimButton } from '@/features/welcome/claim-button';
import { canClaimLedger } from '@/server/domain/access';
import { moneyHeadline } from '@/server/domain/home';
import { ledgerPage } from '@/server/page';
import { formatCents } from '@/lib/money';
import { landingPath } from '@/lib/permissions';
import { routes } from '@/lib/routes';

export const metadata: Metadata = { title: 'Home' };

export default async function HomePage() {
  const page = await ledgerPage('/', 'home');
  // Approvers land on Bills and submitters on Expenses (SPEC 6): no money home for them.
  if (page.blocked) redirect(landingPath(page.access.role));
  const [headline, claimable] = await Promise.all([moneyHeadline(page.ctx), canClaimLedger(page.ctx)]);
  return (
    <Page title="Home" subtitle="What customers owe you, what you owe, and what needs you.">
      <div className="flex flex-col gap-5">
        {claimable ? (
          <Panel title="Nobody runs Ledger here yet">
            <div className="flex flex-wrap items-center justify-between gap-3" data-testid="claim-callout">
              <p className="text-base text-fg-secondary">You are an admin of {page.context.org.name}. Take over Ledger to give people their roles and close months.</p>
              <ClaimButton />
            </div>
          </Panel>
        ) : null}
        <Panel>
          <p className="text-lg text-fg" data-testid="money-headline">
            Customers owe you <strong className="tabular-nums">{formatCents(headline.owedToYouCents)}</strong>. You owe <strong className="tabular-nums">{formatCents(headline.youOweCents)}</strong> in bills.
          </p>
        </Panel>
        <EmptyState
          title="Nothing needs you yet"
          description="Invoices to send, bills waiting for your approval, missed promises and bank lines to match show here as you start."
          illustration="notifications"
          actions={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href={routes.welcome()}>Getting started</ButtonLink>
              {page.can('invoice:write') ? (
                <ButtonLink href={routes.newInvoice()} variant="secondary">
                  New invoice
                </ButtonLink>
              ) : null}
            </div>
          }
        />
      </div>
    </Page>
  );
}
