import type { Metadata } from 'next';
import { ClosingSection } from '@/components/closing/closing-section';
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
import { ROUTES, getStartedHref } from '@/components/site-links';
import { BillStatement } from '@/components/wms/bill-statement';
import { FloorTicker } from '@/components/wms/floor-ticker';
import { PackStation } from '@/components/wms/pack-station';
import { RackMap } from '@/components/wms/rack-map';
import { ReturnsKitting } from '@/components/wms/returns-kitting';
import { RfReceive } from '@/components/wms/rf-receive';
import {
  CLIENT_FEATURES,
  CONTROL_TILES,
  FAQ,
  HERO_FACTS,
  INBOUND_FEATURES,
  INTEGRATIONS,
  INVENTORY_FEATURES,
  OUTBOUND_FEATURES,
  PRICE_INCLUDED,
  RETURNS_FEATURES,
  SECTIONS,
} from '@/components/wms/wms-content';

export const metadata: Metadata = {
  title: 'KitStak WMS — warehouse management from the dock to the door',
  description:
    'Receiving, bin-level inventory, wave picking, packing stations, rate shopping, returns, kitting and 3PL client billing in one warehouse management system.',
  alternates: { canonical: '/wms' },
  openGraph: {
    title: 'KitStak WMS',
    description: 'Warehouse management from the dock to the door.',
    url: 'https://kitstak.com/wms',
    siteName: 'KitStak',
    type: 'website',
  },
};

export default function WmsPage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <ProductHero
          product="KitStak WMS"
          lit="wms"
          lines={['Dock.', 'Shelf.', 'Door.']}
          lead="KitStak WMS runs receiving, inventory, picking, packing, shipping and returns. One warehouse or a 3PL floor full of clients, every unit has a location and every location has a count."
          primary={{ href: getStartedHref('wms'), label: 'Start with the WMS' }}
          secondary={{ href: ROUTES.demo, label: 'Book a walkthrough' }}
          visual={<FloorTicker />}
          facts={HERO_FACTS}
        />
        <SubNav current="wms" sections={SECTIONS} cta={{ href: getStartedHref('wms'), label: 'Start with the WMS' }} />

        <Chapter
          id="inbound"
          index="01"
          label="Inbound"
          title="Received right, put away once."
          lead="Check stock in against the purchase order with a scanner, capture the lot and dates as you go, and let putaway rules pick the shelf."
          features={INBOUND_FEATURES}
          visual={<RfReceive />}
        />

        <Chapter
          id="inventory"
          index="02"
          label="Inventory"
          title="The floor, mapped."
          lead="Bin-level inventory you can trust, because counting is part of the daily work and not a weekend project."
          features={INVENTORY_FEATURES}
          visual={<RackMap />}
          tone="sunken"
          isFlipped
        />

        <Chapter
          id="outbound"
          index="03"
          label="Outbound"
          title="From wave to label."
          lead="Orders are allocated by rule, grouped into jobs that make sense to walk, packed at a station and labeled at the best rate you hold."
          features={OUTBOUND_FEATURES}
          visual={<PackStation />}
        />

        <Chapter
          id="returns"
          index="04"
          label="Returns and kitting"
          title="Stock that comes back. Stock you build."
          lead="A return station that decides what happens to every unit, and work orders that turn components into kits you can count."
          features={RETURNS_FEATURES}
          visual={<ReturnsKitting />}
          tone="sunken"
          isFlipped
        />

        <Chapter
          id="clients"
          index="05"
          label="Clients and billing"
          title="Every client. Every charge."
          lead="Built for 3PLs. Run many clients from one floor, keep their stock and users apart, and bill each one from what the warehouse did for them this month."
          features={CLIENT_FEATURES}
          visual={<BillStatement />}
          tone="brand"
        />

        <Chapter
          id="control"
          index="06"
          label="Control"
          title="Rules you can test. Records you can trust."
          lead="Automate the decisions your leads make every morning, try a rule against a real order before it goes live, and see who changed what."
        >
          <TileGrid tiles={CONTROL_TILES} />
        </Chapter>

        <Chapter
          id="integrations"
          index="07"
          label="Integrations"
          title="Orders in. Labels out."
          lead="Connect the stores you sell through and the carrier accounts you already hold. Channel health monitoring shows what synced, what did not, and lets you retry."
          tone="sunken"
        >
          <IntegrationWall groups={INTEGRATIONS} />
        </Chapter>

        <BundleBand
          from="wms"
          title="Put the warehouse on the account."
          body="Add KitStak CRM and your sales team sees what the floor sees. The customer you ship for is the same record they sell to."
          points={[
            'On-hand units and open shipment orders on the CRM account page',
            'One customer list shared by both apps, never re-keyed',
            'One sign-in, one launcher, one bill',
          ]}
          visual={<AccountLink />}
        />

        <PriceBand product="wms" included={PRICE_INCLUDED} />
        <Faq items={FAQ} />
        <FounderBand
          title="Walk the floor with the founder."
          body="Twenty minutes on a call, your warehouse, no slides. Bring your layout and your worst day, and leave with a setup plan."
        />
        <ClosingSection
          title="Know where every unit is."
          startHref={getStartedHref('wms')}
          startLabel="Start with the WMS"
        />
      </main>
      <Footer />
    </>
  );
}
