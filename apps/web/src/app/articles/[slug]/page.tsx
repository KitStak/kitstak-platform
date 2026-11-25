import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleBody } from '@/components/articles/article-body';
import { ArticleCard } from '@/components/articles/article-card';
import {
  ARTICLES,
  articleBySlug,
  formatArticleDate,
  readingMinutes,
  wordCount,
} from '@/components/articles/articles-content';
import styles from '@/components/articles/articles.module.css';
import { ClosingSection } from '@/components/closing/closing-section';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { JsonLd } from '@/components/json-ld';
import { PageEffects } from '@/components/page-effects';
import { ROUTES } from '@/components/site-links';
import { articleLd, breadcrumbLd } from '@/lib/seo';

interface Props {
  readonly params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return ARTICLES.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = articleBySlug((await params).slug);
  if (!article) return {};
  const path = `/articles/${article.slug}`;
  return {
    title: `${article.title} - KitStak`,
    description: article.description,
    alternates: { canonical: path },
    openGraph: {
      title: article.title,
      description: article.description,
      url: path,
      type: 'article',
      publishedTime: article.published,
      modifiedTime: article.updated,
      section: article.category,
      authors: ['KitStak'],
    },
    twitter: { card: 'summary_large_image', title: article.title, description: article.description },
  };
}

export default async function ArticlePage({ params }: Props) {
  const article = articleBySlug((await params).slug);
  if (!article) notFound();
  const path = `/articles/${article.slug}`;
  const related = ARTICLES.filter((a) => a.slug !== article.slug).slice(0, 3);

  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <JsonLd
          data={[
            articleLd({
              title: article.title,
              description: article.description,
              path,
              published: article.published,
              updated: article.updated,
              section: article.category,
              wordCount: wordCount(article),
            }),
            breadcrumbLd([
              { name: 'Articles', path: '/articles' },
              { name: article.title, path },
            ]),
          ]}
        />
        <article aria-labelledby="article-heading">
          <header className={styles.hero}>
            <div className="container">
              <p className={styles.heroKicker}>
                <Link href={ROUTES.articles}>Articles</Link> / {article.category}
              </p>
              <h1 id="article-heading" className={styles.heroTitle}>
                {article.title}
              </h1>
              <p className={styles.heroLead}>{article.description}</p>
              <p className={styles.meta}>
                <span>
                  By KitStak ·{' '}
                  <time dateTime={article.published}>{formatArticleDate(article.published)}</time>
                </span>
                <span>{readingMinutes(article)} min read</span>
              </p>
            </div>
          </header>
          <div className="section">
            <div className={`container ${styles.layout}`}>
              <ArticleBody blocks={article.blocks} />
              <aside className={styles.side} aria-label="Next step">
                <p className={styles.sideTitle}>{article.cta.title}</p>
                <p>{article.cta.body}</p>
                <Link href={article.cta.href} className="btn btn-primary">
                  {article.cta.label}{' '}
                  <span className="btn-arrow" aria-hidden>
                    →
                  </span>
                </Link>
                <Link href={ROUTES.team1} className="text-link">
                  Read the Team 1 story{' '}
                  <span className="btn-arrow" aria-hidden>
                    →
                  </span>
                </Link>
              </aside>
            </div>
            <div className="container">
              <section className={styles.more} aria-labelledby="more-heading">
                <h2 id="more-heading" className={styles.moreTitle}>
                  Keep reading
                </h2>
                <ul className={styles.grid} role="list">
                  {related.map((a) => (
                    <li key={a.slug}>
                      <ArticleCard article={a} headingLevel={3} />
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </article>
        <ClosingSection />
      </main>
      <Footer />
    </>
  );
}
