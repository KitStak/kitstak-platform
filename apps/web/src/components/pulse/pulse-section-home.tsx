import Link from 'next/link';
import { ROUTES, availabilityLabel } from '../site-links';
// Same band, grid and ruled list as the WMS section above it on the home page, so the two read as a pair.
import styles from '../wms/wms-section.module.css';
import pulse from './pulse-section.module.css';
import { RiskVisual } from './pulse-visuals';

/** Four rows, each one a chapter of the Pulse page in its own words (SPEC 8.5 lists the same set). */
const CAPABILITIES = [
  {
    name: 'Profit by job',
    note: 'Revenue, cost, profit and margin for every job, client, job type and extra service.',
  },
  { name: 'Log work', note: 'One screen for the whole day: units, people and hours for each job.' },
  { name: 'Quote vs actual', note: 'The quote beside what happened, and why profit changed.' },
  {
    name: 'Jobs at risk',
    note: 'Five plain statuses for every open job, each with the reason in a sentence.',
  },
] as const;

/**
 * Pulse on the home page: the same weight as the WMS and CRM sections. The picture is the real Jobs
 * screen, so the Pulse page a visitor clicks through to does not open on the same picture.
 */
export function PulseHomeSection() {
  const availability = availabilityLabel('pulse');
  return (
    <section id="pulse" className={`section ${styles.section}`} aria-labelledby="pulse-heading">
      <div className="container">
        <div className={styles.grid}>
          <div>
            {/* Nobody can open Pulse yet, so the section says so before it sells anything. */}
            {availability ? (
              <p className={pulse.soon} data-reveal>
                {availability}
              </p>
            ) : null}
            <h2 id="pulse-heading" className="h2" data-reveal>
              Know which jobs make money.
            </h2>
            <p className="lead" data-reveal style={{ '--reveal-delay': 120 } as React.CSSProperties}>
              KitStak Pulse takes the units and hours you log each day and shows the profit on every job. It
              tells you which open jobs are losing money, and why.
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
          <div className={`${styles.visual} ${pulse.homeVisual}`} data-reveal>
            <RiskVisual inSideColumn />
          </div>
        </div>
      </div>
    </section>
  );
}
