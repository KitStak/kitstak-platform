import Link from 'next/link';
import {
  MORE_SEATS_ACTION,
  PRICING,
  formatUsd,
  includedSeatsLabel,
  moreSeatsPrompt,
  percentLabel,
  preliminaryPriceNote,
  priceOf,
} from '@/lib/pricing';
import type { ProductId } from '@/lib/pricing';
import { ROUTES, availabilityLabel, startLink } from '../site-links';
import styles from './price-band.module.css';

interface PriceBandProps {
  readonly product: ProductId;
  readonly included: readonly string[];
}

/** Starting price for one product, with the bundle saving beside it. */
export function PriceBand({ product, included }: PriceBandProps) {
  const price = priceOf(product);
  const start = startLink(product);
  const availability = availabilityLabel(product);
  const seats = includedSeatsLabel(product);
  const moreSeats = moreSeatsPrompt(product);
  const preliminary = preliminaryPriceNote([product]);
  return (
    <section id="pricing" className={`section ${styles.band}`} aria-labelledby="pricing-heading">
      <div className={`container ${styles.grid}`}>
        <div>
          <h2 id="pricing-heading" className="h2" data-reveal>
            One price. Everything in it.
          </h2>
          <p className="lead" data-reveal style={{ '--reveal-delay': 100 } as React.CSSProperties}>
            You get the whole product, not a starter tier. And it costs less when you run it alongside the
            others.
          </p>
          <ul className={styles.included}>
            {included.map((item, i) => (
              <li key={item} data-reveal style={{ '--reveal-delay': 50 * i } as React.CSSProperties}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.card} data-reveal>
          <p className={styles.cardName}>
            {price.name}
            {availability ? <span className={styles.soon}>{availability}</span> : null}
          </p>
          <p className={styles.amount}>
            <span className={`numeral ${styles.figure}`}>{formatUsd(price.monthlyCents)}</span>
            <span className={styles.per}>
              per {price.unit}
              <br />
              per month
            </span>
          </p>
          {seats && moreSeats ? (
            <p className={styles.seats}>
              {seats}. {moreSeats} <Link href={ROUTES.contact}>{MORE_SEATS_ACTION}</Link>
            </p>
          ) : null}
          <p className={styles.bundleLine}>
            <strong>{percentLabel(PRICING.bundleDiscount)} off</strong> each product when you stack two or
            more, and {percentLabel(PRICING.annualDiscount)} off again billed yearly.
          </p>
          {/* A product whose app is not open yet gets a walkthrough, not a start button. */}
          <Link href={start.href} className="btn btn-primary btn-lg btn-block">
            {start.label}{' '}
            <span className="btn-arrow" aria-hidden>
              →
            </span>
          </Link>
          <Link href={ROUTES.pricing} className={`text-link ${styles.calc}`}>
            Price your stack{' '}
            <span className="btn-arrow" aria-hidden>
              →
            </span>
          </Link>
          {preliminary ? <p className={styles.fine}>{preliminary}</p> : null}
        </div>
      </div>
    </section>
  );
}
