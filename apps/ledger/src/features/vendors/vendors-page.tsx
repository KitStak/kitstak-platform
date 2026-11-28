import 'server-only';
import Link from 'next/link';
import { Page, Panel } from '@/components/layout/page';
import { Badge, EmptyState, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';
import { PageBlocked } from '@/features/access/page-blocked';
import { CsvLinks, ShowTabs } from '@/features/setup/parts';
import { listChart } from '@/server/domain/chart';
import { listPaymentTerms } from '@/server/domain/terms';
import { listVendors } from '@/server/domain/vendors';
import { ledgerPage } from '@/server/page';
import { routes } from '@/lib/routes';
import { VENDOR_KIND_LABELS } from '@/lib/vendor-kinds';
import { VendorForm } from './vendor-form';

/** Accounts a bill line can go to: expenses, cost of service and assets. */
export async function billAccountOptions(page: Awaited<ReturnType<typeof ledgerPage>>) {
  const chart = await listChart(page.ctx);
  return chart.filter((row) => row.type === 'expense' || row.type === 'asset').map((row) => ({ value: row.id, label: `${row.number} ${row.name}` }));
}

/** `/vendors` (SPEC 6): the shared `core.vendors` list with kinds and the 1099 flag. */
export async function VendorsPage({ archived }: { readonly archived: boolean }) {
  const page = await ledgerPage('/vendors', 'vendors');
  if (page.blocked) return <PageBlocked title="Vendors" role={page.access.role} />;
  const [vendors, terms, accounts] = await Promise.all([listVendors(page.ctx, { archived }), listPaymentTerms(page.ctx), billAccountOptions(page)]);
  const canWrite = page.can('bill:enter');
  const actions = (
    <div className="flex flex-wrap gap-2">
      <CsvLinks stream="vendors" file="vendors.csv" canImport={canWrite && page.can('import:run')} canExport={page.can('export:run')} />
      {canWrite ? <VendorForm vendor={null} terms={terms.map((row) => ({ value: row.id, label: row.name }))} accounts={accounts} /> : null}
    </div>
  );
  return (
    <Page
      title="Vendors"
      subtitle="Who bills you: suppliers, carriers, temp agencies, landlords and more. Shared with Crew."
      actions={actions}
      tabs={<ShowTabs path="/vendors" archived={archived} />}
    >
      {vendors.length === 0 ? (
        <EmptyState
          title={archived ? 'No archived vendors' : 'No vendors yet'}
          description={archived ? 'Archived vendors keep their bills and history. They show here.' : 'Add the companies that send you bills, or import a vendors.csv file. One company can be several kinds.'}
          illustration="workspace"
        />
      ) : (
        <Panel bodyClassName="p-0">
          <Table aria-label="Vendors" data-testid="vendors-table">
            <TableHead>
              <tr>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Kinds</TableHeaderCell>
                <TableHeaderCell>Email</TableHeaderCell>
                <TableHeaderCell>Terms</TableHeaderCell>
                <TableHeaderCell>1099</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {vendors.map((vendor) => (
                <TableRow key={vendor.id} data-testid="vendor-row">
                  <TableCell>
                    <Link href={routes.vendor(vendor.id)} className="font-medium text-fg hover:underline">
                      {vendor.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {vendor.kinds.length > 0 ? vendor.kinds.map((kind) => <Badge key={kind} tone="outline">{VENDOR_KIND_LABELS[kind]}</Badge>) : <span className="text-fg-muted">None</span>}
                    </span>
                  </TableCell>
                  <TableCell className="text-fg-secondary">{vendor.email ?? ''}</TableCell>
                  <TableCell>{vendor.termsName ?? <span className="text-fg-muted">Default</span>}</TableCell>
                  <TableCell>{vendor.tracks1099 ? 'Tracked' : <span className="text-fg-muted">No</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </Page>
  );
}
