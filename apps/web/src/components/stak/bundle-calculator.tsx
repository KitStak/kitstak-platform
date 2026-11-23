'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  BUNDLE_OFF,
  MAX_SEATS,
  MAX_WAREHOUSES,
  TRIAL_LINE,
  formatMoney,
  isBundle,
  listPrice,
  monthlyTerms,
  normalizeSelection,
  priceOf,
  quote,
} from '@/lib/pricing';
import { CALCULATOR_START, selectionFromSearch } from '@/lib/calculator';
import type { CalculatorSource } from '@/lib/calculator';
import type { PlanSelection } from '@/lib/pricing';
import { trialUrl, wizardHref } from '@/lib/stak';
import {
  PRODUCT_IDS,
  ROUTES,
  START_NAME,
  WALKTHROUGH_LABEL,
  availabilityLabel,
  startableStack,
  toggleProduct,
  walkthroughHref,
  START_LABEL,
  HELP_LABEL,
} from '../site-links';
import type { ProductId } from '../site-links';
import { BillingToggle, QuoteSummary, StakVisual, Stepper, perPeriod } from './stak-parts';
import styles from './bundle-calculator.module.css';

function joinNames(names: readonly string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

interface PriceCalculatorProps {
  readonly selection: PlanSelection;
  readonly onChange: (next: PlanSelection) => void;
  readonly source: CalculatorSource;
}

/**
 * Price a plan: switch apps on, set the size, pick how to pay. The summary is the same one portal
 * sign-up shows, from the same quote, so the total here is the total there, to the cent. The button
 * goes straight to sign-up with the cart; "Help me choose" opens the wizard with the same cart.
 */
export function PriceCalculator({ selection, onChange, source }: PriceCalculatorProps) {
  const { products: stack, seats, warehouses, interval } = selection;
  const result = quote(selection);
  const bundled = isBundle(stack);
  const set = (patch: Partial<PlanSelection>) => onChange(normalizeSelection({ ...selection, ...patch }));

  // The seat count sets the price for the CRM and Projects, and the team limit for Pulse.
  const usesPeople = stack.some((id) => priceOf(id).quantityFrom !== 'warehouses');
  const perUser = stack.filter((id) => priceOf(id).quantityFrom === 'seats').map((id) => START_NAME[id]);
  const usesWarehouses = stack.includes('wms');
  // Apps priced here that cannot be set up yet. They are left out of the sign-up link.
  const startable = startableStack(stack);
  const waiting = stack.filter((id) => !startable.includes(id)).map((id) => START_NAME[id]);
  const canStart = startable.length > 0;
  const isEmpty = stack.length === 0;

  const startHref = canStart ? trialUrl(selection, source) : walkthroughHref(stack);
  const startLabel = canStart || isEmpty ? START_LABEL : WALKTHROUGH_LABEL;

  return (
    <div className={styles.calc} data-testid="plan-picker">
      <div className={styles.controls}>
        <fieldset className={styles.field}>
          <legend>1. Pick your apps</legend>
          <div className={styles.switches}>
            {PRODUCT_IDS.map((id) => {
              const price = priceOf(id);
              const isOn = stack.includes(id);
              const availability = availabilityLabel(id);
              return (
                <button
                  key={id}
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  className={styles.switch}
                  data-product={id}
                  data-testid={`plan-product-${id}`}
                  onClick={() => set({ products: toggleProduct(stack, id) })}
                >
                  <span className={styles.slab} aria-hidden />
                  <span className={styles.switchText}>
                    <span className={styles.switchName}>
                      {price.name}
                      {availability ? <span className={styles.soon}>{availability}</span> : null}
                    </span>
                    <span className={styles.switchBlurb}>{price.tagline}</span>
                  </span>
                  <span className={styles.switchPrice}>
                    <strong>{listPrice(id)}</strong> <span>{monthlyTerms(id)}</span>
                  </span>
                  <span className={styles.knob} aria-hidden />
                </button>
              );
            })}
          </div>
          <p className={styles.hint} data-on={bundled || undefined} role="status">
            {isEmpty
              ? 'Pick at least one app.'
              : bundled
                ? `Bundle discount applied: ${BUNDLE_OFF} off all ${stack.length} apps.`
                : `Add a second app and save ${BUNDLE_OFF} on both.`}
          </p>
        </fieldset>

        <fieldset className={styles.field}>
          <legend>2. Set your size</legend>
          <div className={styles.sizes}>
            <div className={styles.size} data-off={!usesPeople || undefined} inert={!usesPeople}>
              <span>
                <span className={styles.sizeName}>People on your team</span>
                <span className={styles.sizeNote}>
                  {perUser.length > 0
                    ? `Everyone who signs in to ${joinNames(perUser)}`
                    : stack.includes('pulse')
                      ? 'Everyone who signs in to Pulse'
                      : 'For the CRM, Projects and Pulse'}
                </span>
              </span>
              <Stepper
                label="people"
                value={seats}
                max={MAX_SEATS}
                onChange={(next) => set({ seats: next })}
                testId="plan-seats"
              />
            </div>
            <div className={styles.size} data-off={!usesWarehouses || undefined} inert={!usesWarehouses}>
              <span>
                <span className={styles.sizeName}>Warehouses</span>
                <span className={styles.sizeNote}>
                  {usesWarehouses ? 'Buildings you keep stock in' : 'For the WMS'}
                </span>
              </span>
              <Stepper
                label="warehouses"
                value={warehouses}
                max={MAX_WAREHOUSES}
                onChange={(next) => set({ warehouses: next })}
                testId="plan-warehouses"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className={styles.field}>
          <legend>3. Pick how to pay</legend>
          <BillingToggle value={interval} onChange={(next) => set({ interval: next })} />
          <p className={styles.payNote}>You can switch between monthly and yearly later.</p>
        </fieldset>

        {/* Small screens: the total and the button stay in reach while the controls scroll by. */}
        <div className={styles.bar} data-empty={isEmpty || undefined}>
          <p className={styles.barPrice}>
            {isEmpty ? (
              'Pick an app to see your price.'
            ) : (
              <>
                <strong>{formatMoney(result.totalCents)}</strong> {perPeriod(interval)}
                <span>{TRIAL_LINE}</span>
              </>
            )}
          </p>
          {isEmpty ? null : (
            <a href={startHref} className="btn btn-primary" data-testid="plan-submit-bar">
              {canStart ? START_LABEL : WALKTHROUGH_LABEL}
            </a>
          )}
        </div>
      </div>

      <div className={styles.result}>
        <StakVisual stack={stack} />
        <div className={styles.quote}>
          <QuoteSummary quote={result} />
        </div>
        {isEmpty ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              disabled
              aria-describedby="calculator-empty"
              data-testid="plan-submit"
            >
              {startLabel}
            </button>
            <p id="calculator-empty" className={styles.trust}>
              Pick at least one app.
            </p>
          </>
        ) : (
          <>
            <a href={startHref} className="btn btn-primary btn-lg btn-block" data-testid="plan-submit">
              {startLabel}{' '}
              <span className="btn-arrow" aria-hidden>
                →
              </span>
            </a>
            {canStart ? <p className={styles.trust}>{TRIAL_LINE}</p> : null}
          </>
        )}
        {waiting.length > 0 ? (
          <p className={styles.waiting}>
            {canStart
              ? `${joinNames(waiting)} is not open yet. This button starts the rest of your plan today.`
              : `${joinNames(waiting)} is not open yet. Book a walkthrough and we will show it to you.`}
          </p>
        ) : null}
        <div className={styles.more}>
          <Link
            href={isEmpty ? ROUTES.getStarted : wizardHref({ stack, seats, warehouses, billing: interval })}
            className={styles.talk}
          >
            {HELP_LABEL}
          </Link>
          <Link href={ROUTES.founder} className={styles.talk}>
            Talk to the founder
          </Link>
        </div>
      </div>
    </div>
  );
}

interface BundleCalculatorProps {
  readonly source?: CalculatorSource;
  /** The cart to open with. A link can still change it (`?stack=`, `?seats=`, `?warehouses=`, `?billing=`). */
  readonly initial?: PlanSelection;
}

/** The calculator with its own state, for a page that needs nothing else from the cart. */
export function BundleCalculator({ source = 'pricing', initial = CALCULATOR_START }: BundleCalculatorProps) {
  const [selection, setSelection] = useState<PlanSelection>(initial);

  // A link can carry a cart. It is read once, after the first paint, because the page is static.
  useEffect(() => {
    setSelection((current) => selectionFromSearch(window.location.search, current));
  }, []);

  return <PriceCalculator selection={selection} onChange={setSelection} source={source} />;
}
