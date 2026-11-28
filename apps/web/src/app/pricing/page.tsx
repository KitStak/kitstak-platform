import type { Metadata } from 'next';
import { JsonLd } from '@/components/json-ld';
import { breadcrumbLd } from '@/lib/seo';
import { ClosingSection } from '@/components/closing/closing-section';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { PageEffects } from '@/components/page-effects';
import { BillingRules } from '@/components/pricing/billing-rules';
import { PRICING_FAQ } from '@/components/pricing/pricing-content';
import { PricingExplorer } from '@/components/pricing/pricing-explorer';
import { Faq } from '@/components/product/cta';
import { BUNDLE_OFF, TRIAL_LINE, priceInWords } from '@/lib/pricing';
import { comingSoonSentence } from '@/components/site-links';

const DESCRIPTION = `KitStak CRM is ${priceInWords('crm')}. Projects is ${priceInWords('projects')}. The WMS is ${priceInWords('wms')}. Pulse is ${priceInWords('pulse')}. Save ${BUNDLE_OFF} with two or more apps. ${TRIAL_LINE}${comingSoonSentence()}`;

export const metadata: Metadata = {
  title: 'KitStak pricing - simple prices for the CRM, the WMS, Projects and Pulse',
  description: DESCRIPTION,
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'KitStak pricing',
    description: 'Simple prices. Pay only for the apps you use.',
    url: 'https://kitstak.com/pricing',
    siteName: 'KitStak',
    type: 'website',
  },
};

/** The questions and answers as structured data, so a search engine can show them as they are written. */
const FAQ_JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: PRICING_FAQ.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  })),
}).replace(/</g, '\\u003c');

export default function PricingPage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <JsonLd data={breadcrumbLd([{ name: 'Pricing', path: '/pricing' }])} />
        <PricingExplorer />
        <BillingRules />
        <Faq items={PRICING_FAQ} title="Questions about price." />
        <ClosingSection />
        {/* Static text built from our own copy above. Nothing a visitor types reaches it. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
      </main>
      <Footer />
    </>
  );
}
