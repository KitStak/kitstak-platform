import Link from 'next/link';
import { ROUTES } from '../site-links';
import { BoardMorph } from './board-morph';
import styles from './crm-section.module.css';

const CAPABILITIES = [
  { name: 'Boards', note: 'Table, Kanban, Timeline, Calendar, Chart, Files and Form views of the same data.' },
  { name: 'Automations', note: 'When a status changes, assign, notify or move the item.' },
  { name: 'Dashboards', note: 'Roll boards up into the numbers your team reviews each week.' },
  { name: 'Inbox and My Work', note: 'Everything assigned to you, across every board.' },
  { name: 'Import and export', note: 'Bring a spreadsheet in, map the columns, keep working.' },
] as const;

export function CrmSection() {
  return (
    <section id="crm" className="section" aria-labelledby="crm-heading">
      <div className="container">
        <div className={styles.head}>
          <h2 id="crm-heading" className="h2" data-reveal>
            Boards that bend to the work.
          </h2>
          <p className="lead" data-reveal style={{ '--reveal-delay': 120 } as React.CSSProperties}>
            KitStak CRM keeps accounts, deals and follow-ups on boards your team shapes for itself. Switch the view; the
            records stay put.
          </p>
          <p className={styles.more} data-reveal style={{ '--reveal-delay': 180 } as React.CSSProperties}>
            <Link href={ROUTES.crm} className="text-link">
              Explore KitStak CRM <span className="btn-arrow" aria-hidden>→</span>
            </Link>
          </p>
        </div>
        <div className={styles.grid}>
          <div data-reveal>
            <BoardMorph />
          </div>
          <dl className={styles.list}>
            {CAPABILITIES.map((c, i) => (
              <div key={c.name} data-reveal style={{ '--reveal-delay': 60 * i } as React.CSSProperties}>
                <dt>{c.name}</dt>
                <dd>{c.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
