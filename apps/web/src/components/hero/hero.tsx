import Link from 'next/link';
import { HELP_LABEL, ROUTES, START_LABEL, startFreeHref } from '../site-links';
import { OrderStack } from './order-stack';
import styles from './hero.module.css';

/** The chip loop (./hero-loop) is unmounted, not deleted. The hero uses the original animated order stack. */
export function Hero() {
  return (
    <section id="top" className={styles.hero} aria-labelledby="hero-heading">
      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <h1 id="hero-heading" className={styles.title}>
            Put the whole operation on <span className={styles.accent}>one stack.</span>
          </h1>
          <p className={styles.lead}>
            KitStak runs your customers, your warehouse, your projects and your job profit on one database and one
            sign-in. The deal your team closes is the order your floor picks, the project that delivers it and the job
            you see the profit on.
          </p>
          <div className={styles.actions}>
            <a href={startFreeHref()} className="btn btn-primary" data-testid="hero-start">
              {START_LABEL} <span className="btn-arrow" aria-hidden>→</span>
            </a>
            <Link href={ROUTES.getStarted} className="btn btn-ghost-inverse" data-testid="hero-help">
              {HELP_LABEL}
            </Link>
          </div>
        </div>
        <OrderStack />
      </div>
    </section>
  );
}
