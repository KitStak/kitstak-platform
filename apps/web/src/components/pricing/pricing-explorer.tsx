'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  PLANNED_PRICE_NOTE,
  TRIAL_LINE,
  YEARLY_OFF,
  includedSeatsLabel,
  monthlyTerms,
  priceOf,
  unitPerMonth,
  unitPerYear,
} from '@/lib/pricing';
import type { BillingInterval, PlanSelection, PricedProductId } from '@/lib/pricing';
import { CALCULATOR_START, selectionFromSearch } from '@/lib/calculator';
import { trialUrl } from '@/lib/stak';
import { AppIcon } from '../app-icon';
import {
  COMING_SOON,
  PLANNED_PRODUCT_IDS,
  PRODUCT_IDS,
  PRODUCT_ROUTE,
  isAppLive,
  startLink,
  START_LABEL,
} from '../site-links';
import type { PlannedProductId, ProductId } from '../site-links';
import { PriceCalculator } from '../stak/bundle-calculator';
import { BillingToggle } from '../stak/stak-parts';
import { CALCULATOR, CARDS_NOTE, HERO, PLANNED_LEAD } from './pricing-content';
import styles from './pricing.module.css';

/** The small line under a card's price. It says what paying yearly changes, in both positions of the switch. */
function yearlyLine(product: PricedProductId, interval: BillingInterval): string {
  const price = priceOf(product);
  if (interval === 'monthly') return `Save ${YEARLY_OFF} when you pay yearly.`;
  return price.quantityFrom === 'flat'
    ? `Paid yearly: ${unitPerYear(product)} each year.`
    : `Paid yearly: ${unitPerYear(product)} per ${price.unit} each year.`;
}

interface PriceCardProps {
  readonly product: ProductId;
  readonly interval: BillingInterval;
}

function PriceCard({ product, interval }: PriceCardProps) {
  const price = priceOf(product);
  const seats = includedSeatsLabel(product);
  const isOpen = isAppLive(product);
  const walkthrough = startLink(product);
  return (
    <article className={styles.card} data-product={product} data-testid={`price-card-${product}`}>
      <header className={styles.cardHead}>
        <AppIcon app={product} size={44} />
        <h3 className={styles.cardName}>{price.name}</h3>
      </header>
      <p className={styles.cardLine}>{price.tagline}</p>
      <p className={styles.cardPrice}>
        <span className={`numeral ${styles.cardFigure}`} data-testid={`price-card-figure-${product}`}>
          {unitPerMonth(product, interval)}
        </span>
        <span className={styles.cardTerms}>
          {monthlyTerms(product)}
          {seats ? `. ${seats}.` : ''}
        </span>
      </p>
      <p className={styles.cardYearly}>{yearlyLine(product, interval)}</p>
      {/* A product whose app is not open yet gets a walkthrough, not a start button. */}
      {isOpen ? (
        <a
          href={trialUrl({ products: [product], seats: 1, warehouses: 1, interval }, 'pricing')}
          className={`btn btn-primary btn-block ${styles.cardStart}`}
          aria-label={`Start free with ${price.name}`}
        >
          {START_LABEL}
        </a>
      ) : (
        <Link href={walkthrough.href} className={`btn btn-primary btn-block ${styles.cardStart}`}>
          {walkthrough.label}
        </Link>
      )}
      <Link href={PRODUCT_ROUTE[product]} className={styles.cardMore}>
        See what is in {price.shortName} <span aria-hidden>→</span>
      </Link>
    </article>
  );
}

/**
 * A card for an app with a planned price and no app yet (Crew, Ledger). It follows the monthly and
 * yearly switch like the others, says plainly that it cannot be bought, and asks to be told instead.
 */
