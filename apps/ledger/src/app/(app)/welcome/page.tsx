import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/ledger/button-link';
import { PeopleList } from '@/features/settings/people-list';
import { ClaimButton } from '@/features/welcome/claim-button';
import { canClaimLedger } from '@/server/domain/access';
import { listPeople } from '@/server/domain/setup-reads';
import { ledgerPage } from '@/server/page';
import { landingPath } from '@/lib/permissions';
import { routes } from '@/lib/routes';

export const metadata: Metadata = { title: 'Getting started' };

const STEPS: readonly { readonly key: string; readonly title: string; readonly href: string }[] = [
  { key: 'ledger_customer', title: 'Add a customer to invoice', href: routes.customers() },
  { key: 'ledger_first_invoice', title: 'Send your first invoice', href: routes.newInvoice() },
  { key: 'ledger_first_bill', title: 'Enter a bill', href: routes.newBill() },
  { key: 'ledger_bank', title: 'Bring in a bank statement', href: routes.bank() },
  { key: 'ledger_books', title: 'Connect QuickBooks Online', href: routes.settings('accounting') },
];

/** First run (SPEC 6 `/welcome`, SPEC 10): the claim step, "Who handles money here?", then the setup steps. */
export default async function WelcomePage() {
  const page = await ledgerPage('/welcome');
  // The setup steps are money steps: approvers and submitters go to their own start page.
  if (!page.can('money:read')) redirect(landingPath(page.access.role));
  const [claimable, people] = await Promise.all([canClaimLedger(page.ctx), page.can('roles:manage') ? listPeople(page.ctx) : Promise.resolve([])]);
  return (
    <Page title="Getting started" subtitle="Bill it. Pay it. Close it." width="narrow">
      <div className="flex flex-col gap-5">
        {claimable ? (
          <Panel title="Run Ledger for this workspace">
            <div className="flex flex-col items-start gap-3" data-testid="claim-callout">
              <p className="text-base text-fg-secondary">Nobody runs Ledger for {page.context.org.name} yet. As an admin you can take it over, then give people their roles.</p>
              <ClaimButton />
            </div>
          </Panel>
        ) : null}
        {page.can('roles:manage') ? (
          <Panel title="Who handles money here?">
            <PeopleList people={people} actorRole={page.access.role} canManage />
          </Panel>
        ) : null}
        <Panel title="Your first steps">
          <ol className="divide-y divide-border-subtle" data-testid="setup-steps">
            {STEPS.map((step, index) => (
              <li key={step.key} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-fg">
                  <span className="mr-2 text-fg-muted tabular-nums">{index + 1}.</span>
                  {step.title}
                </span>
                <ButtonLink href={step.href} variant="secondary" size="sm">
                  Open
                </ButtonLink>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </Page>
  );
}
