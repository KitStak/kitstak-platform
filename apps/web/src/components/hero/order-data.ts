export type StepSource = 'CRM' | 'WMS';

export interface OrderStep {
  readonly source: StepSource;
  readonly label: string;
  readonly detail: string;
}

export interface SampleOrder {
  readonly customer: string;
  readonly number: string;
  readonly steps: readonly OrderStep[];
}

/** Illustrative records for the hero animation. */
export const SAMPLE_ORDERS: readonly SampleOrder[] = [
  {
    customer: 'Northwind Supply',
    number: 'SO-10482',
    steps: [
      { source: 'CRM', label: 'Deal won', detail: 'Spring restock · 3 SKUs' },
      { source: 'WMS', label: 'Order created', detail: 'SO-10482 · 240 units' },
      { source: 'WMS', label: 'Allocated', detail: 'Aisle B · 3 locations' },
      { source: 'WMS', label: 'Picked', detail: 'B-04-2 → B-07-1 → B-11-3' },
      { source: 'WMS', label: 'Packed', detail: '4 cartons · 61 lb' },
      { source: 'CRM', label: 'Shipped', detail: 'Tracking posted to the account' },
    ],
  },
  {
    customer: 'Harbor & Pine',
    number: 'SO-10483',
    steps: [
      { source: 'CRM', label: 'Renewal signed', detail: 'Quarterly kit program' },
      { source: 'WMS', label: 'Work order', detail: 'Build 120 gift kits' },
      { source: 'WMS', label: 'Kitted', detail: '5 components per kit' },
      { source: 'WMS', label: 'Picked', detail: 'C-02-1 → C-02-4' },
      { source: 'WMS', label: 'Packed', detail: '10 cartons · 1 pallet' },
      { source: 'CRM', label: 'Delivered', detail: 'Account updated, invoice queued' },
    ],
  },
  {
    customer: 'Ridgeline Outfitters',
    number: 'RMA-2207',
    steps: [
      { source: 'CRM', label: 'Return requested', detail: 'Case opened by support' },
      { source: 'WMS', label: 'RMA issued', detail: 'RMA-2207 · 6 units' },
      { source: 'WMS', label: 'Received', detail: 'Return station · dock 2' },
      { source: 'WMS', label: 'Inspected', detail: '5 restock · 1 damaged' },
      { source: 'WMS', label: 'Restocked', detail: 'A-09-2 · on hand +5' },
      { source: 'CRM', label: 'Case closed', detail: 'Credit noted on the account' },
    ],
  },
];