function PlannedPriceCard({ product, interval }: { readonly product: PlannedProductId; readonly interval: BillingInterval }) {
  const price = priceOf(product);
  const seats = includedSeatsLabel(product);
  const notify = startLink(product);
  return (
    <article className={styles.card} data-product={product} data-planned data-testid={`price-card-${product}`}>
      <header className={styles.cardHead}>
        <AppIcon app={product} size={44} />
        <h3 className={styles.cardName}>{price.name}</h3>
        <span className={styles.cardSoon}>{COMING_SOON}</span>
      </header>
      <p className={styles.cardLine}>{price.tagline}</p>
      <p className={styles.cardPrice}>
        <span className={`numeral ${styles.cardFigure}`} data-testid={`price-card-figure-${product}`}>
          {unitPerMonth(product, interval)}
        </span>
        <span className={styles.cardTerms}>
          {monthlyTerms(product)}
          {seats ? `. ${seats}.` : ''}
        </span>
      </p>
      <p className={styles.cardYearly}>
        {yearlyLine(product, interval)} {PLANNED_PRICE_NOTE}
      </p>
      <Link href={notify.href} className={`btn btn-ghost btn-block ${styles.cardStart}`}>
        {notify.label}
      </Link>
      <Link href={PRODUCT_ROUTE[product]} className={styles.cardMore}>
        See what is in {price.shortName} <span aria-hidden>→</span>
      </Link>
    </article>
  );
}

/**
 * The top of the pricing page: the heading with the monthly and yearly switch, the four app cards
 * and the calculator. They share one cart, so the switch in the heading, the cards and the
 * calculator always agree.
 */
export function PricingExplorer() {
  const [selection, setSelection] = useState<PlanSelection>(CALCULATOR_START);

  // A link can carry a cart (see `pricingHref`). Read once, after the first paint: the page is static.
  useEffect(() => {
    setSelection((current) => selectionFromSearch(window.location.search, current));
  }, []);

  const changeInterval = (interval: BillingInterval) => setSelection((current) => ({ ...current, interval }));

  return (
    <>
      <section id="top" className={styles.hero} aria-labelledby="pricing-heading">
        <div className={`container ${styles.heroInner}`}>
          <p className={styles.heroKicker}>{HERO.kicker}</p>
          <h1 id="pricing-heading" className={styles.heroTitle}>
            <span>{HERO.titleTop}</span> <span>{HERO.titleBottom}</span>
          </h1>
          <p className={styles.heroLead}>{HERO.lead}</p>
          <div className={styles.heroToggle}>
            <BillingToggle value={selection.interval} onChange={changeInterval} inverse hasTestIds={false} />
          </div>
        </div>
      </section>

      <section className={styles.cardsBand} aria-label="Price of each app">
        <div className="container">
          <div className={styles.cards}>
            {PRODUCT_IDS.map((id) => (
              <PriceCard key={id} product={id} interval={selection.interval} />
            ))}
          </div>
          <p className={styles.cardsNote}>
            <strong>{CARDS_NOTE}</strong> {TRIAL_LINE}
          </p>
        </div>
      </section>

      {/* Planned apps: shown with their price, never in the calculator or a sign-up link. */}
      <section id="coming-soon" className={styles.plannedBand} aria-labelledby="coming-soon-heading">
        <div className="container">
          <h2 id="coming-soon-heading" className={styles.plannedTitle}>
            {COMING_SOON}
          </h2>
          <p className={styles.plannedLead}>{PLANNED_LEAD}</p>
          <div className={`${styles.cards} ${styles.plannedCards}`}>
            {PLANNED_PRODUCT_IDS.map((id) => (
              <PlannedPriceCard key={id} product={id} interval={selection.interval} />
            ))}
          </div>
        </div>
      </section>

      <section id="calculator" className={`section ${styles.calcBand}`} aria-labelledby="calculator-heading">
        <div className="container">
          <h2 id="calculator-heading" className="h2">
            {CALCULATOR.title}
          </h2>
          <p className="lead">{CALCULATOR.lead}</p>
          <div className={styles.calc}>
            <PriceCalculator selection={selection} onChange={setSelection} source="pricing" />
          </div>
        </div>
      </section>
    </>
  );
}
