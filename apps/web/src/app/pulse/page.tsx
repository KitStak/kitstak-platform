import type { Metadata } from 'next';
import { ClosingSection } from '@/components/closing/closing-section';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { PageEffects } from '@/components/page-effects';
import { Chapter, TileGrid } from '@/components/product/chapter';
import { Faq, FounderBand } from '@/components/product/cta';
import { IntegrationWall } from '@/components/product/integrations';
import { PriceBand } from '@/components/product/price-band';
import { ProductHero } from '@/components/product/product-hero';
import { SubNav } from '@/components/product/sub-nav';
import {
  ANSWER_FEATURES,
  CHAPTERS,
  CLOSING,
  COST_FEATURES,
  CSV_FEATURES,
  CSV_WALL,
  FAQ,
  FAQ_TITLE,
  HERO,
  HERO_FACTS,
  LOG_FEATURES,
  META,
  PLAN_FEATURES,
  PRICE_INCLUDED,
  PROBLEM_TILES,
  PROFIT_FEATURES,
  PROOF_FEATURES,
  RISK_FEATURES,
  SECTIONS,
  STACK_FEATURES,
} from '@/components/pulse/pulse-content';
import { PulseBundleSection } from '@/components/pulse/pulse-section-bundle';
import { BridgeMathVisual, JobMathVisual } from '@/components/pulse/pulse-section-math';
import {
  CostRatesVisual,
  CsvVisual,
  DailyEntryVisual,
  PlanVsActualVisual,
  ProfitByJobVisual,
  PulseBundleVisual,
  PulseHeroVisual,
  PulseStackVisual,
  RiskVisual,
} from '@/components/pulse/pulse-visuals';
import { ROUTES, getStartedHref } from '@/components/site-links';

const START = getStartedHref('pulse');

export const metadata: Metadata = {
  title: META.title,
  description: META.description,
  alternates: { canonical: ROUTES.pulse },
  openGraph: {
    title: META.socialTitle,
    description: META.socialDescription,
    url: META.url,
    siteName: 'KitStak',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: META.socialTitle,
    description: META.socialDescription,
  },
};

/**
 * Structured data that only repeats what is on the page. No price, rating or review fields:
 * pricing is preliminary and there are no reviews to cite.
 */
const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      '@id': `${META.url}#software`,
      name: HERO.product,
      url: META.url,
      description: META.description,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      publisher: { '@type': 'Organization', name: 'KitStak', url: 'https://kitstak.com' },
    },
    {
      '@type': 'FAQPage',
      '@id': `${META.url}#faq`,
      mainEntity: FAQ.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    },
  ],
};

/** JSON for a script tag: `<` is escaped so no string in the copy can close the tag early. */
const STRUCTURED_DATA_JSON = JSON.stringify(STRUCTURED_DATA).replace(/</g, '\\u003c');

export default function PulsePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: STRUCTURED_DATA_JSON }} />
      <PageEffects />
      <Header />
      <main id="main">
        <ProductHero
          product={HERO.product}
          app="pulse"
          lines={HERO.lines}
          lead={HERO.lead}
          primary={{ href: START, label: HERO.primaryLabel }}
          secondary={{ href: ROUTES.demo, label: HERO.secondaryLabel }}
          visual={<PulseHeroVisual />}
          facts={HERO_FACTS}
        />
        <SubNav current="pulse" sections={SECTIONS} cta={{ href: START, label: HERO.primaryLabel }} />

        <Chapter {...CHAPTERS.problem}>
          <TileGrid tiles={PROBLEM_TILES} />
        </Chapter>

        <Chapter {...CHAPTERS.answer} features={ANSWER_FEATURES} visual={<JobMathVisual />} tone="sunken" />

        <Chapter {...CHAPTERS.profit} features={PROFIT_FEATURES} visual={<ProfitByJobVisual />} isFlipped />

        <Chapter {...CHAPTERS.log} features={LOG_FEATURES} visual={<DailyEntryVisual />} tone="sunken" />

        <Chapter {...CHAPTERS.plan} features={PLAN_FEATURES} visual={<PlanVsActualVisual />} isFlipped />

        <Chapter {...CHAPTERS.costs} features={COST_FEATURES} visual={<CostRatesVisual />} tone="sunken" />

        <Chapter {...CHAPTERS.risk} features={RISK_FEATURES} visual={<RiskVisual />} tone="brand" isFlipped />

        <Chapter {...CHAPTERS.csv} features={CSV_FEATURES} visual={<CsvVisual />}>
          <IntegrationWall groups={CSV_WALL} />
        </Chapter>

        <Chapter
          {...CHAPTERS.proof}
          features={PROOF_FEATURES}
          visual={<BridgeMathVisual />}
          tone="sunken"
          isFlipped
        />

        <Chapter {...CHAPTERS.stack} features={STACK_FEATURES} visual={<PulseStackVisual />} />

        <PulseBundleSection visual={<PulseBundleVisual />} />

        <PriceBand product="pulse" included={PRICE_INCLUDED} />
        <Faq items={FAQ} title={FAQ_TITLE} />
        <FounderBand />
        <ClosingSection
          title={CLOSING.title}
          startHref={START}
          startLabel={CLOSING.startLabel}
          note={CLOSING.note}
        />
      </main>
      <Footer />
    </>
  );
}
