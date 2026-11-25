import type { Metadata } from 'next';
import Link from 'next/link';
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
import { ROUTES, isAppLive } from '@/components/site-links';
import { BUNDLE_OFF, TRIAL_DAYS, YEARLY_OFF, includedSeatsLabel, priceInWords } from '@/lib/pricing';
import styles from './products.module.css';

export const metadata: Metadata = {
  title: 'KitStak products - CRM, WMS, Projects and Pulse, stacked to save',
  description:
    'Compare KitStak CRM, KitStak WMS, KitStak Projects and KitStak Pulse, see what you get when you run them together, and price your stack.',
  alternates: { canonical: '/products' },
  openGraph: {
    title: 'KitStak products',
    description: 'A CRM, a WMS, Projects and Pulse on one stack.',
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

/** Added to the answers about starting while nobody can open Pulse yet. */
const PULSE_SOON = isAppLive('pulse')
  ? ''
  : ' Pulse is coming soon. For Pulse, book a walkthrough and we will show it to you.';

const FAQ: readonly FaqItem[] = [
  {
    question: 'Can I start with one product and add the others later?',
    answer: `Yes. Each product is licensed on its own. When you add a second one, your organization, your team and your customer list are already there, and the bundle price applies to every product from then on.${PULSE_SOON}`,
  },
  {
    question: 'What do the products actually share?',
    answer:
      'One sign-in, one launcher, one organization with its members, and one customer list. A CRM account can be linked to the customer your warehouse ships for, which puts on-hand stock and open shipment orders on the account page. A Projects task can be linked to a CRM deal or account, a customer, or a WMS order, work order, receipt or count, and shows where that record stands now. Pulse uses the same sign-in. It pulls in won deals from the CRM, work orders and finished kits from the WMS, and logged time from Projects. Each one keeps a link back to its source.',
  },
  {
    question: 'How is each product priced?',
    answer: `The CRM is ${priceInWords('crm')}. Projects is ${priceInWords('projects')}. The WMS is ${priceInWords('wms')}. Pulse is ${priceInWords('pulse')}. ${includedSeatsLabel('pulse')}. With two or more apps you save ${BUNDLE_OFF} on every app. Pay yearly and you save ${YEARLY_OFF} more. Every plan starts with ${TRIAL_DAYS} days free, and no card is needed. The calculator on this page shows the math.`,
  },
  {
    question: 'Do I have to talk to someone to get started?',
    answer: `No. The setup wizard asks a few questions and builds a plan, and you create your own account at the end. Your free trial starts right away. If you would rather be walked through it, the founder will do that with you.${PULSE_SOON}`,
  },
  {
    question: 'Can I get help moving our data in?',
    answer:
      'The CRM and the WMS import spreadsheets, and the setup plan points you at the right importer. Projects starts from templates that come with their tasks and dates. Pulse takes CSV files for every kind of data it holds, and checks each file before anything is saved. For larger moves, book time with the founder and plan it together.',
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
        <Compare
          visual={
            <AccountLink caption="One customer record, shown here in the CRM and the WMS. Projects and Pulse link to it too. Sample data." />
          }
        />

        <section id="pricing" className="section" aria-labelledby="pricing-heading">
          <span id="bundle" className={styles.anchor} />
          <div className="container">
            <h2 id="pricing-heading" className="h2" data-reveal>
              Bundle and save.
            </h2>
            <p className="lead" data-reveal style={{ '--reveal-delay': 100 } as React.CSSProperties}>
              Switch the apps on, set the size of your team, and see the price. Then start your free trial
              with that plan.{' '}
              <Link href={ROUTES.pricing} className="text-link">
                See how billing works
              </Link>
            </p>
            <div className={styles.calc} data-reveal>
              <BundleCalculator source="pricing" />
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
