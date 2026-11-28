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
import { ShotPlaceholder } from '@/components/product/shot-placeholder';
import { SubNav } from '@/components/product/sub-nav';
import { NOTIFY_LABEL, ROUTES, availabilityLabel, notifyHref } from '@/components/site-links';
import { breadcrumbLd, plannedApplicationLd } from '@/lib/seo';

/** Crew cannot be bought yet, so the main action asks to be told when it can. */
const PRIMARY = { href: notifyHref('crew'), label: NOTIFY_LABEL };
const SECONDARY = { href: `#${CHAPTERS.people.id}`, label: HERO.howLabel };

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

/** Every picture is a placeholder until the Crew app exists (docs/crew/REFERENCE.md). */
const shot = (screen: string, note: string, extra?: { rows?: number; shape?: 'wide' | 'narrow'; onBrand?: boolean }) => (
  <ShotPlaceholder app="crew" product={HERO.product} screen={screen} note={note} {...extra} />
);

export default function CrewPage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <JsonLd data={[plannedApplicationLd('crew'), breadcrumbLd([{ name: 'KitStak Crew', path: ROUTES.crew }])]} />
        <ProductHero
          product={HERO.product}
          app="crew"
          lines={HERO.lines}
          lead={HERO.lead}
          primary={PRIMARY}
          secondary={SECONDARY}
          visual={shot('Weekly schedule', 'The week by site and area, with open shifts to fill.', { rows: 7 })}
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
          visual={shot('People', 'Everyone on the floor, with site, labor class and agency.')}
          tone="sunken"
        />

        <Chapter
          {...CHAPTERS.shifts}
          features={SHIFT_FEATURES}
          visual={shot('Schedule', 'Shift templates laid out across the week.', { rows: 6 })}
          isStacked
        />

        <Chapter
          {...CHAPTERS.clock}
          features={CLOCK_FEATURES}
          visual={shot('Kiosk', 'Big targets for a badge or a PIN at the door.', { shape: 'narrow', rows: 4 })}
          tone="sunken"
          isFlipped
        />

        <Chapter
          {...CHAPTERS.attendance}
          features={ATTENDANCE_FEATURES}
          visual={shot('Who is here', 'Today’s board of who is on site, late or out.')}
        />

        <Chapter
          {...CHAPTERS.skills}
          features={SKILL_FEATURES}
          visual={shot('Skills', 'Certifications with their expiry dates, by person.')}
          tone="sunken"
          isFlipped
        />

        <Chapter {...CHAPTERS.planning} features={PLANNING_FEATURES} visual={<LaborPlanCard />} />

        <Chapter
          {...CHAPTERS.stack}
          features={STACK_FEATURES}
          visual={shot('Approved hours', 'A week of hours, ready to send to Pulse and payroll.', { onBrand: true })}
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
