import type { Metadata } from 'next';
import { ClosingSection } from '@/components/closing/closing-section';
import {
  ATTENDANCE_FEATURES,
  CHAPTERS,
  CLOCK_FEATURES,
  CLOSING,
  FAQ,
  FAQ_TITLE,
  HERO,
  HERO_FACTS,
  META,
  PEOPLE_FEATURES,
  PLANNING_FEATURES,
  PRICE_INCLUDED,
  PROBLEM_TILES,
  SECTIONS,
  SHIFT_FEATURES,
  SKILL_FEATURES,
  STACK_FEATURES,
} from '@/components/crew/crew-content';
import { LaborPlanCard } from '@/components/crew/labor-plan-card';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { JsonLd } from '@/components/json-ld';
import { PageEffects } from '@/components/page-effects';
import { Chapter, TileGrid } from '@/components/product/chapter';
import { Faq } from '@/components/product/cta';
import { PriceBand } from '@/components/product/price-band';
import { ProductHero } from '@/components/product/product-hero';
import { AppShot } from '@/components/product/app-shot';
import type { AppShotSlot } from '@/components/product/app-shot';
import { CREW_SHOTS } from '@/components/crew/crew-shots';
import { SubNav } from '@/components/product/sub-nav';
import { LINKS, ROUTES, availabilityLabel, isAppLive, startLink } from '@/components/site-links';
import { breadcrumbLd, softwareApplicationLd } from '@/lib/seo';

/**
 * Before launch the main action asks to be told when Crew opens ("Tell me when it's ready"). Once
 * CREW_IS_LIVE is on, it starts a trial with Crew switched on and the second button signs in.
 */
const IS_LIVE = isAppLive('crew');
const PRIMARY = startLink('crew');
const SECONDARY = IS_LIVE
  ? { href: LINKS.crew, label: 'Sign in' }
  : { href: `#${CHAPTERS.people.id}`, label: HERO.howLabel };

export const metadata: Metadata = {
  title: META.title,
  description: META.description,
  alternates: { canonical: ROUTES.crew },
  openGraph: {
    title: META.socialTitle,
    description: META.socialDescription,
    url: META.url,
    siteName: 'KitStak',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: META.socialTitle, description: META.socialDescription },
};

/** Each picture is a screenshot slot: a placeholder until its file is filled in (crew-shots.ts). */
const shot = (slot: AppShotSlot, onBrand = false) => (
  <AppShot app="crew" product={HERO.product} slot={slot} onBrand={onBrand} />
);

export default function CrewPage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <JsonLd data={[softwareApplicationLd('crew'), breadcrumbLd([{ name: 'KitStak Crew', path: ROUTES.crew }])]} />
        <ProductHero
          product={HERO.product}
          app="crew"
          lines={HERO.lines}
          lead={HERO.lead}
          primary={PRIMARY}
          secondary={SECONDARY}
          visual={shot(CREW_SHOTS.hero)}
          badge={availabilityLabel('crew') ?? undefined}
          layout="stacked"
          facts={HERO_FACTS}
          phoneFacts={2}
        />
        <SubNav current="crew" sections={SECTIONS} cta={PRIMARY} />

        <Chapter {...CHAPTERS.problem}>
          <TileGrid tiles={PROBLEM_TILES} />
        </Chapter>

        <Chapter
          {...CHAPTERS.people}
          features={PEOPLE_FEATURES}
          visual={shot(CREW_SHOTS.people)}
          tone="sunken"
        />

        <Chapter
          {...CHAPTERS.shifts}
          features={SHIFT_FEATURES}
          visual={shot(CREW_SHOTS.shifts)}
          isStacked
        />

        <Chapter
          {...CHAPTERS.clock}
          features={CLOCK_FEATURES}
          visual={shot(CREW_SHOTS.kiosk)}
          tone="sunken"
          isFlipped
        />

        <Chapter
          {...CHAPTERS.attendance}
          features={ATTENDANCE_FEATURES}
          visual={shot(CREW_SHOTS.attendance)}
        />

        <Chapter
          {...CHAPTERS.skills}
          features={SKILL_FEATURES}
          visual={shot(CREW_SHOTS.skills)}
          tone="sunken"
          isFlipped
        />

        <Chapter {...CHAPTERS.planning} features={PLANNING_FEATURES} visual={<LaborPlanCard />} />

        <Chapter
          {...CHAPTERS.stack}
          features={STACK_FEATURES}
          visual={shot(CREW_SHOTS.stack, true)}
          tone="brand"
        />

        <PriceBand product="crew" included={PRICE_INCLUDED} />
        <Faq items={FAQ} title={FAQ_TITLE} />
        <ClosingSection title={CLOSING.title} startHref={PRIMARY.href} startLabel={PRIMARY.label} note={CLOSING.note} />
      </main>
      <Footer />
    </>
  );
}
