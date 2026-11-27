import type { Metadata } from 'next';
import { ArticleCard } from '@/components/articles/article-card';
import { ARTICLES } from '@/components/articles/articles-content';
import styles from '@/components/articles/articles.module.css';
import { ClosingSection } from '@/components/closing/closing-section';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { JsonLd } from '@/components/json-ld';
import { PageEffects } from '@/components/page-effects';
import { absoluteUrl, breadcrumbLd } from '@/lib/seo';

const DESCRIPTION =
  'Practical guides for warehouses, 3PLs and operations teams: location codes, 3PL billing, cycle counts, profit by job and switching software.';

export const metadata: Metadata = {
  title: 'Articles - KitStak guides for warehouses, 3PLs and operations teams',
  description: DESCRIPTION,
  alternates: {
    canonical: '/articles',
    types: { 'application/rss+xml': [{ url: '/articles/feed.xml', title: 'KitStak articles' }] },
  },
  openGraph: { title: 'KitStak articles', description: DESCRIPTION, url: '/articles', type: 'website' },
};

export default function ArticlesPage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <JsonLd
          data={[
            breadcrumbLd([{ name: 'Articles', path: '/articles' }]),
            {
              '@context': 'https://schema.org',
              '@type': 'CollectionPage',
              name: 'KitStak articles',
              description: DESCRIPTION,
              url: absoluteUrl('/articles'),
              hasPart: ARTICLES.map((a) => ({
                '@type': 'Article',
                headline: a.title,
                url: absoluteUrl(`/articles/${a.slug}`),
              })),
            },
          ]}
        />
        <section className={styles.hero} aria-labelledby="articles-heading">
          <div className="container">
            <p className={styles.heroKicker}>Articles</p>
            <h1 id="articles-heading" className={styles.heroTitle}>
              Run a tighter floor.
            </h1>
            <p className={styles.heroLead}>
              Field notes for warehouses, 3PLs and the teams that sell for them. Written by people who run
              one.
            </p>
          </div>
        </section>
        <section className="section" aria-label="All articles">
          <div className="container">
            <ul className={styles.grid} role="list">
              {ARTICLES.map((article) => (
                <li key={article.slug}>
                  <ArticleCard article={article} />
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
