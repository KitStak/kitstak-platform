import type { Metadata } from 'next';
import { ClosingSection } from '@/components/closing/closing-section';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { AccountLink } from '@/components/mock/account-link';
import { PageEffects } from '@/components/page-effects';
import { Faq, FounderBand } from '@/components/product/cta';
import type { FaqItem } from '@/components/product/cta';
import { SubNav } from '@/components/product/sub-nav';
import type { SubNavSection } from '@/components/product/sub-nav';
import { Compare, Lineup, StackHero, StartSteps } from '@/components/products/products-sections';
import { BundleCalculator } from '@/components/stak/bundle-calculator';
import styles from './products.module.css';

export const metadata: Metadata = {
  title: 'KitStak products — CRM, WMS, or both and save',
  description:
    'Compare KitStak CRM and KitStak WMS, see what you get when you run them together, and price your stack.',
  alternates: { canonical: '/products' },
  openGraph: {
    title: 'KitStak products',
    description: 'A CRM, a WMS, or both on one stack.',
    url: 'https://kitstak.com/products',
    siteName: 'KitStak',
    type: 'website',
  },
};

const SECTIONS: readonly SubNavSection[] = [
  { id: 'lineup', label: 'Products' },
  { id: 'together', label: 'Better stacked' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'start', label: 'Getting started' },
  { id: 'faq', label: 'FAQ' },
];

const FAQ: readonly FaqItem[] = [
  {
    question: 'Can I start with one product and add the other later?',
    answer:
      'Yes. Each product is licensed on its own. When you add the second one, your organization, your team and your customer list are already there, and the bundle price applies to both from then on.',
  },
  {
    question: 'What do the two products actually share?',
    answer:
      'One sign-in, one launcher, one organization with its members, and one customer list. A CRM account can be linked to the customer your warehouse ships for, which puts on-hand stock and open shipment orders on the account page.',
  },
  {
    question: 'How is each product priced?',
    answer:
      'The CRM is priced per user and the WMS per warehouse. Running both takes a percentage off each, and paying yearly takes a further percentage off the total. The calculator on this page shows the arithmetic.',
  },
  {
    question: 'Do I have to talk to someone to get started?',
    answer:
      'No. The setup wizard asks a few questions and builds a plan, and you create your own account at the end. If you would rather be walked through it, the founder will do that with you.',
  },
  {
    question: 'Can I get help moving our data in?',
    answer:
      'Both products import spreadsheets, and the setup plan points you at the right importer. For larger moves, book time with the founder and plan it together.',
  },
];

export default function ProductsPage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <StackHero />
        <SubNav current="products" sections={SECTIONS} />
        <Lineup />
        <Compare visual={<AccountLink />} />

        <section id="pricing" className="section" aria-labelledby="pricing-heading">
          <span id="bundle" className={styles.anchor} />
          <div className="container">
            <h2 id="pricing-heading" className="h2" data-reveal>
              Bundle and save.
            </h2>
            <p className="lead" data-reveal style={{ '--reveal-delay': 100 } as React.CSSProperties}>
              Switch the products on, set the size of your operation, and see the price. Then carry it straight into
              setup.
            </p>
            <div className={styles.calc} data-reveal>
              <BundleCalculator />
            </div>
          </div>
        </section>

        <StartSteps />
        <Faq items={FAQ} />
        <FounderBand
          title="Rather be walked through it?"
          body="Book twenty minutes with the founder. Bring your current tools and your questions, and leave with a setup plan and a straight answer on fit."
        />
        <ClosingSection />
      </main>
      <Footer />
    </>
  );
}
