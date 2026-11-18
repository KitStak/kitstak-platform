import Link from 'next/link';
import { ROUTES } from '../site-links';
import { AppIcon } from '../app-icon';
import type { AppId } from '../app-icon';
import styles from './product-hero.module.css';

export interface HeroAction {
  readonly href: string;
  readonly label: string;
}

export interface HeroFact {
  readonly value: string;
  readonly label: string;
}

interface ProductHeroProps {
  /** Product tag shown beside the mark, e.g. "KitStak WMS". */
  readonly product: string;
  readonly app: AppId;
  /** Headline, one short line per entry. The last line is set in KitStak Red. */
  readonly lines: readonly string[];
  readonly lead: string;
  readonly primary: HeroAction;
  readonly secondary: HeroAction;
  readonly visual: React.ReactNode;
  readonly facts: readonly HeroFact[];
  /** Optional short status shown beside the breadcrumb (e.g. "New"). */
  readonly badge?: string;
  /**
   * `stacked` puts the visual under the copy at the full width of the page. For a wide picture, such
   * as a product screenshot, that would be too small to read in half the width.
   */
  readonly layout?: 'split' | 'stacked';
  /** How many facts a phone shows, when the full strip would take too much of a small screen. */
  readonly phoneFacts?: 2;
}

/**
 * The size of the app icon beside the product name. The Pulse mark is short and wide inside its
 * square, so it is drawn a little larger to carry the same weight as the others.
 */
const CRUMB_ICON_SIZE = 30;
const CRUMB_ICON_SIZE_WIDE_MARK = 36;

export function ProductHero({
  product,
  app,
  lines,
  lead,
  primary,
  secondary,
  visual,
  facts,
  badge,
  layout = 'split',
  phoneFacts,
}: ProductHeroProps) {
  return (
    <section id="top" className={styles.hero} aria-labelledby="hero-heading">
      <div className={`container ${styles.inner}`} data-layout={layout}>
        <div className={styles.copy}>
          <nav aria-label="Breadcrumb" className={styles.crumbs}>
            <Link href={ROUTES.products}>Products</Link>
            <span aria-hidden>/</span>
            <span className={styles.crumbHere} aria-current="page">
              <AppIcon app={app} size={app === 'pulse' ? CRUMB_ICON_SIZE_WIDE_MARK : CRUMB_ICON_SIZE} />
              {product}
            </span>
            {badge ? <span className={styles.badge}>{badge}</span> : null}
          </nav>
          <h1 id="hero-heading" className={styles.title}>
            {lines.map((line) => (
              <span key={line} className={styles.line}>
                {line}
              </span>
            ))}
          </h1>
          <div className={styles.pitch}>
            <p className={styles.lead}>{lead}</p>
            <div className={styles.actions}>
              <Link href={primary.href} className="btn btn-primary btn-lg">
                {primary.label}{' '}
                <span className="btn-arrow" aria-hidden>
                  →
                </span>
              </Link>
              <Link href={secondary.href} className="btn btn-ghost-inverse btn-lg">
                {secondary.label}
              </Link>
            </div>
          </div>
        </div>
        <div className={styles.visual}>{visual}</div>
      </div>

      <div className={`container ${styles.factsWrap}`}>
        <dl className={styles.facts} data-phone-facts={phoneFacts}>
          {facts.map((fact, i) => (
            <div key={fact.label} style={{ '--i': i } as React.CSSProperties}>
              <dt className={`numeral ${styles.factValue}`}>{fact.value}</dt>
              <dd className={styles.factLabel}>{fact.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
