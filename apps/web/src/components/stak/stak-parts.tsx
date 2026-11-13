import { PRICING, PRICING_IS_PLACEHOLDER, formatUsd, percentLabel } from '@/lib/pricing';
import type { Billing, Quote } from '@/lib/pricing';
import type { StackChoice } from '../site-links';
import styles from './stak-parts.module.css';

/* ------------------------------------------------------------------ The stack, drawn large */

interface StakVisualProps {
  readonly stack: StackChoice | null;
  /** Extra thin slabs under the two products, one per add-on (e.g. "Guided setup"). */
  readonly extras?: readonly string[];
}

/** The KitStak mark as a live diagram: the top bar is the CRM, the bottom bar is the WMS. */
export function StakVisual({ stack, extras = [] }: StakVisualProps) {
  const hasCrm = stack === 'crm' || stack === 'both';
  const hasWms = stack === 'wms' || stack === 'both';
  return (
    <div className={styles.visual} aria-hidden>
      <div className={styles.slab} data-product="crm" data-on={hasCrm || undefined}>
        <span>CRM</span>
      </div>
      <div className={styles.slab} data-product="wms" data-on={hasWms || undefined}>
        <span>WMS</span>
      </div>
      {extras.map((extra) => (
        <div key={extra} className={styles.extra}>
          <span>{extra}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Quote */

interface QuoteSummaryProps {
  readonly quote: Quote;
  readonly billing: Billing;
  readonly isBundle: boolean;
}

/** Line items, savings and the monthly figure. Sits on the navy brand surface. */
export function QuoteSummary({ quote, billing, isBundle }: QuoteSummaryProps) {
  return (
    <div aria-live="polite">
      <ul className={styles.lines}>
        {quote.lines.map((line) => (
          <li key={line.product}>
            <span>
              {line.name}
              <span className={styles.lineBasis}>
                {line.quantity} {line.unitLabel} × {formatUsd(line.unitCents)}
              </span>
            </span>
            <span className={styles.lineAmount}>{formatUsd(line.subtotalCents)}</span>
          </li>
        ))}
        {isBundle ? (
          <li className={styles.saving}>
            <span>Bundle saving ({percentLabel(PRICING.bundleDiscount)})</span>
            <span className={styles.lineAmount}>−{formatUsd(quote.bundleSavingsCents)}</span>
          </li>
        ) : null}
        {billing === 'annual' ? (
          <li className={styles.saving}>
            <span>Yearly billing ({percentLabel(PRICING.annualDiscount)})</span>
            <span className={styles.lineAmount}>−{formatUsd(quote.annualSavingsCents)}</span>
          </li>
        ) : null}
      </ul>
      <div className={styles.total}>
        <span className={`numeral ${styles.totalFigure}`}>{formatUsd(quote.monthlyCents)}</span>
        <span className={styles.totalPer}>
          per month
          <br />
          {billing === 'annual' ? 'billed yearly' : 'billed monthly'}
        </span>
      </div>
      {quote.totalSavingsCents > 0 ? (
        <p className={styles.saved}>
          You save {formatUsd(quote.totalSavingsCents * 12)} a year against list price.
        </p>
      ) : (
        <p className={styles.saved}>
          Add the other product and take {percentLabel(PRICING.bundleDiscount)} off both.
        </p>
      )}
      {PRICING_IS_PLACEHOLDER ? <p className={styles.fine}>Preliminary pricing, shown for planning.</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Controls */

interface StepperProps {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}

export function Stepper({ label, value, min = 1, max, onChange }: StepperProps) {
  const set = (next: number) => onChange(Math.min(Math.max(Number.isFinite(next) ? Math.round(next) : min, min), max));
  return (
    <div className={styles.stepper}>
      <button type="button" aria-label={`Fewer ${label}`} onClick={() => set(value - 1)} disabled={value <= min}>
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(event) => set(event.target.valueAsNumber)}
      />
      <button type="button" aria-label={`More ${label}`} onClick={() => set(value + 1)} disabled={value >= max}>
        +
      </button>
    </div>
  );
}

interface BillingToggleProps {
  readonly value: Billing;
  readonly onChange: (value: Billing) => void;
}

export function BillingToggle({ value, onChange }: BillingToggleProps) {
  return (
    <div className={styles.billing}>
      {(['annual', 'monthly'] as const).map((option) => (
        <label key={option} data-checked={value === option || undefined}>
          <input
            type="radio"
            name="billing-period"
            className="visually-hidden"
            checked={value === option}
            onChange={() => onChange(option)}
          />
          {option === 'annual' ? `Yearly · save ${percentLabel(PRICING.annualDiscount)}` : 'Monthly'}
        </label>
      ))}
    </div>
  );
}
