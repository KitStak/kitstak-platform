import Link from 'next/link';
import { PROJECTS_CATALOG } from '@/generated/projects/catalog';
import { BUNDLE_OFF, TRIAL_DAYS, priceInWords } from '@/lib/pricing';
import { ROUTES, availabilityLabel, isAppLive, startLink, START_LABEL, HELP_LABEL, startFreeHref } from '../site-links';
import { AppIcon } from '../app-icon';
import { StakMark } from '../stak-mark';
import styles from './products-sections.module.css';

/* ------------------------------------------------------------------ Hero */

const SLABS = [
  {
    id: 'crm',
    href: ROUTES.crm,
    name: 'KitStak CRM',
    line: 'Leads, deals, accounts and follow-ups on boards your team shapes.',
  },
  {
    id: 'wms',
    href: ROUTES.wms,
    name: 'KitStak WMS',
    line: 'Receiving, inventory, picking, packing, shipping and returns.',
  },
  {
    id: 'projects',
    href: ROUTES.projects,
    name: 'KitStak Projects',
    line: 'Tasks, timelines and workload, linked to the deals and orders they are for.',
  },
  {
    id: 'pulse',
    href: ROUTES.pulse,
    name: 'KitStak Pulse',
    line: 'Profit by job, client and extra service, from what you log each day.',
  },
] as const;

