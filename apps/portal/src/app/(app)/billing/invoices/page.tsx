import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Download, Receipt } from 'lucide-react';
import { formatDay, formatMoney } from '@kitstak/billing/catalog';
import { getPlanState, listInvoices } from '@kitstak/billing/server';
import { requireBillingContext } from '@/server/billing/context';
import { Badge, Card, LinkButton, cn } from '@/components/ui';
import { BillingHeader, TestModeBadge } from '@/features/billing/billing-chrome';
import { invoiceStatus, invoiceTitle } from '@/features/billing/invoices/invoice-words';

export const metadata: Metadata = { title: 'Invoices' };

const PAGE_SIZE = 24;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Every invoice, newest first, each with its PDF (SPEC 6.6). */
export default async function InvoicesPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await requireBillingContext('/billing/invoices');
  const { rt, org, access, timeZone } = context;
  if (!access.canView) redirect('/billing');

  const beforeParam = first(params.before);
  const beforeDate = beforeParam ? new Date(beforeParam) : null;
  const before = beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : undefined;
  const [state, found] = await Promise.all([
    getPlanState(rt, org.id),
    listInvoices(rt.db, { orgId: org.id, limit: PAGE_SIZE + 1, before }),
  ]);
  const invoices = found.slice(0, PAGE_SIZE);
  const last = invoices[invoices.length - 1];
  const hasMore = found.length > PAGE_SIZE && last !== undefined;

  return (
    <div className="flex flex-col gap-6">
      <BillingHeader
        orgName={org.name}
        title="Invoices"
        description="Every bill and receipt, newest first. Each one has a PDF you can save or send to your books."
        badges={<TestModeBadge mode={state.mode} />}
      />

      {invoices.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-sunken text-icon">
            <Receipt aria-hidden className="size-6" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-fg">{before ? 'No older invoices.' : 'No invoices yet.'}</h2>
          <p className="mt-1 max-w-sm text-sm text-fg-secondary">
            {before
              ? 'You have seen them all.'
              : state.phase === 'trial' || state.phase === 'none'
                ? 'Your first one arrives when your trial ends.'
                : 'Your first one arrives with your first payment.'}
          </p>
          <LinkButton href={before ? '/billing/invoices' : '/billing'} variant="secondary" size="lg" className="mt-5">
            {before ? 'Back to the newest' : 'Back to Billing'}
          </LinkButton>
        </Card>
      ) : (
        <Card className="overflow-hidden" aria-label="Invoices">
          {/* A real table from 640 px. On phones each invoice is a stacked row, so nothing scrolls sideways. */}
          <table className="w-full text-left text-sm">
            <thead className="hidden sm:table-header-group">
              <tr className="border-b border-border-subtle bg-sunken text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">
                <th scope="col" className="px-5 py-3">Date</th>
                <th scope="col" className="px-5 py-3">Number</th>
                <th scope="col" className="px-5 py-3">For</th>
                <th scope="col" className="px-5 py-3 text-right">Amount</th>
                <th scope="col" className="px-5 py-3">Status</th>
                <th scope="col" className="px-5 py-3 text-right">
                  <span className="sr-only">PDF</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {invoices.map((invoice) => {
                const status = invoiceStatus(invoice);
                const date = formatDay(invoice.issuedAt, timeZone);
                return (
                  <tr key={invoice.id} data-testid={`invoice-row-${invoice.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5 sm:table-row sm:p-0">
                    <td className="basis-full font-semibold text-fg sm:basis-auto sm:px-5 sm:py-3.5">
                      <Link href={`/billing/invoices/${invoice.id}`} className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                        {date}
                      </Link>
                    </td>
                    <td className="text-fg-secondary sm:px-5 sm:py-3.5">{invoice.number ?? 'Pending'}</td>
                    <td className="text-fg-secondary sm:px-5 sm:py-3.5">{invoiceTitle(invoice)}</td>
                    <td className="ml-auto font-semibold text-fg tabular-nums sm:ml-0 sm:px-5 sm:py-3.5 sm:text-right">{formatMoney(invoice.totalCents)}</td>
                    <td className="sm:px-5 sm:py-3.5">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="sm:px-5 sm:py-2 sm:text-right">
                      <a
                        href={`/billing/invoices/${invoice.id}/pdf`}
                        target="_blank"
                        rel="noopener"
                        data-testid={`invoice-pdf-${invoice.id}`}
                        aria-label={`PDF of invoice ${invoice.number ?? date}`}
                        className={cn(
                          'inline-flex h-9 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg',
                          'hover:border-border-input-hover hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                        )}
                      >
                        <Download aria-hidden className="size-4" />
                        PDF
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {hasMore && last ? (
        <div className="flex justify-center">
          <LinkButton href={`/billing/invoices?before=${encodeURIComponent(last.issuedAt.toISOString())}`} variant="secondary" size="lg">
            Older invoices
          </LinkButton>
        </div>
      ) : null}
    </div>
  );
}
