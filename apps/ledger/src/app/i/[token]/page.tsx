import type { Metadata } from 'next';
import { findPublicInvoice } from '@/server/domain/public-links';
import { formatCents } from '@/lib/money';
import { LedgerMark } from '@/features/shell/logo';

export const metadata: Metadata = { title: 'Invoice', robots: { index: false, follow: false } };

/** Public invoice page (SPEC 4.5.8): no login, no shell, only the one invoice the link names. */
export default async function PublicInvoicePage({ params }: { readonly params: Promise<{ readonly token: string }> }) {
  const { token } = await params;
  const invoice = await findPublicInvoice(token);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-app p-6">
      <div className="w-full max-w-md rounded-2xl border border-border-subtle bg-panel p-8 shadow-sm" data-testid="public-invoice">
        {invoice ? (
          <>
            <p className="text-sm text-fg-muted">{invoice.orgName}</p>
            <h1 className="mt-1 text-2xl font-semibold text-fg">Invoice {invoice.number}</h1>
            <dl className="mt-5 grid grid-cols-2 gap-y-2 text-base">
              <dt className="text-fg-secondary">Total</dt>
              <dd className="text-right tabular-nums">{formatCents(invoice.totalCents)}</dd>
              <dt className="text-fg-secondary">Still to pay</dt>
              <dd className="text-right font-semibold tabular-nums">{formatCents(invoice.balanceCents)}</dd>
              {invoice.dueDate ? (
                <>
                  <dt className="text-fg-secondary">Due</dt>
                  <dd className="text-right tabular-nums">{invoice.dueDate}</dd>
                </>
              ) : null}
            </dl>
          </>
        ) : (
          <>
            <LedgerMark size={34} />
            <h1 className="mt-4 text-xl font-semibold text-fg">This link does not open an invoice</h1>
            <p className="mt-2 text-base text-fg-secondary">It may have expired or been replaced. Ask the company that sent it for a new link.</p>
          </>
        )}
      </div>
    </main>
  );
}
