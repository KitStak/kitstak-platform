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
import { ShotPlaceholder } from '@/components/product/shot-placeholder';
import { SubNav } from '@/components/product/sub-nav';
import { NOTIFY_LABEL, ROUTES, availabilityLabel, notifyHref } from '@/components/site-links';
import { breadcrumbLd, plannedApplicationLd } from '@/lib/seo';

/** Ledger cannot be bought yet, so the main action asks to be told when it can. */
const PRIMARY = { href: notifyHref('ledger'), label: NOTIFY_LABEL };
const SECONDARY = { href: `#${CHAPTERS.invoices.id}`, label: HERO.howLabel };

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

/** Every picture is a placeholder until the Ledger app exists (docs/ledger/REFERENCE.md). */
const shot = (screen: string, note: string, extra?: { rows?: number; shape?: 'wide' | 'narrow'; onBrand?: boolean }) => (
  <ShotPlaceholder app="ledger" product={HERO.product} screen={screen} note={note} {...extra} />
);

export default function LedgerPage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <JsonLd data={[plannedApplicationLd('ledger'), breadcrumbLd([{ name: 'KitStak Ledger', path: ROUTES.ledger }])]} />
        <ProductHero
          product={HERO.product}
          app="ledger"
          lines={HERO.lines}
          lead={HERO.lead}
          primary={PRIMARY}
          secondary={SECONDARY}
          visual={shot('Money home', 'What you are owed, what is due, and how close the month is.', { rows: 7 })}
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
          visual={shot('Draft invoice', 'A month of WMS bill lines for one client, ready to send.', { rows: 6 })}
          tone="sunken"
          isStacked
        />

        <Chapter
          {...CHAPTERS.collections}
          features={COLLECTION_FEATURES}
          visual={shot('Aging', 'Open invoices by customer and bucket.')}
        />

        <Chapter
          {...CHAPTERS.bills}
          features={BILL_FEATURES}
          visual={shot('Bills', 'Vendor bills waiting for approval and payment.')}
          tone="sunken"
          isFlipped
        />

        <Chapter
          {...CHAPTERS.expenses}
          features={EXPENSE_FEATURES}
          visual={shot('Expense', 'A receipt photo tagged to a job.', { shape: 'narrow', rows: 4 })}
        />

        <Chapter
          {...CHAPTERS.bank}
          features={BANK_FEATURES}
          visual={shot('Reconcile', 'Bank lines matched to invoices and bills.', { rows: 6 })}
          tone="sunken"
          isStacked
        />

        <Chapter
          {...CHAPTERS.close}
          features={CLOSE_FEATURES}
          visual={shot('Close the month', 'The checklist, the accruals and the lock.')}
          isFlipped
        />

        <Chapter
          {...CHAPTERS.stack}
          features={STACK_FEATURES}
          visual={shot('Earned vs billed', 'Pulse’s earned revenue beside what was billed and collected.', { onBrand: true })}
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
