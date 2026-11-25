'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  TRIAL_LINE,
  YEARLY_OFF,
  includedSeatsLabel,
  monthlyTerms,
  priceOf,
  unitPerMonth,
  unitPerYear,
} from '@/lib/pricing';
import type { BillingInterval, PlanSelection } from '@/lib/pricing';
import { CALCULATOR_START, selectionFromSearch } from '@/lib/calculator';
import { trialUrl } from '@/lib/stak';
import { AppIcon } from '../app-icon';
import {
  PRODUCT_IDS,
  ROUTES,
  isAppLive,
  startLink,
  START_LABEL,
} from '../site-links';
import type { ProductId } from '../site-links';
import { PriceCalculator } from '../stak/bundle-calculator';
import { BillingToggle } from '../stak/stak-parts';
import { CALCULATOR, CARDS_NOTE, HERO } from './pricing-content';
import styles from './pricing.module.css';

const PRODUCT_ROUTE: Readonly<Record<ProductId, string>> = {
  crm: ROUTES.crm,
  wms: ROUTES.wms,
  projects: ROUTES.projects,
  pulse: ROUTES.pulse,
};

/** The small line under a card's price. It says what paying yearly changes, in both positions of the switch. */
function yearlyLine(product: ProductId, interval: BillingInterval): string {
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
