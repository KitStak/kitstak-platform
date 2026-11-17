import Link from 'next/link';
import { Logo } from '../logo';
import { ROUTES } from '../site-links';
import styles from './closing-section.module.css';

interface ClosingSectionProps {
  readonly title?: string;
  /** Wizard link for the primary action; defaults to the plain setup wizard. */
  readonly startHref?: string;
  readonly startLabel?: string;
  /** Small print under the buttons. */
  readonly note?: string;
}

export function ClosingSection({
  title = 'Sell it. Stock it. Ship it.',
  startHref = ROUTES.getStarted,
  startLabel = 'Set up your Stak',
  note = 'About five minutes. No card needed to set up.',
}: ClosingSectionProps) {
  return (
    <section className={styles.band} aria-labelledby="closing-heading">
      <div className={`container ${styles.inner}`}>
        <div className={styles.mark} aria-hidden data-reveal>
          <Logo height={34} tone="inverse" />
        </div>
        <h2 id="closing-heading" className={styles.title} data-reveal>
          {title}
        </h2>
        <div className={styles.actions} data-reveal style={{ '--reveal-delay': 120 } as React.CSSProperties}>
          <Link href={startHref} className="btn btn-primary btn-lg">
            {startLabel} <span className="btn-arrow" aria-hidden>→</span>
          </Link>
          <Link href={ROUTES.founder} className="btn btn-ghost-inverse btn-lg">
            Talk to the founder
          </Link>
        </div>
        <p className={styles.note} data-reveal style={{ '--reveal-delay': 200 } as React.CSSProperties}>
          {note}
        </p>
      </div>
    </section>
  );
}
