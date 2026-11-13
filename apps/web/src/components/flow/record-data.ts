export interface RecordField {
  readonly label: string;
  readonly crm?: string;
  readonly wms?: string;
}

export interface SampleRecord {
  readonly name: string;
  readonly fields: readonly RecordField[];
}

/** Fields with both `crm` and `wms` are the shared core record; the rest belong to one app. */
export const SAMPLE_RECORDS: readonly SampleRecord[] = [
  {
    name: 'Northwind Supply',
    fields: [
      { label: 'Customer', crm: 'Northwind Supply', wms: 'Northwind Supply' },
      { label: 'Stage', crm: 'Closed won' },
      { label: 'Ship-to', crm: 'Columbus, OH', wms: 'Columbus, OH' },
      { label: 'On hand', wms: '4,812 units' },
      { label: 'Items', crm: '3 SKUs quoted', wms: '3 SKUs stocked' },
      { label: 'Open orders', wms: 'SO-10482 · picking' },
      { label: 'Owner', crm: 'Dana R.' },
    ],
  },
  {
    name: 'Harbor & Pine',
    fields: [
      { label: 'Customer', crm: 'Harbor & Pine', wms: 'Harbor & Pine' },
      { label: 'Stage', crm: 'Renewal' },
      { label: 'Ship-to', crm: 'Portland, ME', wms: 'Portland, ME' },
      { label: 'On hand', wms: '1,140 kits' },
      { label: 'Items', crm: 'Gift kit program', wms: '5-part kit BOM' },
      { label: 'Open orders', wms: 'WO-311 · kitting' },
      { label: 'Owner', crm: 'Marcus T.' },
    ],
  },
  {
    name: 'Ridgeline Outfitters',
    fields: [
      { label: 'Customer', crm: 'Ridgeline Outfitters', wms: 'Ridgeline Outfitters' },
      { label: 'Stage', crm: 'Active account' },
      { label: 'Ship-to', crm: 'Boise, ID', wms: 'Boise, ID' },
      { label: 'On hand', wms: '9,306 units' },
      { label: 'Items', crm: '12 SKUs', wms: '12 SKUs · 4 lots' },
      { label: 'Open orders', wms: 'RMA-2207 · restocked' },
      { label: 'Owner', crm: 'Priya S.' },
    ],
  },
];
