'use client';
/**
 * The test gateway's pay page (SPEC 7.2). It stands in for Stripe Checkout when no Stripe key is set
 * outside production. Every result goes through the same signed webhook path as Stripe: this form
 * only talks to server actions, and those never write access rows themselves.
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CircleAlert, Landmark, Lock } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { testCancelCheckoutAction, testCompleteCheckoutAction } from '@/server/billing-actions';
import { CardFields, parseExpiry, type CardValues, type TestCardChoice } from './card-fields';

export interface TestCheckoutProps {
  readonly sessionId: string;
  readonly cards: readonly TestCardChoice[];
  readonly payLabel: string;
  readonly promoCode: string;
  /** True when the page loads while a card still waits for the pretend bank step. */
  readonly startAtBank: boolean;
  readonly defaultName: string;
}

export function TestCheckout({ sessionId, cards, payLabel, promoCode, startAtBank, defaultName }: TestCheckoutProps) {
  const router = useRouter();
  const [card, setCard] = useState<CardValues>({ cardNumber: '', expiry: '', cvc: '' });
  const [name, setName] = useState(defaultName);
  const [postalCode, setPostalCode] = useState('');
  const [promo, setPromo] = useState('');
  const [step, setStep] = useState<'card' | 'bank'>(startAtBank ? 'bank' : 'card');
  const [busy, setBusy] = useState<'pay' | 'back' | 'approve' | 'fail' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (kind: 'pay' | 'approve' | 'fail') => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const result = await testCompleteCheckoutAction({
        sessionId,
        cardNumber: card.cardNumber,
        ...parseExpiry(card.expiry),
        cvc: card.cvc,
        name,
        postalCode,
        promoCode: promo.trim() || undefined,
        approve3ds: kind === 'pay' ? undefined : kind === 'approve',
      });
      if (result.ok) {
        if (result.data.status === 'requires_action') {
          setStep('bank');
          setBusy(null);
          return;
        }
        window.location.assign(result.data.redirectUrl);
        return;
      }
      // A decline changes nothing. The person stays here with what they typed.
      setStep('card');
      setError(result.error.message);
    } catch {
      setError('We could not reach KitStak. Nothing was charged. Check your connection and try again.');
    }
    setBusy(null);
  };

  const back = async () => {
    if (busy) return;
    setBusy('back');
    try {
      const result = await testCancelCheckoutAction({ sessionId });
      if (result.ok) window.location.assign(result.data.redirectUrl);
      else router.push('/billing/checkout/canceled');
    } catch {
      router.push('/billing/checkout/canceled');
    }
  };

  if (step === 'bank') {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center" role="group" aria-labelledby="test-bank-heading">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-info-subtle text-info-text">
          <Landmark aria-hidden className="size-6" />
        </span>
        <div>
          <h2 id="test-bank-heading" className="text-lg font-semibold text-fg">
            Your bank wants to check this payment
          </h2>
          <p className="mt-1 text-sm text-fg-secondary">This is a pretend bank step. Pick what the bank says.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <Button size="xl" data-testid="test-3ds-approve" loading={busy === 'approve'} disabled={busy !== null && busy !== 'approve'} onClick={() => send('approve')}>
            Approve
          </Button>
          <Button size="xl" variant="secondary" data-testid="test-3ds-fail" loading={busy === 'fail'} disabled={busy !== null && busy !== 'fail'} onClick={() => send('fail')}>
            Fail
          </Button>
        </div>
      </div>
    );
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send('pay');
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <CardFields cards={cards} values={card} onChange={(next) => { setCard(next); setError(null); }} disabled={busy !== null} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name on card">
          {({ inputId }) => <Input id={inputId} size="lg" autoComplete="cc-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />}
        </Field>
        <Field label="ZIP or postal code">
          {({ inputId }) => (
            <Input id={inputId} size="lg" autoComplete="postal-code" value={postalCode} onChange={(event) => setPostalCode(event.target.value)} maxLength={20} />
          )}
        </Field>
      </div>
      <Field label="Promo code" hint={`Optional. In test mode, ${promoCode} gives 10% off your first charge.`}>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            size="lg"
            data-testid="test-promo"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={promo}
            onChange={(event) => { setPromo(event.target.value.toUpperCase()); setError(null); }}
            maxLength={40}
            aria-describedby={describedBy}
          />
        )}
      </Field>
      {promo.trim() === promoCode ? (
        <p role="status" className="rounded-lg bg-success-subtle px-3 py-2 text-sm font-medium text-success-text">
          Promo code {promoCode}: 10% off your first charge. It shows as its own line on that invoice.
        </p>
      ) : null}

      {error ? (
        <p role="alert" data-testid="test-error" className="flex items-start gap-1.5 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5 text-sm font-medium text-danger-text">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <Button type="submit" size="xl" fullWidth data-testid="test-pay" loading={busy === 'pay'} disabled={busy !== null && busy !== 'pay'} leadingIcon={<Lock aria-hidden />}>
        {payLabel}
      </Button>
      <Button type="button" variant="ghost" size="xl" fullWidth data-testid="test-back" loading={busy === 'back'} disabled={busy !== null && busy !== 'back'} leadingIcon={<ArrowLeft aria-hidden />} onClick={back}>
        Back. Do not pay.
      </Button>
    </form>
  );
}
