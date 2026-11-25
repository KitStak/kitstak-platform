import Link from 'next/link';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { ROUTES } from '@/components/site-links';
import styles from './legal.module.css';

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export interface LegalPageProps {
  readonly title: string;
  /** "November 23, 2026" */
  readonly updated: string;
  readonly intro: string;
  readonly sections: readonly LegalSection[];
  /** The sister page, linked at the end. */
  readonly other: { readonly href: string; readonly label: string };
}

function anchorFor(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Terms and Privacy on the marketing site, in the site's own header and footer. Sign-up, the portal
 * and every email link here, so a buyer reads the rules on kitstak.com and not inside an app.
 * Plain server markup: it reads the same with scripts off and for a crawler.
 */
export function LegalPage({ title, updated, intro, sections, other }: LegalPageProps) {
  return (
    <>
      <Header />
      <main id="main">
        <section className={styles.hero} aria-labelledby="legal-heading">
          <div className="container">
            <p className={styles.updated}>Last updated {updated}</p>
            <h1 id="legal-heading" className={styles.title}>
              {title}
            </h1>
            <p className={styles.intro}>{intro}</p>
          </div>
        </section>
        <div className="section">
          <div className={`container ${styles.body}`}>
            <nav aria-label="On this page">
              <ol className={styles.toc}>
                {sections.map((section, index) => (
                  <li key={section.heading}>
                    <a href={`#${anchorFor(section.heading)}`}>
                      {index + 1}. {section.heading}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <div>
              <div className={styles.sections}>
                {sections.map((section, index) => (
                  <section key={section.heading} id={anchorFor(section.heading)} aria-labelledby={`${anchorFor(section.heading)}-heading`}>
                    <h2 id={`${anchorFor(section.heading)}-heading`}>
                      {index + 1}. {section.heading}
                    </h2>
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </section>
                ))}
              </div>
              <p className={styles.other}>
                Read the <Link href={other.href}>{other.label}</Link> too. A question about any of this?{' '}
                <Link href={ROUTES.contact}>Talk to us</Link>.
              </p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
