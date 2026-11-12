'use client';

/** Carrier Shipment Details columns: the 41 Logiwa columns, one row per package / label. */
import { LinkCell } from '@/components/grid/cells';
import { StatusPill } from '@/components/ui/status-pill';
import type { ShipmentListRow } from '@/server/repositories/shipping';
import {
  LabelStatusPill,
  LabelTypePill,
  buildColumns,
  dash,
  exportColumnsOf,
  shipDateTime,
  textCell,
  type ColumnSpec,
} from './column-kit';

export type ShipmentRow = ShipmentListRow & {
  readonly orderStatus: string;
  readonly labelType: string;
  readonly labelFileId: string | null;
  readonly carrierCode: string;
  readonly packageSeq: number | null;
  readonly packageCount: number;
  readonly masterTrackingNumber: string | null;
  readonly actualShipmentAt: string | null;
  readonly labelCreatedAt: string;
  readonly carrierConnectionId: string | null;
  readonly carrierServiceId: string | null;
  readonly weight: number;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly lastCarrierError: string | null;
  readonly trackingStatus: string | null;
  readonly shipmentMailSentAt: string | null;
  readonly deliveryMailSentAt: string | null;
};

function mailCell(at: string | null): React.ReactNode {
  return at ? (
    <span className="whitespace-nowrap" title={`Sent ${shipDateTime(at)}`}>
      Yes · {shipDateTime(at)}
    </span>
  ) : (
    <span className="text-faint">No</span>
  );
}

function trackingCell(row: ShipmentRow): React.ReactNode {
  const multi = row.packageCount > 1;
  const number = <span className="font-mono text-xs">{row.trackingNumber}</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {row.trackingUrl ? (
        <a
          href={row.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {number}
        </a>
      ) : (
        <span className="truncate">{number}</span>
      )}
      {multi ? (
        <span
          className="shrink-0 rounded bg-surface-sunken px-1 text-2xs font-semibold text-secondary"
          title={row.isMaster ? 'Master package' : 'Child package'}
        >
          {row.isMaster ? 'Master' : `Pkg ${row.packageSeq ?? '?'}/${row.packageCount}`}
        </span>
      ) : null}
    </span>
  );
}

