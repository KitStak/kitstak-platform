import Link from 'next/link';
import {
  BUNDLE_OFF,
  MORE_SEATS_ACTION,
  PLANNED_PRICE_NOTE,
  TRIAL_LINE,
  YEARLY_OFF,
  includedSeatsLabel,
  listPrice,
  monthlyTerms,
  moreSeatsPrompt,
  priceOf,
} from '@/lib/pricing';
import type { PricedProductId } from '@/lib/pricing';
import { trialUrl } from '@/lib/stak';
import {
  ROUTES,
  availabilityLabel,
  isAppLive,
  isAnnouncedApp,
  isProductId,
  pricingHref,
  startLink,
  START_LABEL,
} from '../site-links';
import styles from './price-band.module.css';

interface PriceBandProps {
  readonly product: PricedProductId;
  readonly included: readonly string[];
}

/**
 * The price of one product, with the bundle saving beside it and a button that starts the free
 * trial. The button goes straight to portal sign-up with this app in the cart. The price comes
 * from the shared catalog, so it is the price sign-up and billing show.
 */
export function PriceBand({ product, included }: PriceBandProps) {
  const price = priceOf(product);
  const isOpen = isAppLive(product);
  // Crew or Ledger before launch: a planned price, no trial, and a link to the coming soon cards.
  const isPlanned = !isOpen && isAnnouncedApp(product);
  const walkthrough = startLink(product);
  const availability = availabilityLabel(product);
  const seats = includedSeatsLabel(product);
  const moreSeats = moreSeatsPrompt(product);
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
            <span className={`numeral ${styles.figure}`}>{listPrice(product)}</span>
            <span className={styles.per}>{monthlyTerms(product)}</span>
          </p>
          {seats && moreSeats ? (
            <p className={styles.seats}>
              {seats}. {moreSeats} <Link href={ROUTES.contact}>{MORE_SEATS_ACTION}</Link>
            </p>
          ) : null}
          <p className={styles.bundleLine}>
            <strong>Save {BUNDLE_OFF}</strong> on every app when you have two or more. Save {YEARLY_OFF} more
            when you pay yearly.
          </p>
          {/* A product whose app is not open yet gets a walkthrough, not a start button. */}
          {isPlanned ? <p className={styles.seats}>{PLANNED_PRICE_NOTE}</p> : null}
          {isOpen && isProductId(product) ? (
            <a
              href={trialUrl({ products: [product], seats: 1, warehouses: 1, interval: 'monthly' }, 'product')}
              className="btn btn-primary btn-lg btn-block"
            >
              {START_LABEL}{' '}
              <span className="btn-arrow" aria-hidden>
                →
              </span>
            </a>
          ) : (
            <Link href={walkthrough.href} className="btn btn-primary btn-lg btn-block">
              {walkthrough.label}{' '}
              <span className="btn-arrow" aria-hidden>
                →
              </span>
            </Link>
          )}
          {isOpen ? <p className={styles.trust}>{TRIAL_LINE}</p> : null}
          <Link href={isProductId(product) && !isPlanned ? pricingHref(product) : ROUTES.pricingPlanned} className={`text-link ${styles.calc}`}>
            {isPlanned ? 'See all prices' : 'Price your stack'}{' '}
            <span className="btn-arrow" aria-hidden>
              →
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
