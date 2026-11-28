import 'server-only';
import { notFound } from 'next/navigation';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/ledger/button-link';
import { Badge, EmptyState } from '@/components/ui';
import { PageBlocked } from '@/features/access/page-blocked';
import { Fact, addressText } from '@/features/setup/parts';
import { getCustomer } from '@/server/domain/customers';
import { listPaymentTerms } from '@/server/domain/terms';
import { listTaxRates } from '@/server/domain/tax-rates';
import { isDomainError } from '@/server/errors';
import { ledgerPage } from '@/server/page';
import { routes } from '@/lib/routes';
import { CustomerForm } from './customer-form';

/** `/customers/[id]` (SPEC 6): the invoice settings of one customer. Invoices and payments fill in with their phases. */
export async function CustomerPage({ id }: { readonly id: string }) {
  const page = await ledgerPage(`/customers/${id}`, 'customers');
  if (page.blocked) return <PageBlocked title="Customer" role={page.access.role} />;
  const customer = await getCustomer(page.ctx, id).catch((error: unknown) => {
    if (isDomainError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  });
  if (!customer) notFound();
  const [terms, rates] = await Promise.all([listPaymentTerms(page.ctx), listTaxRates(page.ctx)]);
  return (
    <Page
      title={customer.name}
      subtitle={`Customer ${customer.code}${customer.status !== 'Active' ? ` · ${customer.status}` : ''}`}
      actions={
        <div className="flex gap-2">
          <ButtonLink href={routes.customers()} variant="secondary">
            All customers
          </ButtonLink>
          {page.can('invoice:write') ? (
            <CustomerForm customer={customer} terms={terms.map((row) => ({ value: row.id, label: row.name }))} rates={rates.map((row) => ({ value: row.id, label: row.name }))} />
          ) : null}
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2" data-testid="customer-detail">
        <Panel title="Invoices go to">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="Invoice emails" value={customer.billingEmails.join(', ')} />
            <Fact label="Invoice contact" value={customer.billingContactName} />
            <Fact label="Phone" value={customer.phone} />
            <Fact label="Address" value={addressText(customer.billingAddress)} />
            <Fact label="Contact in KitStak" value={[customer.contactName, customer.contactEmail].filter(Boolean).join(', ')} />
          </dl>
        </Panel>
        <Panel title="Terms, tax and reminders">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="Terms" value={customer.termsName ?? 'Workspace default'} />
            <Fact label="Default tax rate" value={customer.taxRateName ?? 'No tax'} />
            <Fact label="Tax exempt" value={customer.taxExempt ? `Yes${customer.exemptionNote ? `, ${customer.exemptionNote}` : ''}` : 'No'} />
            <Fact label="Payment reminders" value={customer.remindersEnabled ? 'On' : 'Off'} />
            <Fact label="Notes" value={customer.notes} />
          </dl>
          {!customer.hasProfile ? (
            <p className="mt-3">
              <Badge tone="warning">Not set up for invoices yet</Badge>
            </p>
          ) : null}
        </Panel>
        <Panel title="Invoices and payments" className="lg:col-span-2">
          <EmptyState title="No invoices yet" description="Open invoices, payments, credits and statements for this customer show here once you invoice them." illustration="board" />
        </Panel>
      </div>
    </Page>
  );
}
