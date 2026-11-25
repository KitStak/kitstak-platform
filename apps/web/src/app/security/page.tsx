import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/components/articles/articles.module.css';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { JsonLd } from '@/components/json-ld';
import { PageEffects } from '@/components/page-effects';
import { DISCLOSURE, SECURITY_GROUPS } from '@/components/security/security-content';
import sec from '@/components/security/security.module.css';
import { CONTACT, ROUTES } from '@/components/site-links';
import { breadcrumbLd } from '@/lib/seo';

const DESCRIPTION =
  'How KitStak protects your accounts, your data and your payments: hashed passwords, lockout, organization scoping, Stripe for cards, TLS and responsible disclosure.';

export const metadata: Metadata = {
  title: 'Security at KitStak - how we protect your data',
  description: DESCRIPTION,
  alternates: { canonical: ROUTES.security },
  openGraph: { title: 'Security at KitStak', description: DESCRIPTION, url: ROUTES.security },
};

export default function SecurityPage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <JsonLd data={breadcrumbLd([{ name: 'Security', path: ROUTES.security }])} />
        <section className={styles.hero} aria-labelledby="security-heading">
          <div className="container">
            <p className={styles.heroKicker}>Security</p>
            <h1 id="security-heading" className={styles.heroTitle}>
              Your orders, stock and customers, kept safe.
            </h1>
            <p className={styles.heroLead}>
              KitStak holds the records your business runs on. Here is how we protect them, in plain words.
              Everything on this page is how the apps work today.
            </p>
            <p className={styles.meta}>
              {SECURITY_GROUPS.map((group) => (
                <a key={group.id} href={`#${group.id}`} style={{ color: 'inherit' }}>
                  {group.title}
                </a>
              ))}
            </p>
          </div>
        </section>
        <section className="section" aria-label="Security controls">
          <div className={`container ${sec.groups}`}>
            {SECURITY_GROUPS.map((group) => (
              <section
                key={group.id}
                id={group.id}
                className={sec.group}
                aria-labelledby={`${group.id}-heading`}
              >
                <div data-reveal>
                  <h2 id={`${group.id}-heading`} className={sec.groupTitle}>
                    {group.title}
                  </h2>
                  <p className={sec.groupLead}>{group.lead}</p>
                </div>
                <ul className={sec.points}>
                  {group.points.map((point) => (
                    <li key={point.name} className={sec.point} data-reveal>
                      <h3 className={sec.pointName}>{point.name}</h3>
                      <p className={sec.pointNote}>{point.note}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <section id="disclosure" className={sec.disclosure} aria-labelledby="disclosure-heading">
              <div>
                <h2 id="disclosure-heading">{DISCLOSURE.title}</h2>
                <p>{DISCLOSURE.body}</p>
              </div>
              <div className={sec.actions}>
                <a href={`mailto:${CONTACT.email}?subject=Security`} className="btn btn-primary">
                  Report a problem{' '}
                  <span className="btn-arrow" aria-hidden>
                    →
                  </span>
                </a>
                <a href="/.well-known/security.txt" className="btn btn-ghost-inverse">
                  security.txt
                </a>
              </div>
            </section>
            <p style={{ color: 'var(--text-secondary)' }}>
              More detail on what we collect and why is in the{' '}
              <Link href={ROUTES.privacy}>privacy policy</Link>. A question this page does not answer?{' '}
              <Link href={ROUTES.contact}>Talk to us</Link>.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
