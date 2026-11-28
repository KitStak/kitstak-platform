import 'server-only';
import type { ReactNode } from 'react';
import { Badge, EmptyState, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';
import { listChart } from '@/server/domain/chart';
import { listItems } from '@/server/domain/items';
import { KNOWN_MAPPING_KEYS, listMappings, type MappingSource } from '@/server/domain/mappings';
import { listTaxRates } from '@/server/domain/tax-rates';
import { listPaymentTerms, termsWords } from '@/server/domain/terms';
import { priceText, ratePctText } from '@/server/csv/cells';
import type { LedgerPage } from '@/server/page';
import { AccountArchive, AccountForm, ItemArchive, ItemForm, MakeDefaultTerms, MappingPicker, TaxRateArchive, TaxRateForm, TermsArchive, TermsForm } from './list-forms';
import { CsvLinks } from './parts';

const TYPE_WORDS: Readonly<Record<string, string>> = { asset: 'Asset', liability: 'Liability', equity: 'Equity', revenue: 'Revenue', expense: 'Expense' };

/** The bar above a list: what the person may do here. */
function Toolbar({ children, note }: { readonly children?: ReactNode; readonly note?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-fg-secondary">{note}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

const readOnlyNote = 'Only an owner or admin can change this list.';

export async function ItemsSection({ page, archived }: { readonly page: LedgerPage; readonly archived: boolean }) {
  const [items, chart, rates] = await Promise.all([listItems(page.ctx, { archived }), listChart(page.ctx), listTaxRates(page.ctx)]);
  const manage = page.can('settings:manage');
  const accounts = chart.filter((row) => row.type === 'revenue').map((row) => ({ value: row.id, label: `${row.number} ${row.name}` }));
  const rateOptions = rates.map((row) => ({ value: row.id, label: row.name }));
  return (
    <>
      <Toolbar note={manage ? 'What you invoice for. Each line on an invoice can start from an item.' : readOnlyNote}>
        <CsvLinks stream="items" file="items.csv" canImport={manage && page.can('import:run')} canExport={page.can('export:run')} />
        {manage && !archived ? <ItemForm item={null} accounts={accounts} rates={rateOptions} /> : null}
      </Toolbar>
      {items.length === 0 ? (
        <EmptyState title={archived ? 'No archived items' : 'No items yet'} description="Items are what you invoice for, like storage per pallet month or kit assembly per unit." illustration="workspace" />
      ) : (
        <Table aria-label="Items" data-testid="items-table">
          <TableHead>
            <tr>
              <TableHeaderCell>Code</TableHeaderCell>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell numeric>Default price</TableHeaderCell>
              <TableHeaderCell>Account</TableHeaderCell>
              <TableHeaderCell>Tax</TableHeaderCell>
              {manage ? <TableHeaderCell className="text-right">Change</TableHeaderCell> : null}
            </tr>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} data-testid="item-row">
                <TableCell className="font-mono text-fg-secondary">{item.code}</TableCell>
                <TableCell>
                  {item.name}
                  {item.unitLabel ? <span className="text-fg-muted"> per {item.unitLabel}</span> : null}
                </TableCell>
                <TableCell numeric>{item.defaultPrice ? `$${priceText(item.defaultPrice)}` : ''}</TableCell>
                <TableCell className="text-fg-secondary">{item.accountLabel}</TableCell>
                <TableCell>{item.taxRateName ?? <span className="text-fg-muted">Not taxed</span>}</TableCell>
                {manage ? (
                  <TableCell className="text-right">
                    <span className="inline-flex gap-1">
                      {!archived ? (
                        <ItemForm
                          item={{ id: item.id, version: item.version, code: item.code, name: item.name, description: item.description, unitLabel: item.unitLabel, price: priceText(item.defaultPrice), accountId: item.accountId, taxRateId: item.taxRateId }}
                          accounts={accounts}
                          rates={rateOptions}
                        />
                      ) : null}
                      <ItemArchive id={item.id} name={item.code} archived={archived} />
                    </span>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

export async function TaxSection({ page, archived }: { readonly page: LedgerPage; readonly archived: boolean }) {
  const [rates, chart] = await Promise.all([listTaxRates(page.ctx, { archived }), listChart(page.ctx)]);
  const manage = page.can('settings:manage');
  const accounts = chart.filter((row) => row.type === 'liability').map((row) => ({ value: row.id, label: `${row.number} ${row.name}` }));
  return (
    <>
      <Toolbar note={manage ? 'A rate is fixed once an invoice uses it. To charge another percent, add a new rate and archive the old one.' : readOnlyNote}>
        <CsvLinks stream="tax_rates" file="tax_rates.csv" canImport={manage && page.can('import:run')} canExport={page.can('export:run')} />
        {manage && !archived ? <TaxRateForm rate={null} accounts={accounts} /> : null}
      </Toolbar>
      {rates.length === 0 ? (
        <EmptyState title={archived ? 'No archived rates' : 'No tax rates yet'} description="Add the sales tax rates you charge. Ledger adds tax line by line, only on lines you mark as taxed." illustration="workspace" />
      ) : (
        <Table aria-label="Tax rates" data-testid="tax-table">
          <TableHead>
            <tr>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell numeric>Rate</TableHeaderCell>
              <TableHeaderCell>Owed on</TableHeaderCell>
              <TableHeaderCell>Agency</TableHeaderCell>
              {manage ? <TableHeaderCell className="text-right">Change</TableHeaderCell> : null}
            </tr>
          </TableHead>
          <TableBody>
            {rates.map((rate) => (
              <TableRow key={rate.id} data-testid="tax-row">
                <TableCell>
                  {rate.name}
                  {rate.inUse ? <Badge className="ml-2">Used</Badge> : null}
                </TableCell>
                <TableCell numeric>{ratePctText(rate.rateMillionths)}%</TableCell>
                <TableCell className="text-fg-secondary">{rate.accountLabel}</TableCell>
                <TableCell>{rate.agency ?? ''}</TableCell>
                {manage ? (
                  <TableCell className="text-right">
                    <span className="inline-flex gap-1">
                      {!archived ? (
                        <TaxRateForm
                          rate={{ id: rate.id, version: rate.version, name: rate.name, ratePct: ratePctText(rate.rateMillionths), accountId: rate.accountId, agency: rate.agency, inUse: rate.inUse }}
                          accounts={accounts}
                        />
                      ) : null}
                      <TaxRateArchive id={rate.id} name={rate.name} archived={archived} />
                    </span>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

export async function TermsSection({ page, archived }: { readonly page: LedgerPage; readonly archived: boolean }) {
  const rows = await listPaymentTerms(page.ctx, { archived });
  const manage = page.can('settings:manage');
  return (
    <>
      <Toolbar note={manage ? 'The default terms go on new customers and invoices unless a customer has their own.' : readOnlyNote}>{manage && !archived ? <TermsForm terms={null} /> : null}</Toolbar>
      {rows.length === 0 ? (
        <EmptyState title="No archived terms" description="Archived terms leave pickers. Invoices that used them keep their due dates." illustration="workspace" />
      ) : (
        <Table aria-label="Payment terms" data-testid="terms-list">
          <TableHead>
            <tr>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>When it is due</TableHeaderCell>
              {manage ? <TableHeaderCell className="text-right">Change</TableHeaderCell> : null}
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-testid="terms-row">
                <TableCell>
                  {row.name}
                  {row.isDefault ? <Badge tone="info" className="ml-2">Default</Badge> : null}
                </TableCell>
                <TableCell className="text-fg-secondary">{termsWords(row)}</TableCell>
                {manage ? (
                  <TableCell className="text-right">
                    <span className="inline-flex gap-1">
                      {!archived && !row.isDefault ? <MakeDefaultTerms id={row.id} name={row.name} /> : null}
                      {!archived ? <TermsForm terms={{ id: row.id, version: row.version, name: row.name, kind: row.kind, days: row.days, dayOfMonth: row.dayOfMonth }} /> : null}
                      {!row.isDefault ? <TermsArchive id={row.id} name={row.name} archived={archived} /> : null}
                    </span>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

export async function AccountsSection({ page, archived }: { readonly page: LedgerPage; readonly archived: boolean }) {
  const [rows, live] = await Promise.all([listChart(page.ctx, { archived }), archived ? listChart(page.ctx) : Promise.resolve(null)]);
  const manage = page.can('settings:manage');
  const parents = (live ?? rows).map((row) => ({ value: row.id, label: `${row.number} ${row.name}` }));
  return (
    <>
      <Toolbar note={manage ? 'Accounts Ledger uses can be renamed and renumbered, never archived. Debits and credits live here and on the Journal.' : readOnlyNote}>
        <CsvLinks stream="accounts" file="accounts.csv" canImport={manage && page.can('import:run')} canExport={page.can('export:run')} />
        {manage && !archived ? <AccountForm account={null} parents={parents} /> : null}
      </Toolbar>
      {rows.length === 0 ? (
        <EmptyState title="No archived accounts" description="Archived accounts keep their history and leave pickers." illustration="workspace" />
      ) : (
        <Table aria-label="Chart of accounts" data-testid="chart-of-accounts">
          <TableHead>
            <tr>
              <TableHeaderCell>Number</TableHeaderCell>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Parent</TableHeaderCell>
              {manage ? <TableHeaderCell className="text-right">Change</TableHeaderCell> : null}
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-testid="account-row">
                <TableCell className="font-mono text-fg-secondary">{row.number}</TableCell>
                <TableCell>
                  {row.name}
                  {row.systemKey ? <Badge className="ml-2">Used by Ledger</Badge> : null}
                </TableCell>
                <TableCell>{TYPE_WORDS[row.type]}</TableCell>
                <TableCell className="text-fg-secondary">{row.parentNumber ?? ''}</TableCell>
                {manage ? (
                  <TableCell className="text-right">
                    <span className="inline-flex gap-1">
                      {!archived ? (
                        <AccountForm
                          account={{ id: row.id, version: row.version, number: row.number, name: row.name, type: row.type, subtype: row.subtype, parentId: row.parentId, description: row.description, pulseCostCategory: row.pulseCostCategory, system: Boolean(row.systemKey) }}
                          parents={parents}
                        />
                      ) : null}
                      {!row.systemKey ? <AccountArchive id={row.id} name={`${row.number} ${row.name}`} archived={archived} /> : null}
                    </span>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

const SOURCE_WORDS: Readonly<Record<MappingSource, { readonly title: string; readonly text: string }>> = {
  wms_operation: { title: 'WMS operation types', text: 'Each line of a WMS bill becomes an invoice line for this item.' },
  program_fee_kind: { title: 'Program fees', text: 'Program per unit, batch, hourly, monthly and minimum fees.' },
  pulse_service: { title: 'Pulse services', text: 'Extra services from Pulse jobs.' },
  pulse_job_type: { title: 'Pulse job types', text: 'Work billed from Pulse by job type.' },
};

export async function AppsSection({ page }: { readonly page: LedgerPage }) {
  const [mappings, items] = await Promise.all([listMappings(page.ctx), listItems(page.ctx)]);
  const manage = page.can('settings:manage');
  const options = items.map((item) => ({ value: item.id, label: `${item.code} ${item.name}` }));
  const sources = (Object.keys(SOURCE_WORDS) as MappingSource[]).filter((source) => KNOWN_MAPPING_KEYS[source].length > 0 || mappings.some((row) => row.source === source));
  return (
    <div className="flex flex-col gap-6" data-testid="source-mappings">
      <p className="text-sm text-fg-secondary">
        WMS, Pulse, Projects, CRM, Crew and Portal connect through the shared database. Below is which item each kind of sibling row becomes on an invoice.
        {manage ? '' : ` ${readOnlyNote}`}
      </p>
      {items.length === 0 ? <p className="text-sm text-warning-text">Add items first, then map each kind of row to one.</p> : null}
      {sources.map((source) => (
        <section key={source} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg">{SOURCE_WORDS[source].title}</h3>
          <p className="text-sm text-fg-muted">{SOURCE_WORDS[source].text}</p>
          <ul className="divide-y divide-border-subtle">
            {mappings
              .filter((row) => row.source === source)
              .map((row) => (
                <li key={`${row.source}:${row.key}`} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-fg">{row.key.replace(/_/g, ' ')}</span>
                  <MappingPicker source={row.source} mappingKey={row.key} itemId={row.itemId} items={options} canManage={manage} />
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
