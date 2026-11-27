'use client';
/**
 * Step 3 Price card (docs/programs/SPEC.md 5.4): the card start date, work charges (per unit with
 * rates by variant, per batch, per hour), fixed lines (monthly fee, setup fees), the minimum, the
 * CRM deal callout, live math from `projectMonth`, and "Set prices later".
 */
import { Calculator, Handshake, Info, Clock } from 'lucide-react';
import { dealCallout, dealPrefill } from '@kitstak/programs-engine';
import { Badge, Button, IsoDatePicker } from '@/components/ui';
import { OneTimeChargesEditor, PriceLinesEditor, centsToDollars, rateHint } from '@/features/programs/editors';
import { moneyText, oneRunCents, setTypedRate, unitOf, unitsInMonthText, variantRates, wizardProjection, wizardVariants, type WizardEnv } from './wizard-model';
import type { StepProps } from './wizard-types';

export interface StepPriceProps extends StepProps {
  readonly env: WizardEnv;
  readonly onLater: () => void;
}

export function StepPrice({ state, set, data, problems, showErrors, env, onLater }: StepPriceProps) {
  const unit = unitOf(state.basics);
  const variants = wizardVariants(state);
  const rates = variantRates(state);
  const typed: Record<string, string> = {};
  for (const variant of variants) if (variant.typedRate) typed[variant.key] = variant.typedRate;
  const projection = wizardProjection(state, env);
  const run = oneRunCents(state);
  const deal = state.start.mode === 'deal' ? data.deal : null;
  const callout = deal ? dealCallout({ valueCents: deal.valueCents === null ? null : BigInt(deal.valueCents), termMonths: deal.termMonths }) : null;
  const currencyNote = deal ? dealPrefill({ deal: { currency: deal.currency, valueCents: deal.valueCents === null ? null : BigInt(deal.valueCents), rates: {} }, programCurrency: 'USD' }).currencyNote : null;
  const fromDeal = <Badge tone="info" icon={<Handshake aria-hidden />}>From deal</Badge>;
  const errors = showErrors ? problems : {};

  if (state.price.later) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-border-subtle bg-panel p-5 shadow-xs" data-testid="wizard-price-later">
        <h3 className="text-base font-semibold text-fg">Prices come later</h3>
        <p className="max-w-[560px] text-sm text-fg-secondary">The program starts without a price card. Output is logged as No price until you publish one, and then the open days get their prices.</p>
        <Button onClick={() => set((s) => ({ ...s, price: { ...s.price, later: false } }))}>Add prices now</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="wizard-price">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5" data-field="effectiveFrom">
          <span className="text-xs font-medium text-fg-secondary">Starts</span>
          <IsoDatePicker value={state.price.effectiveFrom} onChange={(date) => (date ? set((s) => ({ ...s, price: { ...s.price, effectiveFrom: date } })) : undefined)} aria-label="Price card starts" className="w-44" />
          {errors.effectiveFrom ? <span role="alert" className="text-2xs font-medium text-danger-text">{errors.effectiveFrom}</span> : <span className="text-2xs text-fg-muted">Version 1 is in force from this day.</span>}
        </div>
      </div>

      {deal && currencyNote ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle/60 px-3 py-2.5 text-sm text-warning-text">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {currencyNote}
        </p>
      ) : callout ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info-subtle/50 px-3 py-2.5" data-testid="deal-callout">
          <Handshake aria-hidden className="size-4 shrink-0 text-info-text" />
          <p className="min-w-0 flex-1 text-sm text-fg">{callout.text}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => set((s) => ({ ...s, price: { ...s.price, lines: { ...s.price.lines, minimum: { ...s.price.lines.minimum, on: true, amount: centsToDollars(callout.monthlyCents.toString()) } }, fromDeal: [...new Set([...s.price.fromDeal, 'minimum' as const])] } }))}>Use as monthly minimum</Button>
            <Button size="sm" variant="secondary" onClick={() => set((s) => ({ ...s, basics: { ...s.basics, target: centsToDollars(callout.monthlyCents.toString()) } }))}>Use as target</Button>
          </div>
        </div>
      ) : null}

      {showErrors && problems.lines ? <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-sm font-medium text-danger-text" data-field="lines">{problems.lines}</p> : null}

      <PriceLinesEditor
        value={{ ...state.price.lines, variantRates: typed }}
        onChange={(value) =>
          set((s) => {
            let next = { ...s, price: { ...s.price, lines: { ...value, variantRates: {} } } };
            const before = new Map(wizardVariants(s).map((variant) => [variant.key, variant.typedRate ?? '']));
            for (const [key, rate] of Object.entries(value.variantRates)) if ((before.get(key) ?? '') !== rate) next = setTypedRate(next, key, rate);
            for (const [key, rate] of before) if (rate && !(key in value.variantRates)) next = setTypedRate(next, key, '');
            return next;
          })
        }
        unit={unit}
        variants={variants.map((variant) => {
          const rate = rates.get(variant.key);
          return { key: variant.key, name: variant.name, color: variant.color, hint: rate && rate.source !== 'typed' ? rateHint(rate.price, rate.source) : null };
        })}
        errors={errors}
        sourceChips={{
          ...(state.price.fromDeal.includes('perUnit') ? { perUnit: fromDeal } : {}),
          ...(state.price.fromDeal.includes('monthlyFee') ? { monthlyFee: fromDeal } : {}),
          ...(state.price.fromDeal.includes('minimum') ? { minimum: fromDeal } : {}),
        }}
      />

      <section className="rounded-xl border border-border-subtle bg-panel p-4 shadow-xs">
        <OneTimeChargesEditor rows={state.price.oneTime} onChange={(rows) => set((s) => ({ ...s, price: { ...s.price, oneTime: rows } }))} defaultDate={state.basics.startDate} notBefore={state.basics.startDate} addLabel={state.price.oneTime.length ? 'Add another setup fee' : 'Add a setup fee'} showErrors={showErrors} />
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-sunken/60 p-4" aria-live="polite" data-testid="price-math">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg"><Calculator aria-hidden className="size-4 text-icon" />What this card earns</h3>
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-fg-secondary">One run of every variant earns</dt>
            <dd className="font-semibold text-fg tabular-nums">{run === null ? 'Add rates to see this' : moneyText(run)}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-fg-secondary">A month at this schedule earns about</dt>
            <dd className="text-right font-semibold text-fg tabular-nums" data-testid="price-math-month">
              {!projection.hasSchedule ? 'Add a schedule to see this' : projection.totalCents === null ? unitsInMonthText(projection, unit) : `${moneyText(projection.totalCents)} · ${projection.basisText}`}
            </dd>
          </div>
        </dl>
        {projection.hoursNotProjected ? <p className="flex items-center gap-1.5 text-xs text-fg-muted"><Clock aria-hidden className="size-3.5" />Hourly work is not in this estimate.</p> : null}
        {!projection.hasSchedule ? <p className="text-xs text-fg-muted">The schedule comes next. Until then the month counts only fixed lines.</p> : null}
      </section>

      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        <Button variant="ghost" onClick={onLater} data-testid="price-later">Set prices later</Button>
        <span>Make the program now and add the card from its Price card tab.</span>
      </div>
    </div>
  );
}