export const SHIPMENT_COLUMN_SPECS: readonly ColumnSpec<ShipmentRow>[] = [
  {
    id: 'orderCode',
    label: 'Order code',
    width: 130,
    always: true,
    cell: (r) => <LinkCell href={`/orders/${encodeURIComponent(r.orderCode)}`}>{r.orderCode}</LinkCell>,
  },
  {
    id: 'packageSeq',
    label: 'Package',
    width: 96,
    sortable: false,
    exportKey: 'packageSeq',
    cell: (r) => (
      <span className="whitespace-nowrap tabular-nums" title={r.isMaster ? 'Master package' : undefined}>
        {r.packageSeq ?? 1} of {Math.max(r.packageCount, r.packageSeq ?? 1)}
        {r.isMaster && r.packageCount > 1 ? (
          <span className="ml-1 text-2xs font-semibold text-secondary">M</span>
        ) : null}
      </span>
    ),
  },
  { id: 'trackingNumber', label: 'Tracking number', width: 220, cell: trackingCell },
  {
    id: 'labelStatus',
    label: 'Label status',
    width: 150,
    cell: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <LabelStatusPill status={r.labelStatus} />
        {r.duplicateActiveLabels > 0 ? (
          <span
            className="whitespace-nowrap text-2xs font-medium text-warning"
            title={`${r.duplicateActiveLabels} other active label(s) exist for this package. Void the extra label before it is handed to the carrier.`}
          >
            Duplicate
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: 'hasCarrierError',
    label: 'Carrier errors',
    width: 220,
    exportKey: 'lastCarrierError',
    cell: (r) =>
      r.hasCarrierError ? (
        <span
          className="flex min-w-0 items-center gap-1.5"
          title={r.lastCarrierError ?? 'The carrier returned an error'}
        >
          <span className="shrink-0 rounded-full border border-danger/40 bg-danger-soft px-1.5 text-2xs font-semibold text-danger">
            Error
          </span>
          <span className="truncate text-xs text-secondary">{r.lastCarrierError ?? ''}</span>
        </span>
      ) : (
        dash
      ),
  },
  { id: 'carrier', label: 'Carrier', width: 150 },
  { id: 'serviceName', label: 'Shipment method', width: 150 },
  { id: 'rate', label: 'Rate', kind: 'money' },
  {
    id: 'masterTrackingNumber',
    label: 'Master tracking number',
    width: 190,
    cell: (r) =>
      r.masterTrackingNumber ? (
        <span className="truncate font-mono text-xs">{r.masterTrackingNumber}</span>
      ) : (
        dash
      ),
  },
  {
    id: 'orderStatus',
    label: 'Order status',
    width: 140,
    cell: (r) => <StatusPill status={r.orderStatus} domain="shipmentOrder" />,
  },
  { id: 'products', label: 'Products', width: 200, sortable: false },
  { id: 'locationCode', label: 'Inventory location', width: 170 },
  { id: 'labelCreatedAt', label: 'Label create date', kind: 'datetime' },
  { id: 'warehouseCode', label: 'Warehouse', width: 96 },
  { id: 'clientName', label: 'Client', width: 150 },
  { id: 'customerName', label: 'Customer', width: 170 },
  { id: 'customerAddress', label: 'Customer address', width: 240, sortable: false },
  { id: 'carrierExpectedDeliveryAt', label: 'Carrier expected delivery date', kind: 'datetime' },
  { id: 'isRateShopped', label: 'Rate shopping', kind: 'boolean' },
  { id: 'rateShoppingName', label: 'Rate shopping name', width: 150 },
  { id: 'labelType', label: 'Label type', width: 124, cell: (r) => <LabelTypePill type={r.labelType} /> },
  { id: 'actualShipmentAt', label: 'Actual shipment date', kind: 'datetime' },
  { id: 'deliveredAt', label: 'Delivery date', kind: 'datetime' },
  { id: 'trackingStatus', label: 'Tracking status', width: 130, cell: (r) => textCell(r.trackingStatus) },
  {
    id: 'shipmentMailSentAt',
    label: 'Shipment mail sent',
    width: 190,
    exportKey: 'shipmentMailSentAt',
    cell: (r) => mailCell(r.shipmentMailSentAt),
  },
  {
    id: 'deliveryMailSentAt',
    label: 'Delivery mail sent',
    width: 190,
    exportKey: 'deliveryMailSentAt',
    cell: (r) => mailCell(r.deliveryMailSentAt),
  },
  { id: 'voidedAt', label: 'Void date/time', kind: 'datetime' },
  { id: 'insuranceType', label: 'Insurance type', width: 120 },
  { id: 'insuranceValue', label: 'Insurance value', kind: 'money' },
  { id: 'confirmationType', label: 'Confirmation type', width: 140 },
  { id: 'weight', label: 'Weight', kind: 'number', decimals: 2 },
  { id: 'height', label: 'Height', kind: 'number', decimals: 2 },
  { id: 'width', label: 'Width', kind: 'number', decimals: 2 },
  { id: 'length', label: 'Length', kind: 'number', decimals: 2 },
  { id: 'dimensionUnit', label: 'Dimension unit', width: 110 },
  { id: 'packageCode', label: 'Shipment package type', width: 160 },
  { id: 'weightUnit', label: 'Weight unit', width: 100 },
  { id: 'shippingCost', label: 'Shipping cost', kind: 'money' },
  { id: 'zone', label: 'Zone', width: 72 },
  { id: 'otherCost', label: 'Other cost', kind: 'money' },
  { id: 'currency', label: 'Currency', width: 88 },
  { id: 'allowSaturdayDelivery', label: 'Is allow Saturday delivery', kind: 'boolean', width: 150 },
  { id: 'syncedToStore', label: 'Sync to store', kind: 'boolean', width: 120 },
  { id: 'scheduledPickupAt', label: 'Scheduled pickup date', kind: 'datetime' },
  { id: 'actualPickupAt', label: 'Actual pickup date', kind: 'datetime' },
  { id: 'parentLpNumber', label: 'Inventory parent LPN', width: 150 },
  {
    id: 'externalReference',
    label: 'External reference',
    width: 150,
    cell: (r) => textCell(r.externalReference),
  },
];

export const SHIPMENT_COLUMNS = buildColumns(SHIPMENT_COLUMN_SPECS);
export const SHIPMENT_EXPORT_COLUMNS = exportColumnsOf(SHIPMENT_COLUMN_SPECS);
