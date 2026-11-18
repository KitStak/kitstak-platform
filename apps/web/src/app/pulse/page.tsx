import type { Metadata } from 'next';
import { ClosingSection } from '@/components/closing/closing-section';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { PageEffects } from '@/components/page-effects';
import { Chapter, TileGrid } from '@/components/product/chapter';
import { Faq } from '@/components/product/cta';
import { PriceBand } from '@/components/product/price-band';
import { ProductHero } from '@/components/product/product-hero';
import { SubNav } from '@/components/product/sub-nav';
import {
  ANSWER_FEATURES,
  CHAPTERS,
  CLOSING,
  COST_FEATURES,
  CSV_FEATURES,
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
} from '@/components/pulse/pulse-content';
import { PulseBundleSection } from '@/components/pulse/pulse-section-bundle';
import { ExplainVisual, JobMathVisual } from '@/components/pulse/pulse-section-math';
import {
  CostRatesVisual,
  CsvVisual,
  DailyEntryVisual,
  PlanVsActualVisual,
  ProfitByJobVisual,
  PulseHeroVisual,
  PulseStackVisual,
  RiskVisual,
} from '@/components/pulse/pulse-visuals';
import { PULSE_IS_LIVE, ROUTES, getStartedHref } from '@/components/site-links';

/**
 * The main action. "Start with Pulse" only once the app is open to customers. Until then the page
 * leads with a walkthrough, and the second button jumps to the worked job.
 */
const PRIMARY = PULSE_IS_LIVE
  ? { href: getStartedHref('pulse'), label: HERO.startLabel }
  : { href: ROUTES.demo, label: HERO.walkthroughLabel };
const SECONDARY = PULSE_IS_LIVE
  ? { href: ROUTES.demo, label: HERO.walkthroughLabel }
  : { href: `#${CHAPTERS.answer.id}`, label: HERO.mathLabel };

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

/*
 * The screenshot chapters are stacked: copy on top, then the real screen across the page, so it can be
 * read. The rate builder is a narrow dialog, so that chapter keeps the picture beside the copy.
 */
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
          primary={PRIMARY}
          secondary={SECONDARY}
          visual={<PulseHeroVisual />}
          layout="stacked"
          facts={HERO_FACTS}
        />
        <SubNav current="pulse" sections={SECTIONS} cta={PRIMARY} />

        <Chapter {...CHAPTERS.problem}>
          <TileGrid tiles={PROBLEM_TILES} />
        </Chapter>

        <Chapter {...CHAPTERS.answer} features={ANSWER_FEATURES} visual={<JobMathVisual />} tone="sunken" />

        <Chapter {...CHAPTERS.profit} features={PROFIT_FEATURES} visual={<ProfitByJobVisual />} isStacked />

        {/* The one thing a spreadsheet cannot do comes straight after the first profit screens. */}
        <Chapter
          {...CHAPTERS.risk}
          features={RISK_FEATURES}
          visual={<RiskVisual />}
          tone="brand"
          isStacked
        />

        <Chapter
          {...CHAPTERS.proof}
          features={PROOF_FEATURES}
          visual={<ExplainVisual />}
          tone="sunken"
          isFlipped
        />

        <Chapter {...CHAPTERS.log} features={LOG_FEATURES} visual={<DailyEntryVisual />} isStacked />

        <Chapter
          {...CHAPTERS.plan}
          features={PLAN_FEATURES}
          visual={<PlanVsActualVisual />}
          tone="sunken"
          isStacked
        />

        <Chapter {...CHAPTERS.costs} features={COST_FEATURES} visual={<CostRatesVisual />} />

        <Chapter {...CHAPTERS.csv} features={CSV_FEATURES} visual={<CsvVisual />} tone="sunken" isStacked />

        {/* The links to the other apps live in the bundle band, the way the sibling pages sell the stack. */}
        <PulseBundleSection visual={<PulseStackVisual />} />

        <PriceBand product="pulse" included={PRICE_INCLUDED} />
        <Faq items={FAQ} title={FAQ_TITLE} />
        <ClosingSection
          title={CLOSING.title}
          startHref={PRIMARY.href}
          startLabel={PRIMARY.label}
          note={CLOSING.note}
        />
      </main>
      <Footer />
    </>
  );
}
