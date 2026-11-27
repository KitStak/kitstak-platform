import type { Metadata } from 'next';
import Link from 'next/link';
import { ClosingSection } from '@/components/closing/closing-section';
import { DocsSearch } from '@/components/docs/docs-search';
import styles from '@/components/docs/docs.module.css';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { JsonLd } from '@/components/json-ld';
import { PageEffects } from '@/components/page-effects';
import { allDocPages, docApps } from '@/lib/docs/docs';
import { absoluteUrl, breadcrumbLd } from '@/lib/seo';

const DESCRIPTION =
  'Step by step guides for every feature in KitStak WMS, CRM, Projects and Pulse: setup, daily work, automations, billing, integrations and admin.';

export const metadata: Metadata = {
  title: 'KitStak docs - guides for the WMS, CRM, Projects and Pulse',
  description: DESCRIPTION,
  alternates: { canonical: '/docs' },
  openGraph: { title: 'KitStak docs', description: DESCRIPTION, url: '/docs' },
};

export default function DocsHome() {
  const apps = docApps();
  const total = allDocPages().length;
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <JsonLd
          data={[
            breadcrumbLd([{ name: 'Docs', path: '/docs' }]),
            {
              '@context': 'https://schema.org',
              '@type': 'CollectionPage',
              name: 'KitStak docs',
              description: DESCRIPTION,
              url: absoluteUrl('/docs'),
              hasPart: apps.map((a) => ({
                '@type': 'CollectionPage',
                name: `${a.title} docs`,
                url: absoluteUrl(a.path),
              })),
            },
          ]}
        />
        <section className={styles.hero} aria-labelledby="docs-heading">
          <div className="container">
            <p className={styles.heroKicker}>Docs</p>
            <h1 id="docs-heading" className={styles.heroTitle}>
              How to do everything in KitStak.
            </h1>
            <p className={styles.heroLead}>
              {total} guides across every app, written from the screens you use. Search, or pick an app.
            </p>
            <div className={styles.heroSearch}>
              <DocsSearch large />
            </div>
          </div>
        </section>
        <section className="section" aria-label="Docs by app">
          <div className="container">
            <ul className={styles.apps}>
              {apps.map((app) => (
                <li key={app.id}>
                  <div className={styles.appCard}>
                    <h2 className={styles.appCardTitle}>
                      <Link href={app.path}>{app.title}</Link>
                    </h2>
                    <p className={styles.appCardDesc}>{app.description}</p>
                    <p className={styles.appCardMeta}>
                      {app.pages.length} guides in {app.sections.length} sections
                    </p>
                    <ul className={styles.appCardLinks}>
                      {app.sections.slice(0, 6).map((section) => (
                        <li key={section.title}>
                          <Link href={section.pages[0]?.path ?? app.path}>{section.title}</Link>
                        </li>
                      ))}
                    </ul>
                    <p className={styles.appCardMore}>
                      <Link href={app.path} className="text-link">
                        All {app.title} guides{' '}
                        <span className="btn-arrow" aria-hidden>
                          →
                        </span>
                      </Link>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <ClosingSection />
      </main>
      <Footer />
    </>
  );
}
