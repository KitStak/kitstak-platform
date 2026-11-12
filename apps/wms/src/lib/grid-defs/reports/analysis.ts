/**
 * Analysis report grids (M13 round 6): Inventory Aging and Location Utilization.
 * PURE TS: the bucket / band helpers are shared by the SQL builder and unit tests so the
 * grid, the export and the tests agree on one definition.
 */
import { AREA_TYPES, INVENTORY_STATUSES } from '@/lib/enums';
import { CLIENT_FIELD, WAREHOUSE_FIELD, bool, col, enumOf, num, text, type ReportDef } from './types';

/* ------------------------------------------------------------------ aging */

/** Upper bound (inclusive, days) of each aging bucket; the last bucket is open-ended. */
export const AGING_BUCKETS = [
  { label: '0-30 Days', max: 30 },
  { label: '31-60 Days', max: 60 },
  { label: '61-90 Days', max: 90 },
  { label: '91-180 Days', max: 180 },
  { label: '181-365 Days', max: 365 },
  { label: 'Over 365 Days', max: Number.POSITIVE_INFINITY },
] as const;

export const AGING_BUCKET_LABELS: readonly string[] = AGING_BUCKETS.map((b) => b.label);

/** Whole days between the received date and `now` (never negative). */
export function ageInDays(receivedAt: string, now: Date = new Date()): number {
  const t = Date.parse(receivedAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(Math.floor((now.getTime() - t) / 86_400_000), 0);
}

export function agingBucketOf(days: number): string {
  const b = AGING_BUCKETS.find((x) => days <= x.max);
  return (b ?? AGING_BUCKETS[AGING_BUCKETS.length - 1]!).label;
}

export const AGING_TIP =
  "Days since the bucket was received (inventory received date), in the warehouse's calendar.";

export const AGING_DEF: ReportDef = {
  gridKey: 'report-inventory-aging',
  title: 'Inventory Aging Report',
  path: '/api/reports/inventory-aging',
  permission: 'inventory.total_inventory.view',
  helper:
    'How long on-hand stock has been sitting, per inventory bucket. Use it to find slow movers, expiring lots and storage that is costing money.',
  fields: [
    CLIENT_FIELD,
    enumOf('agingBucket', 'Aging Bucket', AGING_BUCKET_LABELS),
    num('ageDays', 'Age (Days)'),
    text('sku', 'SKU'),
    text('location', 'Location'),
    text('lotNumber', 'Lot Batch Number'),
    enumOf('status', 'Inventory Status', INVENTORY_STATUSES),
    WAREHOUSE_FIELD,
  ],
  columns: [
    col('sku', 'SKU', { width: 170, hrefKey: 'productHref', alwaysVisible: true }),
    col('productName', 'Product Name', { width: 240 }),
    col('ageDays', 'Age (Days)', { kind: 'strong', width: 110, tip: AGING_TIP, exportType: 'integer' }),
    col('agingBucket', 'Aging Bucket', { width: 140 }),
    col('onHand', 'On Hand', { kind: 'number', width: 100 }),
    col('client', 'Client', { width: 200 }),
    col('location', 'Location', { width: 130, hrefKey: 'locationHref' }),
    col('lpNumber', 'LP Number', { width: 120 }),
    col('lotNumber', 'Lot Batch Number', { width: 140 }),
    col('expiryDate', 'Expiry Date', { kind: 'date', width: 120 }),
    col('receivedAt', 'Received Date', { kind: 'datetime', width: 172 }),
    col('status', 'Inventory Status', { kind: 'pill', width: 130 }),
    col('warehouse', 'Warehouse', { width: 190 }),
  ],
  search: ['sku'],
  searchPlaceholder: 'Search by SKU',
  defaultSort: ['-ageDays', 'sku'],
  rowKey: 'rowId',
};

/* ------------------------------------------------------------ utilization */

export const UTILIZATION_BANDS = [
  'Empty',
  'Low',
  'Healthy',
  'Near Full',
  'Over Capacity',
  'No Capacity Set',
] as const;
export type UtilizationBand = (typeof UTILIZATION_BANDS)[number];

/** Percent of capacity used (1 decimal); null when the location has no capacity. */
export function utilizationPct(used: number, capacity: number): number | null {
  if (!(capacity > 0)) return null;
  return Math.round((used * 1000) / capacity) / 10;
}

export function utilizationBand(used: number, capacity: number): UtilizationBand {
  const pct = utilizationPct(used, capacity);
  if (pct === null) return used > 0 ? 'No Capacity Set' : 'Empty';
  if (used <= 0) return 'Empty';
  if (used > capacity) return 'Over Capacity';
  if (pct >= 85) return 'Near Full';
  if (pct >= 25) return 'Healthy';
  return 'Low';
}

export const UTILIZATION_TIP =
  "How full the location is. With Max Capacity Qty or Location Product Capacity it is on-hand units ÷ that unit count. Otherwise it is cube: the stored units' product volume (L × W × H) ÷ the location's volume. Legacy capacity units are used only when a location has no volume, and are marked Estimated.";

/** Where a location's capacity number comes from (the Capacity Source column). */
export const CAPACITY_SOURCES = [
  'Max Capacity Qty',
  'Product Max Qty',
  'Cube (volume)',
  'Legacy Capacity Units (estimate)',
  'Not Set',
] as const;
export type CapacitySource = (typeof CAPACITY_SOURCES)[number];

/** Mirrors the SQL resolution in `utilizationSql`: most exact source first. */
export function capacitySourceOf(
  maxCapacityQty: number | null | undefined,
  legacyUnits: number | null | undefined,
  more: {
    readonly productMaxQty?: number | null;
    readonly volume?: number | null;
    readonly allStockHasDims?: boolean;
  } = {},
): CapacitySource {
  if ((maxCapacityQty ?? 0) > 0) return 'Max Capacity Qty';
  if ((more.productMaxQty ?? 0) > 0) return 'Product Max Qty';
  if ((more.volume ?? 0) > 0 && more.allStockHasDims !== false) return 'Cube (volume)';
  if ((legacyUnits ?? 0) > 0) return 'Legacy Capacity Units (estimate)';
  return 'Not Set';
}

/** Default view: exact and derived capacity only; legacy estimates sit behind the chip. */
export const UTILIZATION_DEFAULT_FILTER = 'f.estimated=bool:false';

/** Band colours (pill + bar), shared by the grid cells and the band summary chips. */
export const BAND_TONE: Readonly<
  Record<UtilizationBand, 'grey' | 'blue' | 'green' | 'amber' | 'red' | 'purple'>
> = {
  Empty: 'grey',
  Low: 'blue',
  Healthy: 'green',
  'Near Full': 'amber',
  'Over Capacity': 'red',
  'No Capacity Set': 'purple',
};

/** "1,240 %" / "85.5 %"; em dash when there is no capacity. */
export function formatUtilizationPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  return `${pct.toLocaleString('en-US', { maximumFractionDigits: 1 })} %`;
}

