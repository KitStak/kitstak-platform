import styles from './chapter.module.css';

export interface Feature {
  readonly name: string;
  readonly note: string;
}

interface ChapterProps {
  readonly id: string;
  /** Two-digit chapter number, set in the display face. */
  readonly index: string;
  readonly label: string;
  readonly title: string;
  readonly lead: string;
  readonly features?: readonly Feature[];
  readonly visual?: React.ReactNode;
  /** `sunken` and `brand` change the band behind the chapter. */
  readonly tone?: 'plain' | 'sunken' | 'brand';
  /** Put the visual on the left at desktop widths. */
  readonly isFlipped?: boolean;
  readonly children?: React.ReactNode;
}

/** One numbered chapter of a product page: heading and feature list beside a sticky visual. */
export function Chapter({
  id,
  index,
  label,
  title,
  lead,
  features,
  visual,
  tone = 'plain',
  isFlipped = false,
  children,
}: ChapterProps) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} className={`section ${styles.chapter}`} data-tone={tone} aria-labelledby={headingId}>
      <div className="container">
        <div className={styles.grid} data-flipped={isFlipped || undefined} data-solo={visual ? undefined : true}>
          <div className={styles.copy}>
            <p className={styles.label} data-reveal>
              <span className={`numeral ${styles.index}`}>{index}</span>
              {label}
            </p>
            <h2 id={headingId} className={`h2 ${styles.title}`} data-reveal>
              {title}
            </h2>
            <p className={`lead ${styles.lead}`} data-reveal style={{ '--reveal-delay': 100 } as React.CSSProperties}>
              {lead}
            </p>
            {features ? <FeatureList features={features} /> : null}
          </div>
          {visual ? (
            <div className={styles.visual} data-reveal>
              {visual}
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </section>
  );
}

export function FeatureList({ features }: { readonly features: readonly Feature[] }) {
  return (
    <ul className={styles.list}>
      {features.map((feature, i) => (
        <li key={feature.name} data-reveal style={{ '--reveal-delay': 50 * i } as React.CSSProperties}>
          <span className={styles.name}>{feature.name}</span>
          <span className={styles.note}>{feature.note}</span>
        </li>
      ))}
    </ul>
  );
}

interface TileGridProps {
  readonly tiles: readonly Feature[];
  readonly columns?: 2 | 3 | 4;
}

/** Ruled grid of short capability notes, for the parts of a product that do not need a picture. */
export function TileGrid({ tiles, columns = 3 }: TileGridProps) {
  return (
    <ul className={styles.tiles} data-columns={columns}>
      {tiles.map((tile, i) => (
        <li key={tile.name} data-reveal style={{ '--reveal-delay': 40 * (i % columns) } as React.CSSProperties}>
          <span className={styles.name}>{tile.name}</span>
          <span className={styles.note}>{tile.note}</span>
        </li>
      ))}
    </ul>
  );
}
