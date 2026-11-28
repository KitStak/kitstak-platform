import 'server-only';
import { notFound } from 'next/navigation';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/ledger/button-link';
import { Badge, EmptyState } from '@/components/ui';
import { PageBlocked } from '@/features/access/page-blocked';
import { Fact, addressText } from '@/features/setup/parts';
import { listPaymentTerms } from '@/server/domain/terms';
import { getVendor } from '@/server/domain/vendors';
import { isDomainError } from '@/server/errors';
import { ledgerPage } from '@/server/page';
import { routes } from '@/lib/routes';
import { VENDOR_KIND_LABELS } from '@/lib/vendor-kinds';
import { VendorArchiveButton, VendorForm } from './vendor-form';
import { billAccountOptions } from './vendors-page';

/** `/vendors/[id]` (SPEC 6): contact, kinds, terms, default account and the 1099 switches. Bills fill in with Phase 4. */
export async function VendorPage({ id }: { readonly id: string }) {
  const page = await ledgerPage(`/vendors/${id}`, 'vendors');
  if (page.blocked) return <PageBlocked title="Vendor" role={page.access.role} />;
  const vendor = await getVendor(page.ctx, id).catch((error: unknown) => {
    if (isDomainError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  });
  if (!vendor) notFound();
  const canWrite = page.can('bill:enter');
  const [terms, accounts] = canWrite ? await Promise.all([listPaymentTerms(page.ctx), billAccountOptions(page)]) : [[], []];
  const foreignKinds = vendor.kinds.filter((kind) => !vendor.ledgerKinds.includes(kind));
  return (
    <Page
      title={vendor.name}
      subtitle={vendor.archivedAt ? 'Vendor · Archived' : 'Vendor'}
      actions={
        <div className="flex gap-2">
          <ButtonLink href={routes.vendors(Boolean(vendor.archivedAt))} variant="secondary">
            All vendors
          </ButtonLink>
          {canWrite ? (
            <>
              <VendorArchiveButton id={vendor.id} name={vendor.name} archived={Boolean(vendor.archivedAt)} isTempAgency={vendor.kinds.includes('temp_agency')} />
              <VendorForm vendor={vendor} terms={terms.map((row) => ({ value: row.id, label: row.name }))} accounts={accounts} />
            </>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2" data-testid="vendor-detail">
        <Panel title="Contact">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="Email" value={vendor.email} />
            <Fact label="Phone" value={vendor.phone} />
            <Fact label="Address" value={addressText(vendor.address)} />
            <Fact label="Notes" value={vendor.notes} />
          </dl>
        </Panel>
        <Panel title="How Ledger handles their bills">
          <div className="mb-3 flex flex-wrap gap-1" data-testid="vendor-kinds">
            {vendor.kinds.length > 0 ? vendor.kinds.map((kind) => <Badge key={kind} tone="outline">{VENDOR_KIND_LABELS[kind]}</Badge>) : <span className="text-sm text-fg-muted">No kinds yet</span>}
          </div>
          {foreignKinds.length > 0 ? (
            <p className="mb-3 text-sm text-fg-secondary">{foreignKinds.map((kind) => VENDOR_KIND_LABELS[kind]).join(' and ')} came from another KitStak app.</p>
          ) : null}
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="Terms" value={vendor.termsName ?? 'Workspace default'} />
            <Fact label="Default account" value={vendor.defaultAccountLabel} />
            <Fact label="1099" value={vendor.tracks1099 ? 'Payments tracked' : 'Not tracked'} />
            <Fact label="W 9" value={vendor.w9OnFile ? 'On file' : 'Not on file'} />
          </dl>
        </Panel>
        <Panel title="Bills and payments" className="lg:col-span-2">
          <EmptyState title="No bills yet" description="Open bills, payments and totals by year for this vendor show here once they bill you." illustration="board" />
        </Panel>
      </div>
    </Page>
  );
}
