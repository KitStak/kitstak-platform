import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocsSidebar } from '@/components/docs/docs-sidebar';
import styles from '@/components/docs/docs.module.css';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { JsonLd } from '@/components/json-ld';
import { PageEffects } from '@/components/page-effects';
import { docApp, docApps } from '@/lib/docs/docs';
import { absoluteUrl, breadcrumbLd } from '@/lib/seo';

interface Props {
  readonly params: Promise<{ app: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return docApps().map((app) => ({ app: app.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const app = docApp((await params).app);
  if (!app) return {};
  const title = `${app.title} docs`;
  return {
    title: `${title} - every feature, step by step`,
    description: app.description,
    alternates: { canonical: app.path },
    openGraph: { title, description: app.description, url: app.path },
  };
}

export default async function DocsAppPage({ params }: Props) {
  const app = docApp((await params).app);
  if (!app) notFound();
  return (
    <>
      <PageEffects />
      <Header solid />
      <main id="main">
        <JsonLd
          data={[
            breadcrumbLd([
              { name: 'Docs', path: '/docs' },
              { name: app.title, path: app.path },
            ]),
            {
              '@context': 'https://schema.org',
              '@type': 'CollectionPage',
              name: `${app.title} docs`,
              description: app.description,
              url: absoluteUrl(app.path),
              hasPart: app.pages.map((p) => ({
                '@type': 'TechArticle',
                headline: p.title,
                url: absoluteUrl(p.path),
              })),
            },
          ]}
        />
        <div className={`container ${styles.layout} ${styles.layoutNoToc}`}>
          <DocsSidebar app={app} current={null} />
          <div className={styles.main}>
            <ol className={styles.crumbs} aria-label="Breadcrumb">
              <li>
                <Link href="/docs">Docs</Link>
              </li>
              <li aria-current="page">{app.title}</li>
            </ol>
            <h1 className={styles.title}>{app.title} docs</h1>
            <p className={styles.lead}>{app.description}</p>
            <p className={styles.meta}>
              <span>{app.pages.length} guides</span>
              <span>{app.sections.length} sections</span>
            </p>
            <hr className={styles.rule} />
            <div className={styles.overviewSections}>
              {app.sections.map((section) => (
                <section key={section.title} className={styles.overviewSection} aria-label={section.title}>
                  <h2>{section.title}</h2>
                  <ul className={styles.overviewList}>
                    {section.pages.map((page) => (
                      <li key={page.slug}>
                        <Link href={page.path}>
                          <span className={styles.overviewItemTitle}>{page.title}</span>
                          <span className={styles.overviewItemDesc}>{page.description}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
