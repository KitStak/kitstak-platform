import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ClosingSection } from '@/components/closing/closing-section';
import { ContactForm } from '@/components/contact/contact-form';
import styles from '@/components/contact/contact.module.css';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { PageEffects } from '@/components/page-effects';
import { ROUTES } from '@/components/site-links';
import { StakMark } from '@/components/stak-mark';

export const metadata: Metadata = {
  title: 'Contact KitStak - talk to the founder',
  description: 'Talk to the founder, book a walkthrough of the CRM, the WMS, Projects or Pulse, or ask about pricing and bundles.',
  alternates: { canonical: '/contact' },
};

const PATHS = [
  {
    title: 'Set it up yourself',
    body: 'Five questions, a price and a setup plan. No call needed.',
    href: ROUTES.getStarted,
    label: 'Set up your Stak',
  },
  {
    title: 'See what it costs',
    body: 'Price the CRM, the WMS, Projects, Pulse or a bundle for your team.',
    href: ROUTES.pricing,
    label: 'Price your stack',
  },
  {
    title: 'Read up first',
    body: 'Every feature of every product, chapter by chapter.',
    href: ROUTES.products,
    label: 'Compare products',
  },
] as const;

export default function ContactPage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <section id="top" className={styles.hero} aria-labelledby="contact-heading">
          <div className={`container ${styles.heroInner}`}>
            <div className={styles.heroCopy}>
              <StakMark lit="both" size={48} />
              <h1 id="contact-heading" className={styles.title}>
                Talk to the founder.
              </h1>
              <p className={styles.lead}>
                Skip the sales team. Ask your question and get an answer from the person responsible for every product,
                start to finish.
              </p>
              <ul className={styles.promises}>
                <li>Twenty minutes, your operation, no slides</li>
                <li>A straight answer on whether it fits</li>
                <li>A setup plan you can follow on your own</li>
              </ul>
            </div>
            <div className={styles.formCard}>
              <Suspense fallback={<div className={styles.formFallback} />}>
                <ContactForm />
              </Suspense>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="paths-heading">
          <div className="container">
            <h2 id="paths-heading" className="h2" data-reveal>
              Or skip the call.
            </h2>
            <ul className={styles.paths}>
              {PATHS.map((path, i) => (
                <li key={path.title} data-reveal style={{ '--reveal-delay': 80 * i } as React.CSSProperties}>
                  <h3>{path.title}</h3>
                  <p>{path.body}</p>
                  <Link href={path.href} className="text-link">
                    {path.label} <span className="btn-arrow" aria-hidden>→</span>
                  </Link>
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
