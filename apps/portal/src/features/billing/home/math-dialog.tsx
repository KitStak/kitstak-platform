'use client';
import type { Quote } from '@kitstak/billing/quote';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui';
import { QuoteSummary } from '../quote-summary';

/** "See the math": the same lines as the picker, in a dialog. */
export function MathDialog({ quote, totalLabel }: { readonly quote: Quote; readonly totalLabel?: string }) {
  return (
    <Dialog>
      <DialogTrigger className="inline-flex min-h-9 items-center rounded-md text-sm font-semibold text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        See the math
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogTitle>How your price adds up</DialogTitle>
        <DialogDescription>Every line comes from the public price list. Tax, if any, is added on the invoice.</DialogDescription>
        <QuoteSummary quote={quote} totalLabel={totalLabel} className="mt-5" />
      </DialogContent>
    </Dialog>
  );
}
