import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Download } from 'lucide-react';
import { formatDay, formatMoney } from '@kitstak/billing/catalog';
import { getBillingProfile, getInvoice, getPlanState } from '@kitstak/billing/server';
import { requireBillingContext } from '@/server/billing/context';
import { Badge, Card, Eyebrow, buttonVariants, cn } from '@/components/ui';
import { BackLink, BillingHeader, TestModeBadge } from '@/features/billing/billing-chrome';
import { invoiceStatus, invoiceTitle } from '@/features/billing/invoices/invoice-words';

export const metadata: Metadata = { title: 'Invoice' };

/** One invoice on screen (SPEC 6.6): lines, discounts, tax as its own line, total, how it was paid. */
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
        <dl className="grid gap-5 sm:grid-cols-3">
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
          <div>
            <dt><Eyebrow as="span">Billed to</Eyebrow></dt>
            <dd className="mt-1 text-sm font-semibold text-fg">{profile.companyName ?? org.name}</dd>
            {addressLines.map((line) => (
              <dd key={line} className="text-xs text-fg-muted">{line}</dd>
            ))}
            {profile.taxIdValue ? <dd className="text-xs text-fg-muted">Tax ID: {profile.taxIdValue}</dd> : null}
          </div>
        </dl>

        <table className="mt-6 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-default text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">
              <th scope="col" className="py-2 pr-3">What</th>
              <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">Count</th>
              <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">Each</th>
              <th scope="col" className="py-2 pl-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {invoice.lines.map((line, index) => (
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

        <dl className="mt-4 ml-auto flex max-w-xs flex-col gap-1.5 border-t border-border-default pt-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-secondary">Subtotal</dt>
            <dd className="text-fg tabular-nums">{formatMoney(invoice.subtotalCents)}</dd>
          </div>
          {invoice.discountCents > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="text-fg-secondary">Discount</dt>
              <dd className="font-medium text-success-text tabular-nums">{formatMoney(-invoice.discountCents)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <dt className="text-fg-secondary">Sales tax</dt>
            <dd className="text-fg tabular-nums">{formatMoney(invoice.taxCents)}</dd>
          </div>
          <div className="mt-1 flex justify-between gap-4 border-t border-border-subtle pt-2">
            <dt className="font-semibold text-fg">Total</dt>
            <dd className="text-md font-semibold text-fg tabular-nums">{formatMoney(invoice.totalCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-secondary">Paid</dt>
            <dd className="text-fg tabular-nums">{formatMoney(invoice.amountPaidCents)}</dd>
          </div>
          {invoice.amountDueCents > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="font-semibold text-warning-text">Still due</dt>
              <dd className="font-semibold text-warning-text tabular-nums">{formatMoney(invoice.amountDueCents)}</dd>
            </div>
          ) : null}
        </dl>

        <p className="mt-5 border-t border-border-subtle pt-4 text-sm text-fg-secondary">
          {invoice.status === 'paid' && invoice.paidAt
            ? `Paid on ${day(invoice.paidAt)}${invoice.paymentMethodLast4 ? ` with the card ending ${invoice.paymentMethodLast4}` : ''}.`
            : invoice.status === 'open'
              ? 'This invoice is not paid yet. Go to Billing to pay it or to update your card.'
              : invoice.status === 'void'
                ? 'This invoice was canceled. Nothing is owed on it.'
                : 'This invoice is closed.'}
        </p>
      </Card>
    </div>
  );
}
