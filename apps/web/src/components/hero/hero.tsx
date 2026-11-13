import { LINKS } from '../site-links';
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
            KitStak runs your customers and your warehouse on one database and one sign-in. The deal your team closes is
            the order your floor picks.
          </p>
          <div className={styles.actions}>
            <a href={LINKS.portal} className="btn btn-primary">
              Get started <span className="btn-arrow" aria-hidden>→</span>
            </a>
            <a href="#flow" className="btn btn-ghost-inverse">
              See how it connects
            </a>
          </div>
        </div>
        <OrderStack />
      </div>
    </section>
  );
}
