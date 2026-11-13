import { Logo } from '../logo';
import { LINKS } from '../site-links';
import styles from './closing-section.module.css';

export function ClosingSection() {
  return (
    <section className={styles.band} aria-labelledby="closing-heading">
      <div className={`container ${styles.inner}`}>
        <div className={styles.mark} aria-hidden data-reveal>
          <Logo height={34} tone="inverse" />
        </div>
        <h2 id="closing-heading" className={styles.title} data-reveal>
          Put the whole operation on one stack.
        </h2>
        <div className={styles.actions} data-reveal style={{ '--reveal-delay': 120 } as React.CSSProperties}>
          <a href={LINKS.portal} className="btn btn-primary">
            Get started <span className="btn-arrow" aria-hidden>→</span>
          </a>
          <a href={LINKS.portal} className="btn btn-ghost-inverse">
            Sign in
          </a>
        </div>
      </div>
    </section>
  );
}
