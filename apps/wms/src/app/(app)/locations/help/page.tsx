import type { Metadata } from 'next';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = { title: 'Facility help' };

/** Static help center for facility configuration (REQ-R7-5). Page headers deep-link to these anchors. */
const TOPICS: ReadonlyArray<{ id: string; title: string; href: string; body: readonly string[] }> = [
  {
    id: 'locations',
    title: 'Locations',
    href: '/locations',
    body: [
      'A location is a bin, shelf, floor spot or dock. Its code is built from aisle, rack (bay), level and position; the barcode defaults to the code.',
      'Use Generate locations (More > Generate locations on a phone) to build ranges (for example aisle A-C, rack 01-20, level 1-4). The preview shows the count before anything is written.',
      "Select rows to print labels: pick the template, then Preview, Download or Print. With no KitStak printer set up, Print opens your browser's print dialog. You can also lock or unlock rows for counts, or bulk delete empty locations.",
      'Import > Bulk import / Bulk update locations takes the Excel template; row-level errors are reported per batch.',
      "A location's aisle, rack and level come from its code: A-01-02-1 is aisle A, rack 01, column 02, level 1. Labels print the same.",
      "Location zones (Setup > Location zones) carry a code, a priority and a Max locations per SKU. Put-away sorts by zone priority, won't spread one SKU over more locations of a zone than its limit, and, once a zone is matched to product groups (Match With Product Groups), only accepts those groups.",
    ],
  },
  {
    id: 'warehouses',
    title: 'Warehouses',
    href: '/settings/warehouses',
    body: [
      'Each warehouse holds its address, shifts, units of measure and the default receiving, shipping and return locations.',
      'Tick starter locations on create to get PREFIX-RECV, -SHIP and -RET defaults automatically.',
    ],
  },
  {
    id: 'lp-types',
    title: 'LP types',
    href: '/settings/lp-types',
    body: [
      'An LP type (pallet, tote, cart) defines numbering, dimensions, max weight and mixing rules such as prevent multi-SKU.',
    ],
  },
  {
    id: 'lp-numbers',
    title: 'LP numbers',
    href: '/settings/lp-numbers',
    body: [
      'LP numbers are generated from a type or entered manually; numbers are unique per warehouse. Print labels from the grid selection.',
    ],
  },
  {
    id: 'mobile-carts',
    title: 'Mobile carts',
    href: '/settings/mobile-carts',
    body: [
      "A cart's levels and columns follow its cart type from Data Setup.",
      "Each cell is named by its level letter and column: A01 is level A, column 01. Its barcode is the cart code plus that name, so cell A01 of cart MC-01 scans as MC-01-A01. The cell grid, the cell labels and the job's cart layout all use these names.",
      'Open a cart and use Put on cart to give an open picking job the cart: each order gets the next free cell, A01 first. Empty cart frees the cells.',
    ],
  },
  {
    id: 'shipment-packages',
    title: 'Shipment packages',
    href: '/settings/shipment-packages',
    body: [
      'Boxes, mailers and envelopes used at packing. Choose Auto-create SKU to track packaging inventory, or match an existing SKU.',
    ],
  },
];

export default function Page() {
  return (
    <div className="pb-10">
      <PageHeader
        title="Facility help"
        helper="How locations, warehouses, license plates, carts and packages are set up."
      />
      <nav aria-label="Topics" className="mt-4 flex flex-wrap gap-2 px-6">
        {TOPICS.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className="rounded border border-border px-2 py-1 text-sm hover:bg-muted"
          >
            {t.title}
          </a>
        ))}
      </nav>
      <div className="mt-4 space-y-6 px-6">
        {TOPICS.map((t) => (
          <section key={t.id} id={t.id} className="max-w-[760px] scroll-mt-16">
            <h2 className="text-base font-semibold">{t.title}</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-secondary">
              {t.body.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <a href={t.href} className="mt-1 inline-block text-sm text-[var(--info)] hover:underline">
              Open {t.title}
            </a>
          </section>
        ))}
      </div>
    </div>
  );
}
