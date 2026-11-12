/**
 * End Of The Day grid (`/shipments/end-of-day`, gridKey `end-of-day`): one row per carrier
 * account, ship date and warehouse. Rows are stored manifests plus "pending" manifests derived
 * live from labels not yet attached to one.
 */
import { EOD_STATUSES } from '@/lib/enums';
import { optionsOf, type ShippingField } from './common';

export const EOD_GRID_KEY = 'end-of-day';

export const EOD_FIELDS: readonly ShippingField[] = [
  { field: 'carrierCode', label: 'Carrier', type: 'text', facet: 'carriers' },
  { field: 'carrierPrefix', label: 'Carrier prefix', type: 'text', facet: 'carrierAccounts' },
  { field: 'warehouseCode', label: 'Warehouse', type: 'text', facet: 'warehouses' },
  { field: 'shipDate', label: 'Ship date', type: 'date' },
  { field: 'closeDate', label: 'Close date', type: 'date' },
  { field: 'isPrinted', label: 'Printed?', type: 'boolean' },
  { field: 'totalPackages', label: 'Total package', type: 'number' },
  {
    field: 'voidedPackages',
    label: 'Voided packages',
    type: 'number',
    description:
      'Labels voided after they joined this manifest. Use "greater than 0" to find manifests with voids.',
  },
  { field: 'status', label: 'Status', type: 'enum', options: optionsOf(EOD_STATUSES) },
  {
    field: 'isOverdue',
    label: 'Not closed (past day)',
    type: 'boolean',
    description: "Open manifests whose ship day is already over in the warehouse's time zone",
  },
  { field: 'scheduledPickupAt', label: 'Scheduled pickup', type: 'date' },
];

export const EOD_SORT_FIELDS = [
  'carrierPrefix',
  'carrierCode',
  'warehouseCode',
  'shipDate',
  'closeDate',
  'isPrinted',
  'totalPackages',
  'voidedPackages',
  'status',
] as const;
export const EOD_SEARCH_FIELDS = ['carrierPrefix', 'carrierCode', 'warehouseCode'] as const;

/**
 * Pending (not yet stored) manifest ids: `pending~<warehouseId>~<connectionId>~<YYYY-MM-DD>[~<carrierCode>]`.
 * One manifest holds one carrier: a carrier setup that ships with several carriers (a USPS
 * service on a UPS connection) gets one row per carrier.
 */
export const PENDING_EOD_PREFIX = 'pending~';
/** Rows for packages of another carrier that sit on a closed manifest: `split~<manifestId>~<carrierCode>`. */
export const SPLIT_EOD_PREFIX = 'split~';

export function pendingEodId(
  warehouseId: string,
  connectionId: string,
  shipDate: string,
  carrierCode?: string,
): string {
  return `${PENDING_EOD_PREFIX}${warehouseId}~${connectionId}~${shipDate}${carrierCode ? `~${encodeURIComponent(carrierCode)}` : ''}`;
}

export function parsePendingEodId(
  id: string,
): { warehouseId: string; connectionId: string; shipDate: string; carrierCode: string | null } | null {
  if (!id.startsWith(PENDING_EOD_PREFIX)) return null;
  const [warehouseId, connectionId, shipDate, carrier] = id.slice(PENDING_EOD_PREFIX.length).split('~');
  if (!warehouseId || !connectionId || !shipDate || !/^\d{4}-\d{2}-\d{2}$/.test(shipDate)) return null;
  let carrierCode: string | null = null;
  try {
    carrierCode = carrier ? decodeURIComponent(carrier) : null;
  } catch {
    return null;
  }
  return { warehouseId, connectionId, shipDate, carrierCode };
}

export function splitEodId(manifestId: string, carrierCode: string): string {
  return `${SPLIT_EOD_PREFIX}${manifestId}~${encodeURIComponent(carrierCode)}`;
}

export function parseSplitEodId(id: string): { manifestId: string; carrierCode: string } | null {
  if (!id.startsWith(SPLIT_EOD_PREFIX)) return null;
  const [manifestId, carrier] = id.slice(SPLIT_EOD_PREFIX.length).split('~');
  if (!manifestId || !carrier) return null;
  try {
    return { manifestId, carrierCode: decodeURIComponent(carrier) };
  } catch {
    return null;
  }
}

export interface EodGuardRow {
  readonly status: string;
  readonly totalPackages: number;
  readonly isPrinted: boolean;
}

/** Why "Print End of the Day Report" is blocked for the selection, or null. */
export function closeBlockReason(rows: readonly EodGuardRow[]): string | null {
  if (rows.some((r) => r.status === 'Closed'))
    return 'Only Open manifests can be closed — use Reprint for closed ones';
  if (rows.some((r) => r.totalPackages === 0)) return "A manifest with no active packages can't be closed";
  return null;
}

/** Why "Reprint" is blocked for the selection, or null. */
export function reprintBlockReason(rows: readonly EodGuardRow[]): string | null {
  if (rows.some((r) => r.status !== 'Closed')) return 'Only closed manifests have a report to reprint';
  return null;
}

/**
 * Why "Open printed report" is blocked for a row, or null. A closed (printed) manifest always has a report:
 * the stored file opens, or the server regenerates it on demand (`POST /api/end-of-day/report`).
 */
export function openReportBlockReason(row: EodGuardRow): string | null {
  if (row.status !== 'Closed')
    return 'This manifest is still open. Print the End of the Day Report to create it.';
  return null;
}
