import type { Metadata } from 'next';
import { ClosingSection } from '@/components/closing/closing-section';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { JsonLd } from '@/components/json-ld';
import {
  BANK_FEATURES,
  BILL_FEATURES,
  CHAPTERS,
  CLOSE_FEATURES,
  CLOSING,
  COLLECTION_FEATURES,
  EXPENSE_FEATURES,
  FAQ,
  FAQ_TITLE,
  HERO,
  HERO_FACTS,
  INVOICE_FEATURES,
  META,
  PRICE_INCLUDED,
  PROBLEM_TILES,
  SECTIONS,
  STACK_FEATURES,
} from '@/components/ledger/ledger-content';
import { PageEffects } from '@/components/page-effects';
import { Chapter, TileGrid } from '@/components/product/chapter';
import { Faq } from '@/components/product/cta';
import { PriceBand } from '@/components/product/price-band';
import { ProductHero } from '@/components/product/product-hero';
import { AppShot } from '@/components/product/app-shot';
import type { AppShotSlot } from '@/components/product/app-shot';
import { LEDGER_SHOTS } from '@/components/ledger/ledger-shots';
import { SubNav } from '@/components/product/sub-nav';
import { LINKS, ROUTES, availabilityLabel, isAppLive, startLink } from '@/components/site-links';
import { breadcrumbLd, softwareApplicationLd } from '@/lib/seo';

/**
 * Before launch the main action asks to be told when Ledger opens ("Tell me when it's ready"). Once
 * LEDGER_IS_LIVE is on, it starts a trial with Ledger switched on and the second button signs in.
 */
const IS_LIVE = isAppLive('ledger');
const PRIMARY = startLink('ledger');
const SECONDARY = IS_LIVE
  ? { href: LINKS.ledger, label: 'Sign in' }
  : { href: `#${CHAPTERS.invoices.id}`, label: HERO.howLabel };

export const metadata: Metadata = {
  title: META.title,
  description: META.description,
  alternates: { canonical: ROUTES.ledger },
  openGraph: {
    title: META.socialTitle,
    description: META.socialDescription,
    url: META.url,
    siteName: 'KitStak',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: META.socialTitle, description: META.socialDescription },
};

/** Each picture is a screenshot slot: a placeholder until its file is filled in (ledger-shots.ts). */
const shot = (slot: AppShotSlot, onBrand = false) => (
  <AppShot app="ledger" product={HERO.product} slot={slot} onBrand={onBrand} />
);

export default function LedgerPage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <JsonLd data={[softwareApplicationLd('ledger'), breadcrumbLd([{ name: 'KitStak Ledger', path: ROUTES.ledger }])]} />
        <ProductHero
          product={HERO.product}
          app="ledger"
          lines={HERO.lines}
          lead={HERO.lead}
          primary={PRIMARY}
          secondary={SECONDARY}
          visual={shot(LEDGER_SHOTS.hero)}
          badge={availabilityLabel('ledger') ?? undefined}
          layout="stacked"
          facts={HERO_FACTS}
          phoneFacts={2}
        />
        <SubNav current="ledger" sections={SECTIONS} cta={PRIMARY} />

        <Chapter {...CHAPTERS.problem}>
          <TileGrid tiles={PROBLEM_TILES} />
        </Chapter>

        <Chapter
          {...CHAPTERS.invoices}
          features={INVOICE_FEATURES}
          visual={shot(LEDGER_SHOTS.invoices)}
          tone="sunken"
          isStacked
        />

        <Chapter
          {...CHAPTERS.collections}
          features={COLLECTION_FEATURES}
          visual={shot(LEDGER_SHOTS.collections)}
        />

        <Chapter
          {...CHAPTERS.bills}
          features={BILL_FEATURES}
          visual={shot(LEDGER_SHOTS.bills)}
          tone="sunken"
          isFlipped
        />

        <Chapter
          {...CHAPTERS.expenses}
          features={EXPENSE_FEATURES}
          visual={shot(LEDGER_SHOTS.expenses)}
        />

        <Chapter
          {...CHAPTERS.bank}
          features={BANK_FEATURES}
          visual={shot(LEDGER_SHOTS.bank)}
          tone="sunken"
          isStacked
        />

        <Chapter
          {...CHAPTERS.close}
          features={CLOSE_FEATURES}
          visual={shot(LEDGER_SHOTS.close)}
          isFlipped
        />

        <Chapter
          {...CHAPTERS.stack}
          features={STACK_FEATURES}
          visual={shot(LEDGER_SHOTS.stack, true)}
          tone="brand"
        />

        <PriceBand product="ledger" included={PRICE_INCLUDED} />
        <Faq items={FAQ} title={FAQ_TITLE} />
        <ClosingSection title={CLOSING.title} startHref={PRIMARY.href} startLabel={PRIMARY.label} note={CLOSING.note} />
      </main>
      <Footer />
    </>
  );
}
