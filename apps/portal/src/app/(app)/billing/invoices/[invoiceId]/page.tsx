import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Download } from 'lucide-react';
import { formatDay, formatMoney } from '@kitstak/billing/catalog';
import { quoteSummaryLines } from '@kitstak/billing/quote';
import { getBillingProfile, getInvoice, getPlanState } from '@kitstak/billing/server';
import { requireBillingContext } from '@/server/billing/context';
import { env } from '@/server/env';
import { Badge, Card, Eyebrow, buttonVariants, cn } from '@/components/ui';
import { BackLink, BillingHeader, TestModeBadge } from '@/features/billing/billing-chrome';
import { invoiceSeller, invoiceView } from '@/features/billing/invoices/invoice-view';
import { invoiceOutcomeLine, invoiceStatus, invoiceTitle, isCreditInvoice } from '@/features/billing/invoices/invoice-words';

export const metadata: Metadata = { title: 'Invoice' };

/**
 * One invoice on screen (SPEC 6.6): who sells and who buys, the same plan lines as the picker, each
 * discount once, a subtotal that is the sum of the lines above it, tax as its own line, the total
 * and how it was paid.
 */
export default async function InvoicePage({ params }: { readonly params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const context = await requireBillingContext(`/billing/invoices/${invoiceId}`);
  const { rt, org, access, timeZone } = context;
  if (!access.canView) redirect('/billing');
  if (!/^[A-Za-z0-9_]{4,200}$/.test(invoiceId)) notFound();

  // The read is scoped to the session's own organization. Another org's invoice is a 404.
  const invoice = await getInvoice(rt.db, { orgId: org.id, invoiceId });
  if (!invoice) notFound();
  const [profile, state] = await Promise.all([getBillingProfile(rt.db, org.id), getPlanState(rt, org.id)]);
  const status = invoiceStatus(invoice);
  const address = profile.address;
  const addressLines = [
    address.line1,
    address.line2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(', '),
    address.country,
  ].filter((line): line is string => Boolean(line));
  const day = (date: Date) => formatDay(date, timeZone);
  const view = invoiceView(invoice);
  // The list price and the discounts of a plan invoice, as their own rows above the subtotal.
  const summary = view.quote ? quoteSummaryLines(view.quote).filter((row) => row.kind !== 'total') : [];
  // The same seller block as the PDF: one rule in the billing package.
  const seller = invoiceSeller({
    BILLING_SELLER_NAME: env.BILLING_SELLER_NAME,
    BILLING_SELLER_ADDRESS: env.BILLING_SELLER_ADDRESS,
    BILLING_SELLER_TAX_ID: env.BILLING_SELLER_TAX_ID,
    NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL,
  });

  return (
    <div className="flex max-w-[760px] flex-col gap-6">
      <div className="flex flex-col gap-3">
        <BackLink href="/billing/invoices">Invoices</BackLink>
        <BillingHeader
          orgName={org.name}
          title={invoice.number ? `Invoice ${invoice.number}` : 'Invoice'}
          badges={
            <>
              <Badge tone={status.tone}>{status.label}</Badge>
              <TestModeBadge mode={state.mode} />
            </>
          }
          actions={
            <a
              href={`/billing/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noopener"
              data-testid={`invoice-pdf-${invoice.id}`}
              className={cn(buttonVariants({ variant: 'secondary', size: 'xl' }))}
            >
              <Download aria-hidden />
              Download PDF
            </a>
          }
        />
      </div>

      <Card className="p-5 sm:p-6" aria-label="Invoice">
        {/* Who sells and who buys, each with what a bookkeeper needs. */}
        <dl className="grid gap-5 sm:grid-cols-2">
          <div data-testid="invoice-seller">
            <dt><Eyebrow as="span">From</Eyebrow></dt>
            <dd className="mt-1 text-sm font-semibold text-fg">{seller.name}</dd>
            {seller.address.map((line) => (
              <dd key={line} className="text-xs text-fg-muted">{line}</dd>
            ))}
            {seller.taxId ? <dd className="text-xs text-fg-muted">Tax ID: {seller.taxId}</dd> : null}
            <dd className="text-xs text-fg-muted">{seller.site}</dd>
          </div>
          <div data-testid="invoice-buyer">
            <dt><Eyebrow as="span">Billed to</Eyebrow></dt>
            <dd className="mt-1 text-sm font-semibold text-fg">{profile.companyName ?? org.name}</dd>
            {addressLines.map((line) => (
              <dd key={line} className="text-xs text-fg-muted">{line}</dd>
            ))}
            {profile.taxIdValue ? <dd className="text-xs text-fg-muted">Tax ID: {profile.taxIdValue}</dd> : null}
            {addressLines.length === 0 || !profile.taxIdValue ? (
              <dd className="mt-1 text-xs text-fg-muted print:hidden">
                {access.canManage ? (
                  <>
                    Need your address or tax ID on invoices?{' '}
                    <Link href="/billing/details" className="font-semibold text-fg underline decoration-border-strong underline-offset-2 hover:decoration-fg">
                      Add them in Billing details
                    </Link>
                    .
                  </>
                ) : (
                  'An owner or a billing manager can add an address and a tax ID in Billing details.'
                )}
              </dd>
            ) : null}
          </div>
        </dl>
        <dl className="mt-5 grid gap-5 border-t border-border-subtle pt-5 sm:grid-cols-2">
          <div>
            <dt><Eyebrow as="span">Date</Eyebrow></dt>
            <dd className="mt-1 text-sm font-semibold text-fg">{day(invoice.issuedAt)}</dd>
          </div>
          <div>
            <dt><Eyebrow as="span">For</Eyebrow></dt>
            <dd className="mt-1 text-sm font-semibold text-fg">{invoiceTitle(invoice)}</dd>
            {invoice.periodStart && invoice.periodEnd ? (
              <dd className="text-xs text-fg-muted">
                {day(invoice.periodStart)} to {day(invoice.periodEnd)}
              </dd>
            ) : null}
          </div>
        </dl>

        {view.quote ? (
          // A plan invoice reads like the picker and the review step: the same lines, the same math.
          <div className="mt-6" data-testid="invoice-plan-lines">
            <Eyebrow>Your plan</Eyebrow>
            <ul className="mt-2 flex flex-col gap-1.5 border-b border-border-subtle pb-3">
              {view.quote.lines.map((line) => (
                <li key={line.product} data-testid={`invoice-line-${line.product}`} className="text-sm text-fg">
                  {line.math}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <table className="mt-6 w-full text-left text-sm" data-testid="invoice-raw-lines">
            <thead>
              <tr className="border-b border-border-default text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">
                <th scope="col" className="py-2 pr-3">What</th>
                <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">Count</th>
                <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">Each</th>
                <th scope="col" className="py-2 pl-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {view.rawLines.map((line, index) => (
                <tr key={`${line.description}-${index}`}>
                  <td className="py-2.5 pr-3 text-fg">
                    {line.description}
                    <span className="block text-xs text-fg-muted sm:hidden">
                      {line.quantity} x {formatMoney(line.unitCents)}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2.5 text-right text-fg-secondary sm:table-cell">{line.quantity}</td>
                  <td className="hidden px-3 py-2.5 text-right text-fg-secondary sm:table-cell">{formatMoney(line.unitCents)}</td>
                  <td className="py-2.5 pl-3 text-right font-medium text-fg">{formatMoney(line.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Top to bottom this is one sum: every row is printed once, and each total is the rows above it. */}
        <dl className={cn('ml-auto flex max-w-sm flex-col gap-1.5 text-sm', view.quote ? 'mt-3' : 'mt-4 border-t border-border-default pt-4')} data-testid="invoice-totals">
          {summary.map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <dt className="text-fg-secondary">{row.label}</dt>
              <dd className={cn('tabular-nums', row.amountCents < 0 ? 'font-medium text-success-text' : 'text-fg')}>{formatMoney(row.amountCents)}</dd>
            </div>
          ))}
          <div className={cn('flex justify-between gap-4', summary.length > 0 && 'mt-1 border-t border-border-subtle pt-2')}>
            <dt className="font-medium text-fg">Subtotal</dt>
            <dd data-testid="invoice-subtotal" className="font-medium text-fg tabular-nums">{formatMoney(view.subtotalCents)}</dd>
          </div>
          {view.adjustments.map((entry) => (
            <div key={entry.label} className="flex justify-between gap-4" data-testid="invoice-adjustment">
              <dt className="text-fg-secondary">{entry.label}</dt>
              <dd className="font-medium text-success-text tabular-nums">{formatMoney(entry.amountCents)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4">
            <dt className="text-fg-secondary">Sales tax</dt>
            <dd className="text-fg tabular-nums">{formatMoney(invoice.taxCents)}</dd>
          </div>
          <div className="mt-1 flex justify-between gap-4 border-t border-border-subtle pt-2">
            <dt className="font-semibold text-fg">Total</dt>
            <dd data-testid="invoice-total" className="text-md font-semibold text-fg tabular-nums">{formatMoney(invoice.totalCents)}</dd>
          </div>
          {isCreditInvoice(invoice) ? (
            <div className="flex justify-between gap-4" data-testid="invoice-credit-added">
              <dt className="text-fg-secondary">Added to your credit</dt>
              <dd className="font-medium text-success-text tabular-nums">{formatMoney(-invoice.totalCents)}</dd>
            </div>
          ) : (
            <div className="flex justify-between gap-4">
              <dt className="text-fg-secondary">Paid</dt>
              <dd className="text-fg tabular-nums">{formatMoney(invoice.amountPaidCents)}</dd>
            </div>
          )}
          {invoice.refundedCents > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="text-fg-secondary">Sent back to your card</dt>
              <dd className="text-fg tabular-nums">{formatMoney(invoice.refundedCents)}</dd>
            </div>
          ) : null}
          {invoice.amountDueCents > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="font-semibold text-warning-text">Still due</dt>
              <dd className="font-semibold text-warning-text tabular-nums">{formatMoney(invoice.amountDueCents)}</dd>
            </div>
          ) : null}
        </dl>

        <p data-testid="invoice-outcome" className="mt-5 border-t border-border-subtle pt-4 text-sm text-fg-secondary">
          {invoiceOutcomeLine(invoice, { day, money: formatMoney })}
        </p>
      </Card>
    </div>
  );
}
