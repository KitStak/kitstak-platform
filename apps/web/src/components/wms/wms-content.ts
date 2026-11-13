/**
 * Copy for the /wms product page. Every capability named here exists in apps/wms today; keep it
 * that way when editing (no roadmap items, no integrations that are not built).
 */
import type { Feature } from '../product/chapter';
import type { FaqItem } from '../product/cta';
import type { IntegrationGroup } from '../product/integrations';
import type { HeroFact } from '../product/product-hero';
import type { SubNavSection } from '../product/sub-nav';

export const SALES_CHANNELS: readonly string[] = [
  'Shopify',
  'Amazon',
  'Walmart',
  'eBay',
  'TikTok Shop',
  'Etsy',
  'WooCommerce',
  'BigCommerce',
  'Magento',
  'ShipStation',
];

export const CARRIERS: readonly string[] = [
  'UPS',
  'FedEx',
  'USPS via Stamps.com',
  'EasyPost',
  'Shippo',
  'ShipStation',
  'Custom carrier',
];

export const SECTIONS: readonly SubNavSection[] = [
  { id: 'inbound', label: 'Inbound' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'outbound', label: 'Outbound' },
  { id: 'returns', label: 'Returns' },
  { id: 'clients', label: 'Clients' },
  { id: 'control', label: 'Control' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'faq', label: 'FAQ' },
];

export const HERO_FACTS: readonly HeroFact[] = [
  { value: String(SALES_CHANNELS.length), label: 'sales channels connected' },
  { value: String(CARRIERS.length), label: 'carrier connections' },
  { value: '4', label: 'ways to pack an order' },
  { value: '4', label: 'kinds of count' },
  { value: '29', label: 'bulk importers' },
];

export const INBOUND_FEATURES: readonly Feature[] = [
  { name: 'Purchase orders', note: 'Receive line by line or in bulk, with documents attached to the PO.' },
  { name: 'Scan-first receiving', note: 'Scan the PO, the item and the location on a handheld, in the browser.' },
  { name: 'Lots, dates and serials', note: 'Capture lot, expiry, production date and serial numbers at the dock.' },
  { name: 'Directed putaway', note: 'Putaway rules suggest a location. Confirm one at a time or in bulk.' },
  { name: 'License plates', note: 'Receive onto a license plate, then move or transfer it as one.' },
  { name: 'Receiving history', note: 'Every receipt, who took it in, and what was short.' },
];

export const INVENTORY_FEATURES: readonly Feature[] = [
  { name: 'Locations and zones', note: 'Generate a rack layout, print the labels, lock a bin when you need to.' },
  { name: 'Four kinds of count', note: 'Cycle, blind, instant and SKU counts, with recounts and variance.' },
  { name: 'Lot and expiry control', note: 'Allocate first-expired, first-in or last-in, per your rules.' },
  { name: 'Transfers', note: 'Move by location, by license plate or by product.' },
  { name: 'Replenishment', note: 'Tasks raised from minimum levels before a pick face runs dry.' },
  { name: 'Available to promise', note: 'What you can sell right now, not just what is on the shelf.' },
  { name: 'Snapshots and aging', note: 'A daily inventory snapshot and a report of what is not moving.' },
];

export const OUTBOUND_FEATURES: readonly Feature[] = [
  { name: 'Allocation rules', note: 'Decide which stock serves which order, and dry-run a rule before using it.' },
  { name: 'Wave rules', note: 'Release work on a schedule, with a log of every wave.' },
  {
    name: 'Jobs built to be walked',
    note: 'Single-item batches, identical-order batches and pick-and-pack jobs, with stops ordered by walking distance.',
  },
  { name: 'Mobile carts', note: 'Pick many orders in one trip into totes on a cart.' },
  { name: 'Packing stations', note: 'Pack by tote, by location, by order, or sort through a putwall.' },
  { name: 'Rate shopping', note: 'Cheapest, fastest, or the cheapest that still arrives on time.' },
  { name: 'End of the day', note: 'Close out manifests and schedule the carrier pickup.' },
  { name: 'Hospital locations', note: 'Short picks and problem stock go somewhere visible, not missing.' },
];

