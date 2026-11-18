import Link from 'next/link';
import { ROUTES } from '../site-links';
// Same band, grid and ruled list as the WMS section above it on the home page, so the two read as a pair.
import styles from '../wms/wms-section.module.css';
import { PulseHeroVisual } from './pulse-visuals';

/** Four rows, each one a chapter of the Pulse page in its own words (SPEC 8.5 lists the same set). */
const CAPABILITIES = [
  {
    name: 'Profit by job',
    note: 'Money in, money out, profit and margin for every job, job type, client and extra service.',
  },
  { name: 'Log work', note: 'One grid for the whole day: units, people and hours for each job.' },
  { name: 'Quote vs actual', note: 'The plan beside what happened, and why profit changed.' },
  {
    name: 'Jobs at risk',
    note: 'Five plain statuses for every open job, each with the reason in a sentence and a next step.',
  },
] as const;

/** Pulse on the home page: the same weight as the WMS and CRM sections, with the Pulse Home screen beside it. */
export function PulseHomeSection() {
  return (
    <section id="pulse" className={`section ${styles.section}`} aria-labelledby="pulse-heading">
      <div className="container">
        <div className={styles.grid}>
          <div>
            <h2 id="pulse-heading" className="h2" data-reveal>
              Know which jobs make money.
            </h2>
            <p className="lead" data-reveal style={{ '--reveal-delay': 120 } as React.CSSProperties}>
              KitStak Pulse turns the units and hours you log each day into profit. It tells you which open
              jobs are losing money, and why.
            </p>
            <ul className={styles.list}>
              {CAPABILITIES.map((c, i) => (
                <li key={c.name} data-reveal style={{ '--reveal-delay': 60 * i } as React.CSSProperties}>
                  <span className={styles.name}>{c.name}</span>
                  <span className={styles.note}>{c.note}</span>
                </li>
              ))}
            </ul>
            <p className={styles.more} data-reveal>
              <Link href={ROUTES.pulse} className="text-link">
                Explore KitStak Pulse{' '}
                <span className="btn-arrow" aria-hidden>
                  →
                </span>
              </Link>
            </p>
          </div>
          <div className={styles.visual} data-reveal>
            <PulseHeroVisual />
          </div>
        </div>
      </div>
    </section>
  );
}
