import Link from 'next/link';
import { ROUTES } from '../site-links';
import styles from './hero.module.css';

/** Static hero. The animated order stack (./order-stack) is unmounted for now, not deleted. */
export function Hero() {
  return (
    <section id="top" className={styles.hero} aria-labelledby="hero-heading">
      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <h1 id="hero-heading" className={styles.title}>
            Put the whole operation on <span className={styles.accent}>one stack.</span>
          </h1>
          <p className={styles.lead}>
            KitStak runs your customers, your warehouse and your projects on one database and one sign-in. The deal your
            team closes is the order your floor picks, and the project that delivers it.
          </p>
          <div className={styles.actions}>
            <Link href={ROUTES.getStarted} className="btn btn-primary">
              Set up your Stak <span className="btn-arrow" aria-hidden>→</span>
            </Link>
            <Link href={ROUTES.products} className="btn btn-ghost-inverse">
              See the products
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