/** The mark as navigation: each bar of the stack is a product you can open. */
export function StackHero() {
  return (
    <section id="top" className={styles.hero} aria-labelledby="hero-heading">
      <div className={`container ${styles.heroInner}`}>
        <div>
          <h1 id="hero-heading" className={styles.heroTitle}>
            <span>Four products.</span>
            <span>One stack.</span>
          </h1>
          <p className={styles.heroLead}>
            A CRM for the people who sell, a WMS for the people who ship, Projects for the work in between,
            and Pulse to show which jobs make money. Each one stands on its own. Stack two or more and they
            share one sign-in and one bill, and cost {BUNDLE_OFF} less.
            {isAppLive('pulse') ? null : ' Pulse is coming soon.'}
          </p>
          <div className={styles.heroActions}>
            <a href={startFreeHref()} className="btn btn-primary btn-lg">
              {START_LABEL}{' '}
              <span className="btn-arrow" aria-hidden>
                →
              </span>
            </a>
            <Link href={ROUTES.pricing} className="btn btn-ghost-inverse btn-lg">
              Price your stack
            </Link>
          </div>
        </div>

        <nav aria-label="Product pages" className={styles.slabs}>
          {SLABS.map((slab) => (
            <Link key={slab.id} href={slab.href} className={styles.slab} data-product={slab.id}>
              <span className={styles.slabName}>{slab.name}</span>
              <span className={styles.slabLine}>{slab.line}</span>
              <span className={styles.slabGo}>
                Explore <span aria-hidden>→</span>
              </span>
            </Link>
          ))}
          <p className={styles.slabNote}>One bar per product. Stack the ones you need.</p>
        </nav>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Line-up */

interface ProductCard {
  readonly id: 'wms' | 'crm' | 'projects' | 'pulse';
  readonly name: string;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
  readonly href: string;
}

const CARDS: readonly ProductCard[] = [
  {
    id: 'wms',
    name: 'KitStak WMS',
    title: 'For the floor.',
    body: 'Every unit has a location and every location has a count, from the dock to the door.',
    points: [
      'Scan-first receiving and directed putaway',
      'Cycle, blind, instant and SKU counts',
      'Wave rules, pick jobs and packing stations',
      'Rate shopping across your carrier accounts',
      'Returns, kitting and work orders',
      'Client billing, if you run a 3PL',
    ],
    href: ROUTES.wms,
  },
  {
    id: 'crm',
    name: 'KitStak CRM',
    title: 'For the pipeline.',
    body: 'Leads, deals, accounts and follow-ups on boards your team shapes, with automations doing the chasing.',
    points: [
      'Eight views of every board',
      'Pipeline with funnel and forecast',
      'Automations with test runs',
      'Live dashboards',
      'Inbox, My Work and updates',
      'REST API and signed webhooks',
    ],
    href: ROUTES.crm,
  },
  {
    id: 'projects',
    name: 'KitStak Projects',
    title: 'For the work in between.',
    body: 'The onboarding, the go-live and the follow-up, planned next to the deal or order they exist for.',
    // Counts come from the Projects app's own code (src/generated/projects).
    points: [
      `${PROJECTS_CATALOG.views.length} views, from board to timeline and workload`,
      'Quick add that reads dates, people and labels',
      'Cycles, triage, goals and time tracking',
      `${PROJECTS_CATALOG.automation.recipes.length} ready-made automations`,
      `${PROJECTS_CATALOG.templates.length} project templates`,
      'Tasks linked to CRM deals and WMS orders',
    ],
    href: ROUTES.projects,
  },
  {
    id: 'pulse',
    name: 'KitStak Pulse',
    title: 'For the bottom line.',
    body: 'What each job earned and what it really cost, so you know which jobs make money and which do not.',
    // Every point is a screen or rule in docs/pulse/SPEC.md.
    points: [
      'Profit by job, job type, client and extra service',
      'Log work: units, people and hours for each job',
      'Quote vs actual, and why profit changed',
      'The real cost of an hour, and material cost',
      'Jobs at risk or losing money, with the reason',
      'CSV import and export',
    ],
    href: ROUTES.pulse,
  },
];

export function Lineup() {
  return (
    <section id="lineup" className="section" aria-labelledby="lineup-heading">
      <div className="container">
        <h2 id="lineup-heading" className="h2" data-reveal>
          Pick where to start.
        </h2>
        <p className="lead" data-reveal style={{ '--reveal-delay': 100 } as React.CSSProperties}>
          Most teams start with the one that hurts most today, and add the others when they are ready.
        </p>
        <div className={styles.cards}>
          {CARDS.map((card, i) => {
            const start = startLink(card.id);
            const availability = availabilityLabel(card.id);
            return (
              <article
                key={card.id}
                className={styles.card}
                data-reveal
                style={{ '--reveal-delay': 100 * (i % 2) } as React.CSSProperties}
              >
                <header className={styles.cardHead}>
                  <AppIcon app={card.id} size={56} />
                  <span className={styles.cardName}>{card.name}</span>
                  {availability ? <span className={styles.cardSoon}>{availability}</span> : null}
                  <span className={styles.cardPrice}>{priceInWords(card.id)}</span>
                </header>
                <h3 className={styles.cardTitle}>{card.title}</h3>
                <p className={styles.cardBody}>{card.body}</p>
                <ul className={styles.cardPoints}>
                  {card.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <div className={styles.cardActions}>
                  <Link href={card.href} className="btn btn-ghost">
                    Explore {card.name}{' '}
                    <span className="btn-arrow" aria-hidden>
                      →
                    </span>
                  </Link>
                  {/* A product whose app is not open yet gets a walkthrough, not a start link. */}
                  <Link href={start.href} className="text-link">
                    {start.label}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Compare */

type Cell = boolean | string;

interface Row {
  readonly label: string;
  readonly crm: Cell;
  readonly wms: Cell;
  readonly projects: Cell;
  readonly pulse: Cell;
  /** Two or more products together. */
  readonly stacked: Cell;
}

const ROWS: readonly Row[] = [
  { label: 'One sign-in and one launcher', crm: true, wms: true, projects: true, pulse: true, stacked: true },
  // Pulse keeps its own client list and links it to the shared one when another app is licensed.
  { label: 'Shared customer list', crm: true, wms: true, projects: true, pulse: 'Own list', stacked: true },
  // A new member gets no Pulse access until an admin grants it (SPEC 3), so the row promises the
  // shared team list, not that one invite opens every app.
  {
    label: 'One team list for every app',
    crm: true,
    wms: true,
    projects: true,
    pulse: true,
    stacked: true,
  },
  {
    label: 'Boards, pipeline, automations, dashboards',
    crm: true,
    wms: false,
    projects: false,
    pulse: false,
    stacked: true,
  },
  {
    label: 'Receiving, inventory, picking, packing, shipping',
    crm: false,
    wms: true,
    projects: false,
    pulse: false,
    stacked: true,
  },
  {
    label: 'Tasks, timelines, workload and cycles',
    crm: false,
    wms: false,
    projects: true,
    pulse: false,
    stacked: true,
  },
  {
    label: 'Profit by job, job type, client and extra service',
    crm: false,
    wms: false,
    projects: false,
    pulse: true,
    stacked: true,
  },
  {
    label: 'CSV in and out for every kind of Pulse data',
    crm: false,
    wms: false,
    projects: false,
    pulse: true,
    stacked: true,
  },
  {
    label: 'Stock and open orders on the account page',
    crm: false,
    wms: false,
    projects: false,
    pulse: false,
    stacked: 'CRM + WMS',
  },
  {
    label: 'Tasks linked to deals, orders and receipts',
    crm: false,
    wms: false,
    projects: false,
    pulse: false,
    stacked: 'With Projects',
  },
  {
    label: 'A won deal starts its delivery project',
    crm: false,
    wms: false,
    projects: false,
    pulse: false,
    stacked: 'CRM + Projects',
  },
  {
    label: 'A won deal becomes a job with the quote filled in',
    crm: false,
    wms: false,
    projects: false,
    pulse: false,
    stacked: 'CRM + Pulse',
  },
  {
    label: 'Work orders and finished kits feed job profit',
    crm: false,
    wms: false,
    projects: false,
    pulse: false,
    stacked: 'WMS + Pulse',
  },
  {
    label: 'Project time counts as labor hours on the job',
    crm: false,
    wms: false,
    projects: false,
    pulse: false,
    stacked: 'Projects + Pulse',
  },
  {
    label: 'Bundle price',
    crm: 'List',
    wms: 'List',
    projects: 'List',
    pulse: 'List',
    stacked: `${BUNDLE_OFF} off each`,
  },
];

const COLUMNS = ['crm', 'wms', 'projects', 'pulse'] as const;
const COLUMN_LABEL = { crm: 'CRM', wms: 'WMS', projects: 'Projects', pulse: 'Pulse' } as const;

function CellMark({ value }: { readonly value: Cell }) {
  if (typeof value === 'string') return <span className={styles.cellText}>{value}</span>;
  return value ? (
    <svg viewBox="0 0 16 16" width="18" height="18" role="img" aria-label="Included" className={styles.yes}>
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ) : (
    <span className={styles.no} role="img" aria-label="Not included" />
  );
}

export function Compare({ visual }: { readonly visual: React.ReactNode }) {
  return (
    <section id="together" className={`section ${styles.compare}`} aria-labelledby="together-heading">
      <div className="container">
        <div className={styles.compareHead}>
          <div>
            <h2 id="together-heading" className="h2" data-reveal>
              Better stacked.
            </h2>
            <p className="lead" data-reveal style={{ '--reveal-delay': 100 } as React.CSSProperties}>
              Every app reads the same customer record. Link a CRM account to the customer your warehouse
              ships for, and sales can see what is on the shelf. Add Projects, and the work for that customer
              points at the deal and the order it is about. Add Pulse, and you can turn a won deal or a work
              order into a job, then see its profit as the work is logged.
            </p>
          </div>
          <div data-reveal>{visual}</div>
        </div>

        <div
          className={styles.tableWrap}
          data-reveal
          tabIndex={0}
          role="region"
          aria-label="Product comparison"
        >
          <table className={styles.table}>
            <caption className="visually-hidden">
              What you get with each product and with two or more stacked
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Feature</span>
                </th>
                {COLUMNS.map((id) => (
                  <th key={id} scope="col">
                    <AppIcon app={id} size={40} /> {COLUMN_LABEL[id]}
                  </th>
                ))}
                <th scope="col" className={styles.bothCol}>
                  <StakMark lit="both" size={32} /> Stacked
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {COLUMNS.map((id) => (
                    <td key={id}>
                      <CellMark value={row[id]} />
                    </td>
                  ))}
                  <td className={styles.bothCol}>
                    <CellMark value={row.stacked} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ How it starts */

const STEPS = [
  {
    title: 'Create your account',
    body: 'Four fields: your name, your work email, a password and your company.',
  },
  {
    title: 'Pick your apps',
    body: `Switch on the apps you want. Your ${TRIAL_DAYS} day free trial starts right away. No card needed.`,
  },
  {
    title: 'Follow your setup plan',
    // The first job is a Pulse step, so it is named only once the Pulse app is open.
    body: isAppLive('pulse')
      ? 'A checklist built from your answers walks you through the first warehouse, the first board, the first order, the first project and the first job.'
      : 'A checklist built from your answers walks you through the first warehouse, the first board, the first order and the first project.',
  },
] as const;

export function StartSteps() {
  return (
    <section id="start" className="section" aria-labelledby="start-heading">
      <div className={`container ${styles.start}`}>
        <div>
          <h2 id="start-heading" className="h2" data-reveal>
            Set it up yourself.
          </h2>
          <p className="lead" data-reveal style={{ '--reveal-delay': 100 } as React.CSSProperties}>
            No sales call and no setup project. Create an account, pick your apps and KitStak builds the plan.
          </p>
          <div className={styles.startActions} data-reveal>
            <a href={startFreeHref()} className="btn btn-primary btn-lg">
              {START_LABEL}{' '}
              <span className="btn-arrow" aria-hidden>
                →
              </span>
            </a>
            <Link href={ROUTES.getStarted} className="btn btn-ghost btn-lg">
              {HELP_LABEL}
            </Link>
          </div>
        </div>
        <ol className={styles.steps}>
          {STEPS.map((step, i) => (
            <li key={step.title} data-reveal style={{ '--reveal-delay': 90 * i } as React.CSSProperties}>
              <span className={`numeral ${styles.stepIndex}`}>{i + 1}</span>
              <div>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepBody}>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
