import Link from 'next/link';
import { ROUTES } from '../site-links';
import { RackMap } from './rack-map';
import styles from './wms-section.module.css';

const CAPABILITIES = [
  { name: 'Receiving and putaway', note: 'Check in against the PO, then direct stock to a location.' },
  { name: 'Locations and counts', note: 'Bin-level inventory with scheduled cycle counts.' },
  { name: 'Orders and packing', note: 'Pick, pack and label from a dedicated packing station.' },
  { name: 'Returns', note: 'A return station that inspects, restocks or writes off.' },
  { name: 'Work orders and kitting', note: 'Build kits from components and track the output.' },
  { name: 'Clients and billing', note: 'Run multiple clients from one floor and bill each one.' },
  { name: 'Carriers and channels', note: 'Connect stores and carriers in one place.' },
] as const;

export function WmsSection() {
  return (
    <section id="wms" className={`section ${styles.section}`} aria-labelledby="wms-heading">
      <div className="container">
        <div className={styles.grid}>
          <div className={styles.copy}>
            <h2 id="wms-heading" className="h2" data-reveal>
              The floor, mapped.
            </h2>
            <p className="lead" data-reveal style={{ '--reveal-delay': 120 } as React.CSSProperties}>
              Every unit has a location and every location has a count. KitStak WMS walks your team from the dock to the
              shelf and back.
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
              <Link href={ROUTES.wms} className="text-link">
                Explore KitStak WMS <span className="btn-arrow" aria-hidden>→</span>
              </Link>
            </p>
          </div>
          <div className={styles.visual} data-reveal>
            <RackMap />
          </div>
        </div>
      </div>
    </section>
  );
}
