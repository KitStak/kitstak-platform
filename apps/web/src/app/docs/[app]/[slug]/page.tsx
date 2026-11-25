import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocBody } from '@/components/docs/doc-body';
import { DocsSidebar } from '@/components/docs/docs-sidebar';
import { DocsToc } from '@/components/docs/docs-toc';
import styles from '@/components/docs/docs.module.css';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { JsonLd } from '@/components/json-ld';
import { PageEffects } from '@/components/page-effects';
import { ROUTES } from '@/components/site-links';
import { allDocPages, docApp, docPage, neighbors } from '@/lib/docs/docs';
import { breadcrumbLd, techArticleLd } from '@/lib/seo';

interface Props {
  readonly params: Promise<{ app: string; slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return allDocPages().map((page) => ({ app: page.app, slug: page.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { app: appId, slug } = await params;
  const app = docApp(appId);
  const page = docPage(appId, slug);
  if (!app || !page) return {};
  return {
    title: `${page.title} - ${app.title} docs`,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: {
      title: page.title,
      description: page.description,
      url: page.path,
      type: 'article',
      modifiedTime: page.updated,
    },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description },
  };
}

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function DocPageRoute({ params }: Props) {
  const { app: appId, slug } = await params;
  const app = docApp(appId);
  const page = docPage(appId, slug);
  if (!app || !page) notFound();
  const { prev, next } = neighbors(page);
  const minutes = Math.max(1, Math.round(page.wordCount / 220));

  return (
    <>
      <PageEffects />
      <Header solid />
      <main id="main">
        <JsonLd
          data={[
            techArticleLd({
              title: page.title,
              description: page.description,
              path: page.path,
              section: page.section,
              app: app.title,
              updated: page.updated,
              wordCount: page.wordCount,
            }),
            breadcrumbLd([
              { name: 'Docs', path: '/docs' },
              { name: app.title, path: app.path },
              { name: page.title, path: page.path },
            ]),
          ]}
        />
        <div className={`container ${styles.layout}`}>
          <DocsSidebar app={app} current={page.slug} />
          <article className={styles.main} aria-labelledby="doc-title">
            <ol className={styles.crumbs} aria-label="Breadcrumb">
              <li>
                <Link href="/docs">Docs</Link>
              </li>
              <li>
                <Link href={app.path}>{app.title}</Link>
              </li>
              <li>{page.section}</li>
            </ol>
            <h1 id="doc-title" className={styles.title}>
              {page.title}
            </h1>
            <p className={styles.lead}>{page.description}</p>
            <p className={styles.meta}>
              <span>
                Updated <time dateTime={page.updated}>{formatDate(page.updated)}</time>
              </span>
              <span>{minutes} min read</span>
            </p>
            <hr className={styles.rule} />
            <DocBody blocks={page.blocks} />
            <nav className={styles.pager} aria-label="Previous and next">
              {prev ? (
                <Link href={prev.path}>
                  <span className={styles.pagerLabel}>← Previous</span>
                  <span className={styles.pagerTitle}>{prev.title}</span>
                </Link>
              ) : null}
              {next ? (
                <Link href={next.path} className={styles.pagerNext}>
                  <span className={styles.pagerLabel}>Next →</span>
                  <span className={styles.pagerTitle}>{next.title}</span>
                </Link>
              ) : null}
            </nav>
            <p className={styles.help}>
              Something missing or unclear? <Link href={ROUTES.contact}>Tell us</Link> and we will fix the
              page. To see it in your own data, <Link href={ROUTES.demo}>book a walkthrough</Link>.
            </p>
          </article>
          <DocsToc headings={page.headings} />
        </div>
      </main>
      <Footer />
    </>
  );
}
