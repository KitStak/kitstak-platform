import { ShieldQuestion } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/ledger/button-link';
import { LEDGER_ROLE_LABELS, landingPath, type LedgerRole } from '@/lib/permissions';

/** Shown when a person opens a page their Ledger role does not include (for example a submitter on Invoices). */
export function PageBlocked({ title, role }: { readonly title: string; readonly role: LedgerRole }) {
  return (
    <Page title={title} width="narrow">
      <Panel>
        <div className="flex flex-col items-start gap-3" data-testid="page-blocked">
          <span className="flex size-10 items-center justify-center rounded-lg bg-sunken text-icon">
            <ShieldQuestion aria-hidden className="size-5" />
          </span>
          <h2 className="text-lg font-semibold text-fg">This page is not part of your role</h2>
          <p className="text-base text-fg-secondary">
            Your Ledger role is {LEDGER_ROLE_LABELS[role]}. Money pages open only for people who were given that right. Ask an admin of your workspace if you need it.
          </p>
          <ButtonLink href={landingPath(role)}>Go to my start page</ButtonLink>
        </div>
      </Panel>
    </Page>
  );
}
