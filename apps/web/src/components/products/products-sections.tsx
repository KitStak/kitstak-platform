import Link from 'next/link';
import { PRICING, formatUsd, percentLabel } from '@/lib/pricing';
import { ROUTES, getStartedHref } from '../site-links';
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
] as const;

/** The mark as navigation: each bar of the stack is a product you can open. */
export function StackHero() {
  return (
    <section id="top" className={styles.hero} aria-labelledby="hero-heading">
      <div className={`container ${styles.heroInner}`}>
        <div>
          <h1 id="hero-heading" className={styles.heroTitle}>
            <span>Two products.</span>
            <span>One stack.</span>
          </h1>
          <p className={styles.heroLead}>
            A CRM for the people who sell and a WMS for the people who ship. Each one stands on its own. Together they
            share customers, one sign-in and one bill, and cost {percentLabel(PRICING.bundleDiscount)} less.
          </p>
          <div className={styles.heroActions}>
            <Link href={ROUTES.getStarted} className="btn btn-primary btn-lg">
              Set up your Stak <span className="btn-arrow" aria-hidden>→</span>
            </Link>
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
          <p className={styles.slabNote}>The top bar is the CRM. The bottom bar is the WMS. That is the logo.</p>
        </nav>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Line-up */

interface ProductCard {
  readonly id: 'wms' | 'crm';
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
      '3PL clients and billing',
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
];

export function Lineup() {
  return (
    <section id="lineup" className="section" aria-labelledby="lineup-heading">
      <div className="container">
        <h2 id="lineup-heading" className="h2" data-reveal>
          Pick where to start.
        </h2>
        <p className="lead" data-reveal style={{ '--reveal-delay': 100 } as React.CSSProperties}>
          Most teams start with the one that hurts most today, and add the other when they are ready.
        </p>
        <div className={styles.cards}>
          {CARDS.map((card, i) => (
            <article key={card.id} className={styles.card} data-reveal style={{ '--reveal-delay': 100 * i } as React.CSSProperties}>
              <header className={styles.cardHead}>
                <StakMark lit={card.id} size={44} />
                <span className={styles.cardName}>{card.name}</span>
                <span className={styles.cardPrice}>
                  from {formatUsd(PRICING[card.id].monthlyCents)} / {PRICING[card.id].unit}
                </span>
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
                  Explore {card.name} <span className="btn-arrow" aria-hidden>→</span>
                </Link>
                <Link href={getStartedHref(card.id)} className="text-link">
                  Start with the {card.id.toUpperCase()}
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Compare */

type Cell = boolean | string;

const ROWS: readonly { readonly label: string; readonly crm: Cell; readonly wms: Cell; readonly both: Cell }[] = [
  { label: 'One sign-in and one launcher', crm: true, wms: true, both: true },
  { label: 'Shared customer list', crm: true, wms: true, both: true },
  { label: 'Team invites that cover every app', crm: true, wms: true, both: true },
  { label: 'Boards, pipeline, automations, dashboards', crm: true, wms: false, both: true },
  { label: 'Receiving, inventory, picking, packing, shipping', crm: false, wms: true, both: true },
  { label: 'Stock and open orders on the account page', crm: false, wms: false, both: true },
  { label: 'A setup plan that covers sales and the floor', crm: false, wms: false, both: true },
  { label: 'Bundle price', crm: 'List', wms: 'List', both: `${percentLabel(PRICING.bundleDiscount)} off both` },
];

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
              Both apps read the same customer record. Link a CRM account to the customer your warehouse ships for, and
              sales can see what is on the shelf and what is on its way out.
            </p>
          </div>
          <div data-reveal>{visual}</div>
        </div>

        <div className={styles.tableWrap} data-reveal tabIndex={0} role="region" aria-label="Product comparison">
          <table className={styles.table}>
            <caption className="visually-hidden">What you get with each product and with both</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Feature</span>
                </th>
                <th scope="col">
                  <StakMark lit="crm" size={28} /> CRM
                </th>
                <th scope="col">
                  <StakMark lit="wms" size={28} /> WMS
                </th>
                <th scope="col" className={styles.bothCol}>
                  <StakMark lit="both" size={28} /> Both
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>
                    <CellMark value={row.crm} />
                  </td>
                  <td>
                    <CellMark value={row.wms} />
                  </td>
                  <td className={styles.bothCol}>
                    <CellMark value={row.both} />
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

/* ------------------------------------------------------------------ Preview product */

/** A short band for the product that is announced but not yet available. */
export function ProjectsTeaser() {
  return (
    <section className={styles.teaser} aria-labelledby="teaser-heading">
      <div className={`container ${styles.teaserInner}`}>
        <StakMark lit="projects" size={64} />
        <div>
          <p className={styles.teaserBadge}>Preview · in development</p>
          <h2 id="teaser-heading" className={styles.teaserTitle}>
            A third bar is on the way.
          </h2>
          <p className={styles.teaserBody}>
            KitStak Projects puts tasks, timelines and workload on the same stack, linked to the deals and warehouse
            records the work is about.
          </p>
        </div>
        <Link href={ROUTES.projects} className="btn btn-ghost-inverse btn-lg">
          Preview KitStak Projects <span className="btn-arrow" aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ How it starts */

const STEPS = [
  {
    title: 'Set up your Stak',
    body: 'Five short questions: which products, what kind of business, how big, and how you want to begin.',
  },
  {
    title: 'Create your account',
    body: 'Your name, your work email and your company. That creates your organization and your sign-in.',
  },
  {
    title: 'Follow your setup plan',
    body: 'A checklist built from your answers walks you through the first warehouse, the first board and the first order.',
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
            No sales call required and no implementation project. Answer a few questions and KitStak builds the plan.
          </p>
          <div className={styles.startActions} data-reveal>
            <Link href={ROUTES.getStarted} className="btn btn-primary btn-lg">
              Set up your Stak <span className="btn-arrow" aria-hidden>→</span>
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
