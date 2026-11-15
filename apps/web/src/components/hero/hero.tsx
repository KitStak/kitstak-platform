import Link from 'next/link';
import { ROUTES } from '../site-links';
import { OrderStack } from './order-stack';
import styles from './hero.module.css';

export function Hero() {
  return (
    <section id="top" className={styles.hero} aria-labelledby="hero-heading">
      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <h1 id="hero-heading" className={styles.title}>
            <span className={styles.line}>Sell it.</span>
            <span className={styles.line}>Stock it.</span>
            <span className={styles.line}>Ship it.</span>
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
        <OrderStack />
      </div>
    </section>
  );
}
