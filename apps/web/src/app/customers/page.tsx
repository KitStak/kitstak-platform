import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/components/articles/articles.module.css';
import { ClosingSection } from '@/components/closing/closing-section';
import { STATS, TEAM1 } from '@/components/customers/team1-content';
import story from '@/components/customers/customers.module.css';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { JsonLd } from '@/components/json-ld';
import { PageEffects } from '@/components/page-effects';
import { ROUTES } from '@/components/site-links';
import { breadcrumbLd } from '@/lib/seo';

const DESCRIPTION = 'How operations teams run on KitStak. Real moves, real numbers, no stock photos.';

export const metadata: Metadata = {
  title: 'KitStak customers - real teams running on one stack',
  description: DESCRIPTION,
  alternates: { canonical: ROUTES.customers },
  openGraph: { title: 'KitStak customers', description: DESCRIPTION, url: ROUTES.customers },
};

export default function CustomersPage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <JsonLd data={breadcrumbLd([{ name: 'Customers', path: ROUTES.customers }])} />
        <section className={styles.hero} aria-labelledby="customers-heading">
          <div className="container">
            <p className={styles.heroKicker}>Customers</p>
            <h1 id="customers-heading" className={styles.heroTitle}>
              Real teams. Real moves.
            </h1>
            <p className={styles.heroLead}>{DESCRIPTION}</p>
          </div>
        </section>
        <section className="section" aria-label="Customer stories">
          <div className="container">
            <Link href={ROUTES.team1} className={story.storyCard}>
              <div>
                <span className={styles.cardCategory}>{TEAM1.industry}</span>
                <h2 className={story.storyCardTitle}>{TEAM1.name}: 28 boards off monday.com in one day.</h2>
                <p className={story.storyCardBody}>
                  “{TEAM1.shortQuote}” {TEAM1.person.name}, {TEAM1.person.title}.
                </p>
                <p className={story.storyCardBody}>
                  <span className="text-link">
                    Read the story{' '}
                    <span className="btn-arrow" aria-hidden>
                      →
                    </span>
                  </span>
                </p>
                <p className={story.disclosure}>{TEAM1.disclosure}</p>
              </div>
              <dl className={story.storyCardStats}>
                {STATS.map((stat) => (
                  <div key={stat.label} className={story.statPair}>
                    <dt className={story.statLabel}>{stat.label}</dt>
                    <dd className={story.statValue}>{stat.value}</dd>
                  </div>
                ))}
              </dl>
            </Link>
          </div>
        </section>
        <ClosingSection />
      </main>
      <Footer />
    </>
  );
}