export const UTILIZATION_DEF: ReportDef = {
  gridKey: 'report-location-utilization',
  title: 'Location Utilization Report',
  path: '/api/reports/location-utilization',
  permission: 'settings.locations.view',
  helper:
    'How full every active location is: units and SKUs stored against its capacity. Find over-filled bins, empty pick faces and space to consolidate.',
  fields: [
    enumOf('band', 'Utilization', UTILIZATION_BANDS),
    num('utilizationPct', 'Utilization %'),
    text('location', 'Location'),
    text('zone', 'Zone'),
    enumOf('areaType', 'Area Type', AREA_TYPES),
    enumOf('capacitySource', 'Capacity Source', CAPACITY_SOURCES),
    bool('estimated', 'Estimated Capacity?', {
      description:
        'Yes = the location has no Max Capacity Qty, product capacity or volume, so the legacy capacity units (a size rating) are used and the percentage is an estimate.',
    }),
    num('skuCount', 'SKU Count'),
    WAREHOUSE_FIELD,
  ],
  columns: [
    col('location', 'Location', { width: 140, hrefKey: 'locationHref', alwaysVisible: true }),
    col('utilizationPct', 'Utilization %', { width: 190, tip: UTILIZATION_TIP, exportType: 'number' }),
    col('band', 'Utilization', { width: 170 }),
    col('usedQty', 'On Hand Units', { kind: 'number', width: 120 }),
    col('capacity', 'Capacity (Units)', {
      kind: 'number',
      width: 130,
      tip: 'Units the location holds. For cube rows: how many units of the stored mix fit its volume.',
    }),
    col('freeQty', 'Free Capacity', {
      kind: 'number',
      width: 130,
      tip: 'Capacity minus on-hand units (never below 0).',
    }),
    col('capacitySource', 'Capacity Source', {
      width: 170,
      tip: "Max Capacity Qty and Product Max Qty are exact unit counts. Cube compares the stored units' product volume with the location's volume. Legacy capacity units are a size rating, so utilization from them is an estimate.",
    }),
    col('usedCube', 'Used Cube (in³)', {
      kind: 'number',
      width: 140,
      defaultHidden: true,
      tip: 'On-hand units × product L × W × H.',
    }),
    col('locationCube', 'Location Cube (in³)', {
      kind: 'number',
      width: 160,
      defaultHidden: true,
      tip: "The location's volume from its dimensions.",
    }),
    col('zone', 'Zone', { width: 110 }),
    col('areaType', 'Area Type', { width: 120 }),
    col('locationType', 'Location Type', { width: 130 }),
    col('capacityType', 'Capacity Rule', {
      width: 150,
      defaultHidden: true,
      tip: "The location's capacity rule (Logiwa Capacity Type). None = no capacity enforcement on putaway.",
    }),
    col('estimated', 'Estimated?', { kind: 'yesNo', width: 110, defaultHidden: true }),
    col('skuCount', 'SKU Count', { kind: 'number', width: 110 }),
    col('lpCount', 'LP Count', { kind: 'number', width: 100 }),
    col('warehouse', 'Warehouse', { width: 190 }),
  ],
  search: ['location'],
  searchPlaceholder: 'Search by location',
  defaultSort: ['-utilizationPct', 'location'],
  rowKey: 'rowId',
};
