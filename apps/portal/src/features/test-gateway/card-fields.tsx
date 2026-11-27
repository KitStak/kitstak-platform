'use client';
/** The pretend card form of the test gateway: one tap test cards, friendly formatting, real autofill hints. */
import { CreditCard } from 'lucide-react';
import type { TestCardOutcome } from '@kitstak/billing/gateway/test';
import { Field, Input, cn } from '@/components/ui';

export interface TestCardChoice {
  readonly number: string;
  readonly label: string;
  readonly outcome: TestCardOutcome;
}

export interface CardValues {
  readonly cardNumber: string;
  readonly expiry: string;
  readonly cvc: string;
}

export function formatCardNumber(raw: string): string {
  return raw
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

export function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)} / ${digits.slice(2)}`;
}

/** '12 / 34' to month 12 and year 34. Zeros when the text is not complete yet; the gateway then says so. */
export function parseExpiry(text: string): { expMonth: number; expYear: number } {
  const digits = text.replace(/\D/g, '');
  return { expMonth: Number(digits.slice(0, 2)) || 0, expYear: Number(digits.slice(2, 4)) || 0 };
}

export function CardFields({
  cards,
  values,
  onChange,
  disabled,
}: {
  readonly cards: readonly TestCardChoice[];
  readonly values: CardValues;
  readonly onChange: (next: CardValues) => void;
  readonly disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p id="test-cards-label" className="text-xs font-medium text-fg-secondary">
          Tap a test card
        </p>
        <div role="group" aria-labelledby="test-cards-label" className="mt-2 flex flex-wrap gap-2">
          {cards.map((card) => {
            const on = values.cardNumber.replace(/\s/g, '') === card.number.replace(/\s/g, '');
            return (
              <button
                key={card.outcome}
                type="button"
                disabled={disabled}
                data-testid={`test-card-chip-${card.outcome}`}
                aria-pressed={on}
                onClick={() => onChange({ cardNumber: formatCardNumber(card.number), expiry: '12 / 34', cvc: '123' })}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-medium text-fg sm:min-h-9 sm:pointer-coarse:min-h-11',
                  'transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50',
                  on ? 'border-primary bg-primary-subtle/50' : 'border-border-input bg-panel hover:border-border-input-hover hover:bg-muted',
                )}
              >
                {card.label}
              </button>
            );
          })}
        </div>
      </div>

      <Field label="Card number">
        {({ inputId }) => (
          <Input
            id={inputId}
            size="lg"
            data-testid="test-card-number"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="4242 4242 4242 4242"
            disabled={disabled}
            value={values.cardNumber}
            onChange={(event) => onChange({ ...values, cardNumber: formatCardNumber(event.target.value) })}
            leadingIcon={<CreditCard aria-hidden />}
            className="tabular-nums"
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Expires">
          {({ inputId }) => (
            <Input
              id={inputId}
              size="lg"
              data-testid="test-card-expiry"
              inputMode="numeric"
              autoComplete="cc-exp"
              placeholder="MM / YY"
              disabled={disabled}
              value={values.expiry}
              onChange={(event) => onChange({ ...values, expiry: formatExpiry(event.target.value) })}
              className="tabular-nums"
            />
          )}
        </Field>
        <Field label="Security code">
          {({ inputId }) => (
            <Input
              id={inputId}
              size="lg"
              data-testid="test-card-cvc"
              inputMode="numeric"
              autoComplete="cc-csc"
              placeholder="123"
              disabled={disabled}
              value={values.cvc}
              onChange={(event) => onChange({ ...values, cvc: event.target.value.replace(/\D/g, '').slice(0, 4) })}
              className="tabular-nums"
            />
          )}
        </Field>
      </div>
    </div>
  );
}
