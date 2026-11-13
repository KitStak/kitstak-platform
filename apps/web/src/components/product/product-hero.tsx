import Link from 'next/link';
import { ROUTES } from '../site-links';
import { StakMark } from '../stak-mark';
import type { StakMarkLit } from '../stak-mark';
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
  readonly lit: StakMarkLit;
  /** Headline, one short line per entry. The last line is set in KitStak Red. */
  readonly lines: readonly string[];
  readonly lead: string;
  readonly primary: HeroAction;
  readonly secondary: HeroAction;
  readonly visual: React.ReactNode;
  readonly facts: readonly HeroFact[];
}

export function ProductHero({ product, lit, lines, lead, primary, secondary, visual, facts }: ProductHeroProps) {
  return (
    <section id="top" className={styles.hero} aria-labelledby="hero-heading">
      <div className={`container ${styles.inner}`}>
        <div>
          <nav aria-label="Breadcrumb" className={styles.crumbs}>
            <Link href={ROUTES.products}>Products</Link>
            <span aria-hidden>/</span>
            <span className={styles.crumbHere} aria-current="page">
              <StakMark lit={lit} size={22} />
              {product}
            </span>
          </nav>
          <h1 id="hero-heading" className={styles.title}>
            {lines.map((line) => (
              <span key={line} className={styles.line}>
                {line}
              </span>
            ))}
          </h1>
          <p className={styles.lead}>{lead}</p>
          <div className={styles.actions}>
            <Link href={primary.href} className="btn btn-primary btn-lg">
              {primary.label} <span className="btn-arrow" aria-hidden>→</span>
            </Link>
            <Link href={secondary.href} className="btn btn-ghost-inverse btn-lg">
              {secondary.label}
            </Link>
          </div>
        </div>
        <div className={styles.visual}>{visual}</div>
      </div>

      <div className={`container ${styles.factsWrap}`}>
        <dl className={styles.facts}>
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
