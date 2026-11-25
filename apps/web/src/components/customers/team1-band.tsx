import Link from 'next/link';
import { ROUTES } from '../site-links';
import { STATS, TEAM1 } from './team1-content';
import styles from './customers.module.css';

/** The Team 1 quote on the home page, with two of its numbers and a link to the full story. */
export function Team1Band() {
  return (
    <section className={`section ${styles.band}`} aria-labelledby="team1-band-heading">
      <div className={`container ${styles.bandInner}`}>
        <div data-reveal>
          <h2 id="team1-band-heading" className={styles.bandKicker}>
            Customer story: {TEAM1.name}
          </h2>
          <blockquote className={styles.bandQuote}>
            <p>“{TEAM1.shortQuote}”</p>
          </blockquote>
          <p className={styles.bandCite}>
            <strong>{TEAM1.person.name}</strong>, {TEAM1.person.title}
          </p>
        </div>
        <div data-reveal style={{ '--reveal-delay': 120 } as React.CSSProperties}>
          <dl className={styles.bandStats}>
            {STATS.slice(0, 2).map((stat) => (
              <div key={stat.label} className={styles.statPair}>
                <dt className={styles.statLabel}>{stat.label}</dt>
                <dd className={styles.statValue}>{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className={`container ${styles.bandFoot}`}>
        <Link href={ROUTES.team1} className={`text-link ${styles.bandLink}`}>
          Read how Team 1 moved{' '}
          <span className="btn-arrow" aria-hidden>
            →
          </span>
        </Link>
        <p className={styles.bandDisclosure}>{TEAM1.disclosure}</p>
      </div>
    </section>
  );
}
