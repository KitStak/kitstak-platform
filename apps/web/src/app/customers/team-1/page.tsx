import type { Metadata } from 'next';
import Link from 'next/link';
import { ClosingSection } from '@/components/closing/closing-section';
import {
  BEFORE,
  FLOOR,
  FLOOR_JOBS,
  MOVE_STEPS,
  STATS,
  TEAM1,
  TODAY,
} from '@/components/customers/team1-content';
import styles from '@/components/customers/customers.module.css';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { JsonLd } from '@/components/json-ld';
import { PageEffects } from '@/components/page-effects';
import { ROUTES, START_LABEL, startFreeHref } from '@/components/site-links';
import { absoluteUrl, breadcrumbLd } from '@/lib/seo';

const TITLE = 'How Team 1 moved its CRM off monday.com in one day';
const DESCRIPTION =
  'Team 1 moved 28 boards and 210 items off monday.com in one day and put seven people on one sign-in. KitStak WMS was built on its floor.';

export const metadata: Metadata = {
  title: `${TITLE} - KitStak customer story`,
  description: DESCRIPTION,
  alternates: { canonical: ROUTES.team1 },
  openGraph: { title: TITLE, description: DESCRIPTION, url: ROUTES.team1, type: 'article' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

const MOVED = new Date(`${TEAM1.movedOn}T12:00:00Z`).toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('');
}

export default function Team1Page() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <JsonLd
          data={[
            breadcrumbLd([
              { name: 'Customers', path: ROUTES.customers },
              { name: TEAM1.name, path: ROUTES.team1 },
            ]),
            {
              '@context': 'https://schema.org',
              '@type': 'Article',
              headline: TITLE,
              description: DESCRIPTION,
              url: absoluteUrl(ROUTES.team1),
              datePublished: '2026-11-25',
              about: { '@type': 'Organization', name: TEAM1.name },
              author: { '@type': 'Organization', name: 'KitStak', url: absoluteUrl('/') },
              publisher: { '@id': absoluteUrl('/#organization') },
            },
          ]}
        />
        <section className={styles.hero} aria-labelledby="story-heading">
          <div className="container">
            <p className={styles.kicker}>
              <Link href={ROUTES.customers}>Customers</Link> / {TEAM1.name}
            </p>
            <h1 id="story-heading" className={styles.title}>
              Two tools, one person in between. Now one stack.
            </h1>
            <p className={styles.lead}>
              Team 1 ran its clients in monday.com and its warehouse in Logiwa. Nothing connected them except
              the people who had to copy between them. On {MOVED}, Team 1 moved its CRM onto KitStak in a
              single day.
            </p>
            <p className={styles.facts}>
              <span>
                <strong>Company</strong> {TEAM1.name}
              </span>
              <span>
                <strong>Work</strong> {TEAM1.industry}
              </span>
              <span>
                <strong>Moved from</strong> monday.com
              </span>
              <span>
                <strong>Runs</strong> KitStak CRM
              </span>
            </p>
            <dl className={styles.stats}>
              {STATS.map((stat) => (
                <div key={stat.label} className={`${styles.stat} ${styles.statPair}`}>
                  <dt className={styles.statLabel}>{stat.label}</dt>
                  <dd className={styles.statValue}>{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className={styles.quoteSection} aria-label={`What ${TEAM1.person.name} says`}>
          <div className="container">
            <figure data-reveal>
              <blockquote className={styles.quote}>
                <p>{TEAM1.quote}</p>
              </blockquote>
              <figcaption className={styles.cite}>
                <span className={styles.avatar} aria-hidden>
                  {initials(TEAM1.person.name)}
                </span>
                <span>
                  <span className={styles.citeName}>{TEAM1.person.name}</span>
                  <span className={styles.citeTitle}>{TEAM1.person.title}</span>
                </span>
              </figcaption>
            </figure>
            <p className={styles.disclosure}>{TEAM1.disclosure}</p>
          </div>
        </section>

        <section className={`section ${styles.sunken}`} aria-labelledby="before-heading">
          <div className={`container ${styles.split}`}>
            <div data-reveal>
              <h2 id="before-heading" className={styles.sectionTitle}>
                Before: good tools, no bridge.
              </h2>
              <p className={styles.sectionLead}>
                Both tools did their job. The cost was in the gap between them, and it was paid in copying and
                in questions nobody could answer quickly.
              </p>
            </div>
            <ul className={styles.beforeList} data-reveal>
              {BEFORE.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section" aria-labelledby="move-heading">
          <div className={`container ${styles.split}`}>
            <div data-reveal>
              <h2 id="move-heading" className={styles.sectionTitle}>
                The move, step by step.
              </h2>
              <p className={styles.sectionLead}>
                28 boards and 210 items, with their groups, subitems, people, dates and statuses. Done in one
                day and checked against the count taken before it started.
              </p>
              <p className={styles.sectionLead}>
                <Link href="/articles/moving-off-monday-com" className="text-link">
                  The full migration checklist{' '}
                  <span className="btn-arrow" aria-hidden>
                    →
                  </span>
                </Link>
              </p>
            </div>
            <ol className={styles.steps}>
              {MOVE_STEPS.map((step) => (
                <li key={step.title} data-reveal>
                  <div>
                    <h3 className={styles.stepTitle}>{step.title}</h3>
                    <p className={styles.stepBody}>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={`section ${styles.sunken}`} aria-labelledby="floor-heading">
          <div className={`container ${styles.split}`}>
            <div data-reveal>
              <h2 id="floor-heading" className={styles.sectionTitle}>
                A warehouse app built on a real floor.
              </h2>
              <p className={styles.sectionLead}>
                KitStak WMS was built against Team 1’s own floor, so it speaks the floor’s language. The codes
                on its shelves are the codes in the app.
              </p>
              <ul className={styles.jobs} aria-label="Job types on the Team 1 floor">
                {FLOOR_JOBS.map((job) => (
                  <li key={job}>{job}</li>
                ))}
              </ul>
            </div>
            <ul className={styles.floor} data-reveal>
              {FLOOR.map((fact) => (
                <li key={fact.code}>
                  <span className={styles.code}>{fact.code}</span>
                  <span className={styles.codeLabel}>{fact.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section" aria-labelledby="today-heading">
          <div className="container">
            <h2 id="today-heading" className={styles.sectionTitle} data-reveal>
              Team 1 today.
            </h2>
            <ul className={styles.today} style={{ marginTop: 40 }}>
              {TODAY.map((item) => (
                <li key={item.title} data-reveal>
                  <h3 className={styles.stepTitle}>{item.title}</h3>
                  <p className={styles.stepBody}>{item.body}</p>
                </li>
              ))}
            </ul>
            <p style={{ marginTop: 48, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <a href={startFreeHref()} className="btn btn-primary btn-lg">
                {START_LABEL}{' '}
                <span className="btn-arrow" aria-hidden>
                  →
                </span>
              </a>
              <Link href={ROUTES.founder} className="btn btn-ghost btn-lg">
                Plan your move with the founder
              </Link>
            </p>
          </div>
        </section>
        <ClosingSection />
      </main>
      <Footer />
    </>
  );
}