export const RETURNS_FEATURES: readonly Feature[] = [
  { name: 'Return station', note: 'Find the return by RMA, order or tracking number and scan it in.' },
  { name: 'Dispositions', note: 'Restock, damaged, quarantine or dispose, decided unit by unit.' },
  { name: 'Return rules and labels', note: 'Create RMAs by hand or by rule, and issue the return label.' },
  { name: 'Work orders', note: 'Build kits from components with a pick list, or take them apart again.' },
  { name: 'Kit inventory', note: 'See finished kits and how many more the components on hand can make.' },
];

export const CLIENT_FEATURES: readonly Feature[] = [
  { name: 'Clients', note: 'Each client has its own products, stock and orders on a shared floor.' },
  { name: 'Client sign-ins', note: 'Client users sign in and see only their own data.' },
  {
    name: 'Billing for the work done',
    note: 'Receiving, storage, pick and pack, shipments, returns, work orders and value-added services.',
  },
  { name: 'Storage, your way', note: 'Bill storage by daily, peak or average quantity, with split months.' },
  { name: 'Tiers and minimums', note: 'Graduated tiers, charge-if conditions, and a minimum or maximum per bill.' },
  { name: 'Bills with approval', note: 'Billing periods run on a schedule and bills wait for sign-off.' },
];

export const CONTROL_TILES: readonly Feature[] = [
  { name: 'Workflows', note: 'When an order matches, block it, set the carrier service, add a tag or notify someone.' },
  { name: 'Test against an order', note: 'Run a workflow or allocation rule against real data. Nothing is saved.' },
  { name: 'Roles and restrictions', note: 'Permission groups by job, including hiding carrier cost from a role.' },
  { name: 'Audit and change logs', note: 'Field-level history on records, and an audit log of who did what.' },
  { name: 'Reports', note: 'Shortage, aging, location utilization, serial history and more, to Excel or CSV.' },
  { name: 'Scheduled reports', note: 'Send a report by email every day or every week.' },
  { name: 'Labor analytics', note: 'Tasks per associate, receiving performance and productivity dashboards.' },
  { name: 'Single sign-on', note: 'OpenID Connect and SAML for teams that need it.' },
  { name: 'Direct printing', note: 'A small print agent sends labels straight to your network printers.' },
];

export const INTEGRATIONS: readonly IntegrationGroup[] = [
  {
    title: 'Sales channels',
    note: 'Orders come in, shipments and inventory go back, with a health view per channel.',
    names: SALES_CHANNELS,
  },
  {
    title: 'Carriers',
    note: 'Print labels and shop rates on your own carrier accounts.',
    names: CARRIERS,
  },
];

export const PRICE_INCLUDED: readonly string[] = [
  'Every warehouse feature on this page',
  'Your whole floor team',
  'All channel and carrier connections',
  '3PL clients and billing',
  'Reports, analytics and exports',
  'The KitStak portal and one sign-in',
];

export const FAQ: readonly FaqItem[] = [
  {
    question: 'Do we need special hardware?',
    answer:
      'No. The WMS runs in a browser, including the scanning screens for receiving, counting and picking. Use a handheld scanner with a browser, or a tablet with a Bluetooth scanner. Label printing works through a small print agent on your network.',
  },
  {
    question: 'Is there a mobile app?',
    answer:
      'There is no app to install. The scan flows are web pages built for handheld screens, so a new device is ready as soon as someone signs in.',
  },
  {
    question: 'Can we bring our existing data?',
    answer:
      'Yes. There are 29 bulk importers, covering products, purchase orders, returns and more, so you can load a spreadsheet instead of typing it in.',
  },
  {
    question: 'Do carrier rates and labels use our accounts?',
    answer:
      'Yes. You connect your own carrier accounts, and rates and labels come from them. Until you connect one, the system runs against a built-in simulation so you can train the team first.',
  },
  {
    question: 'Does it work for a single brand, not a 3PL?',
    answer:
      'Yes. Run it with one client and ignore the billing side. Everything from receiving to returns works the same way.',
  },
  {
    question: 'Can I use the WMS without the CRM?',
    answer:
      'Yes. Each product is licensed on its own. Add the CRM later and your customers are already there, because both apps share one customer list.',
  },
];
