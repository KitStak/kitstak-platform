'use client';
import { useState, type FormEvent } from 'react';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { Button, buttonVariants, cn } from '@/components/ui';
import { testCompleteCardUpdateAction } from '@/server/billing-actions';
import { CardFields, parseExpiry, type CardValues, type TestCardChoice } from './card-fields';

/** The test gateway's "update card" page. Stands in for the Stripe Billing Portal card step. */
export function TestCardUpdate({ sessionId, cards, returnUrl }: { readonly sessionId: string; readonly cards: readonly TestCardChoice[]; readonly returnUrl: string }) {
  const [card, setCard] = useState<CardValues>({ cardNumber: '', expiry: '', cvc: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await testCompleteCardUpdateAction({ sessionId, cardNumber: card.cardNumber, ...parseExpiry(card.expiry), cvc: card.cvc });
      if (result.ok) {
        window.location.assign(result.data.redirectUrl);
        return;
      }
      setError(result.error.message);
    } catch {
      setError('We could not reach KitStak. Your card was not changed. Check your connection and try again.');
    }
    setPending(false);
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <CardFields cards={cards} values={card} onChange={(next) => { setCard(next); setError(null); }} disabled={pending} />
      {error ? (
        <p role="alert" data-testid="test-error" className="flex items-start gap-1.5 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5 text-sm font-medium text-danger-text">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
      <Button type="submit" size="xl" fullWidth data-testid="test-pay" loading={pending}>
        Save this card
      </Button>
      <a href={returnUrl.replace(/[?&]updated=card/, '')} data-testid="test-back" className={cn(buttonVariants({ variant: 'ghost', size: 'xl', fullWidth: true }))}>
        <ArrowLeft aria-hidden />
        Back. Keep my card.
      </a>
    </form>
  );
}
