import 'server-only';
import Link from 'next/link';
import { Page, Panel } from '@/components/layout/page';
import { Badge, EmptyState, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';
import { PageBlocked } from '@/features/access/page-blocked';
import { CsvLinks } from '@/features/setup/parts';
import { listCustomers } from '@/server/domain/customers';
import { listPaymentTerms } from '@/server/domain/terms';
import { listTaxRates } from '@/server/domain/tax-rates';
import { ledgerPage } from '@/server/page';
import { routes } from '@/lib/routes';
import { CustomerForm } from './customer-form';

/** `/customers` (SPEC 6): who you invoice, with invoice emails and terms. Balances arrive with invoices. */
export async function CustomersPage() {
  const page = await ledgerPage('/customers', 'customers');
  if (page.blocked) return <PageBlocked title="Customers" role={page.access.role} />;
  const [customers, terms, rates] = await Promise.all([listCustomers(page.ctx), listPaymentTerms(page.ctx), listTaxRates(page.ctx)]);
  const canWrite = page.can('invoice:write');
  const termOptions = terms.map((row) => ({ value: row.id, label: row.name }));
  const rateOptions = rates.map((row) => ({ value: row.id, label: row.name }));
  const actions = (
    <div className="flex flex-wrap gap-2">
      <CsvLinks stream="customers" file="customers.csv" canImport={canWrite && page.can('import:run')} canExport={page.can('export:run')} />
      {canWrite ? <CustomerForm customer={null} terms={termOptions} rates={rateOptions} /> : null}
    </div>
  );
  return (
    <Page title="Customers" subtitle="Who you invoice, with invoice emails and terms. The list is shared with your other KitStak apps." actions={actions}>
      {customers.length === 0 ? (
        <EmptyState title="No customers yet" description="Add a customer, or import a customers.csv file. Customers from the warehouse and CRM show here on their own." illustration="workspace" />
      ) : (
        <Panel bodyClassName="p-0">
          <Table aria-label="Customers" data-testid="customers-table">
            <TableHead>
              <tr>
                <TableHeaderCell>Code</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Invoice emails</TableHeaderCell>
                <TableHeaderCell>Terms</TableHeaderCell>
                <TableHeaderCell>Tax</TableHeaderCell>
                <TableHeaderCell>Reminders</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id} data-testid="customer-row">
                  <TableCell className="font-mono text-fg-secondary">{customer.code}</TableCell>
                  <TableCell>
                    <Link href={routes.customer(customer.id)} className="font-medium text-fg hover:underline">
                      {customer.name}
                    </Link>
                    {customer.status !== 'Active' ? <Badge className="ml-2">{customer.status}</Badge> : null}
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-fg-secondary">
                    {customer.billingEmails.length > 0 ? customer.billingEmails.join(', ') : <span className="text-warning-text">None yet</span>}
                  </TableCell>
                  <TableCell>{customer.termsName ?? <span className="text-fg-muted">Default</span>}</TableCell>
                  <TableCell>{customer.taxExempt ? 'Exempt' : (customer.taxRateName ?? <span className="text-fg-muted">None</span>)}</TableCell>
                  <TableCell>{customer.remindersEnabled ? 'On' : 'Off'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </Page>
  );
}
