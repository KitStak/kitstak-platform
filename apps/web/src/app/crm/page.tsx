import type { Metadata } from 'next';
import { ClosingSection } from '@/components/closing/closing-section';
import { BoardMorph } from '@/components/crm/board-morph';
import {
  ADMIN_TILES,
  AUTOMATION_FEATURES,
  BOARD_FEATURES,
  CONNECT,
  DASHBOARD_FEATURES,
  FAQ,
  HERO_FACTS,
  PRICE_INCLUDED,
  SALES_FEATURES,
  SECTIONS,
  START_TILES,
  WORK_FEATURES,
} from '@/components/crm/crm-content';
import { ColumnWall, DashboardMock, PipelineView, UpdateThread } from '@/components/crm/crm-static-visuals';
import { RecipeBuilder } from '@/components/crm/recipe-builder';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { AccountLink } from '@/components/mock/account-link';
import { PageEffects } from '@/components/page-effects';
import { Chapter, TileGrid } from '@/components/product/chapter';
import { BundleBand, Faq, FounderBand } from '@/components/product/cta';
import { IntegrationWall } from '@/components/product/integrations';
import { PriceBand } from '@/components/product/price-band';
import { ProductHero } from '@/components/product/product-hero';
import { SubNav } from '@/components/product/sub-nav';
import { ROUTES, startFreeHref } from '@/components/site-links';

export const metadata: Metadata = {
  title: 'KitStak CRM - pipelines, boards and automations your team shapes',
  description:
    'Leads, deals, accounts and follow-ups on flexible boards with eight views, automations, live dashboards, an inbox and a REST API.',
  alternates: { canonical: '/crm' },
  openGraph: {
    title: 'KitStak CRM',
    description: 'Pipelines, boards and automations your team shapes.',
    url: 'https://kitstak.com/crm',
    siteName: 'KitStak',
    type: 'website',
  },
};

export default function CrmPage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <ProductHero
          product="KitStak CRM"
          app="crm"
          lines={['Track it.', 'Chase it.', 'Close it.']}
          lead="KitStak CRM keeps leads, deals, accounts and follow-ups on boards your team shapes for itself. Automations do the chasing, dashboards do the reporting, and nobody asks where a deal stands."
          primary={{ href: startFreeHref('crm', 'product'), label: 'Start with the CRM' }}
          secondary={{ href: ROUTES.demo, label: 'Book a walkthrough' }}
          visual={<BoardMorph />}
          facts={HERO_FACTS}
        />
        <SubNav current="crm" sections={SECTIONS} cta={{ href: startFreeHref('crm', 'product'), label: 'Start with the CRM' }} />

        <Chapter
          id="boards"
          index="01"
          label="Boards"
          title="Boards that bend to the work."
          lead="A board is a list of items with the columns you choose. Add a status, an owner, a value and a date and you have a pipeline. Change the columns and it is something else."
          features={BOARD_FEATURES}
          visual={<ColumnWall />}
        />

        <Chapter
          id="sales"
          index="02"
          label="Sales"
          title="A pipeline you can read at a glance."
          lead="The CRM suite gives sales its own pages on top of the boards: a pipeline with a forecast, a page for every account, and a clean path from lead to deal."
          features={SALES_FEATURES}
          visual={<PipelineView />}
          tone="sunken"
          isFlipped
        />

        <Chapter
          id="automations"
          index="03"
          label="Automations"
          title="Let the board do the chasing."
          lead="Automations read like a sentence. Pick a recipe or write your own, test it against a real item, then switch it on."
          features={AUTOMATION_FEATURES}
          visual={<RecipeBuilder />}
        />

        <Chapter
          id="dashboards"
          index="04"
          label="Dashboards"
          title="The numbers, without the spreadsheet."
          lead="Build the Monday review once. It stays current because it reads straight from the boards."
          features={DASHBOARD_FEATURES}
          visual={<DashboardMock />}
          tone="brand"
          isFlipped
        />

        <Chapter
          id="work"
          index="05"
          label="Inbox and My Work"
          title="Nothing falls through."
          lead="The conversation lives on the item, and everything that needs you finds you in one place."
          features={WORK_FEATURES}
          visual={<UpdateThread />}
        />

        <Chapter
          id="start"
          index="06"
          label="Templates and import"
          title="Running by this afternoon."
          lead="Start from a template or from the spreadsheet you already have."
          tone="sunken"
        >
          <TileGrid tiles={START_TILES} columns={4} />
        </Chapter>

        <Chapter
          id="admin"
          index="07"
          label="Admin and API"
          title="Open where it should be. Locked where it must be."
          lead="Decide who sees what, keep a record of it, and connect the CRM to the rest of your tools."
        >
          <TileGrid tiles={ADMIN_TILES} />
          <IntegrationWall groups={CONNECT} />
        </Chapter>

        <BundleBand
          from="crm"
          title="See the warehouse from the account."
          body="Add KitStak WMS and an account stops being just a relationship. Link it to the customer your warehouse ships for and the stock is right there."
          points={[
            'On-hand units and open shipment orders on the account page',
            'One customer list shared by both apps, never re-keyed',
            'One sign-in, one launcher, one bill',
            'With Pulse, a won deal shows the profit on the jobs made from it',
          ]}
          visual={<AccountLink />}
        />

        <PriceBand product="crm" included={PRICE_INCLUDED} />
        <Faq items={FAQ} />
        <FounderBand />
        <ClosingSection
          title="Know where every deal stands."
          startHref={startFreeHref('crm', 'product')}
          startLabel="Start with the CRM"
        />
      </main>
      <Footer />
    </>
  );
}
