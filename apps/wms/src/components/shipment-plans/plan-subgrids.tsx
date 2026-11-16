'use client';

/**
 * Shipment Plan Orders (`/shipment-plans/orders`) and Shipment Plan LPs
 * (`/shipment-plans/lps`): flat views across every plan, with the Logiwa columns and filters.
 */
import {
  PLAN_LP_FIELDS,
  PLAN_ORDER_FIELDS,
  SHIPMENT_PLAN_LPS_GRID_KEY,
  SHIPMENT_PLAN_ORDERS_GRID_KEY,
} from '@/lib/grid-defs/shipping/shipment-plans';
import { DataGrid, GridToolbar, LinkCell, useGrid } from '@/components/grid';
import { StatusPill } from '@/components/ui/status-pill';
import { PageHeader } from '@/components/layout/page-header';
import type { ShippingField } from '@/lib/grid-defs/shipping/common';
import { buildColumns, dash, exportColumnsOf, type ColumnSpec } from '@/components/shipping/column-kit';
import { useFilterFields, useHydratedPermissions } from '@/components/shipping/shipping-client';
import { EmptyState } from '@/components/ui/empty-state';
import { Download, Lock } from 'lucide-react';
import { csvEscape } from '@/components/grid/legacy-csv';
import type { BulkAction } from '@/components/grid/grid-types';
import { toast } from '@/components/ui/toast';
import type { PlanOrderRow } from './plans-client';

type Row = PlanOrderRow & {
  readonly planCode: string;
  readonly orderCode: string;
  readonly orderStatus: string;
  readonly planStatus: string;
  readonly lpNumber?: string;
};

const planLink = (r: Row) => (
  <LinkCell href={`/shipment-plans/${encodeURIComponent(r.planId)}`}>{r.planCode}</LinkCell>
);
const orderLink = (r: Row) => (
  <LinkCell href={`/orders/${encodeURIComponent(r.orderCode)}`}>{r.orderCode}</LinkCell>
);
const soPill = (r: Row) => <StatusPill status={r.orderStatus} domain="shipmentOrder" />;
const planPill = (r: Row) =>
  r.planStatus ? <StatusPill status={r.planStatus} domain="shipmentPlan" /> : dash;

export const PLAN_ORDER_SPECS: readonly ColumnSpec<Row>[] = [
  { id: 'planCode', label: 'Shipment plan code', width: 150, always: true, cell: planLink },
  { id: 'orderCode', label: 'Order code', width: 130, cell: orderLink },
  { id: 'orderStatus', label: 'Order status', width: 140, cell: soPill },
  { id: 'planStatus', label: 'Status', width: 140, cell: planPill },
  { id: 'warehouseCode', label: 'Warehouse', width: 96 },
  { id: 'customerName', label: 'Customer', width: 160 },
  { id: 'customerAddress', label: 'Customer address', width: 240 },
  { id: 'carrierName', label: 'Carrier', width: 130 },
  { id: 'lpShippingOption', label: 'Shipping option of the LPN', width: 180 },
  { id: 'clientName', label: 'Client', width: 150 },
  { id: 'truckPlateNumber', label: 'Truck plate number', width: 140 },
  { id: 'orderCarrier', label: 'Carrier of the shipment order', width: 190 },
  { id: 'loadingGate', label: 'Loading gate', width: 120 },
  { id: 'plannedShipmentAt', label: 'Planned shipment date', kind: 'datetime' },
  { id: 'truckDepartedAt', label: 'Truck departed date', kind: 'datetime' },
];

export const PLAN_LP_SPECS: readonly ColumnSpec<Row>[] = [
  { id: 'planCode', label: 'Shipment plan code', width: 150, always: true, cell: planLink },
  { id: 'orderCode', label: 'Order code', width: 130, cell: orderLink },
  { id: 'orderStatus', label: 'Order status', width: 140, cell: soPill },
  {
    id: 'lpNumber',
    label: 'LP',
    width: 130,
    cell: (r) => <span className="font-semibold">{r.lpNumber}</span>,
  },
  { id: 'parentLpNumber', label: 'Parent LPN', width: 130 },
  { id: 'planStatus', label: 'Shipment plan status', width: 160, cell: planPill },
  { id: 'warehouseCode', label: 'Warehouse', width: 96 },
  { id: 'customerName', label: 'Customer', width: 160 },
  { id: 'customerAddress', label: 'Customer address', width: 240 },
  { id: 'carrierName', label: 'Carrier', width: 130 },
  { id: 'shippingService', label: 'Shipping option of the SO', width: 180 },
  { id: 'clientName', label: 'Client', width: 150 },
  { id: 'truckPlateNumber', label: 'Truck plate number', width: 140 },
  { id: 'lpCarrier', label: 'Carrier of the LPN', width: 150 },
  { id: 'originalLpNumber', label: 'Original LP number', width: 150 },
  { id: 'loadingGate', label: 'Loading gate', width: 120 },
  { id: 'plannedShipmentAt', label: 'Planned shipment date', kind: 'datetime' },
  { id: 'truckDepartedAt', label: 'Truck departed date', kind: 'datetime' },
  { id: 'weight', label: 'LP actual weight', kind: 'number', decimals: 2 },
  { id: 'volume', label: 'LP actual volume', kind: 'number', decimals: 2 },
];

const ORDER_COLUMNS = buildColumns(PLAN_ORDER_SPECS);
const LP_COLUMNS = buildColumns(PLAN_LP_SPECS);

interface SubGridConfig {
  readonly gridKey: string;
  readonly path: string;
  readonly permission: string;
  readonly fields: readonly ShippingField[];
  readonly specs: readonly ColumnSpec<Row>[];
  readonly columns: ReturnType<typeof buildColumns<Row>>;
  readonly title: string;
  readonly search: string;
  readonly empty: string;
  readonly emptyHint: string;
}

const CONFIG: Readonly<Record<'orders' | 'lps', SubGridConfig>> = {
  orders: {
    gridKey: SHIPMENT_PLAN_ORDERS_GRID_KEY,
    path: '/api/shipment-plans/orders',
    permission: 'fulfillment.shipment_plan.view_plan_orders',
    fields: PLAN_ORDER_FIELDS,
    specs: PLAN_ORDER_SPECS,
    columns: ORDER_COLUMNS,
    title: 'Shipment Plan Orders',
    search: 'Plan code or order code',
    empty: 'No orders on shipment plans yet',
    emptyHint: 'Orders appear here once they are added to a shipment plan.',
  },
  lps: {
    gridKey: SHIPMENT_PLAN_LPS_GRID_KEY,
    path: '/api/shipment-plans/lps',
    permission: 'fulfillment.shipment_plan.view_plan_lps',
    fields: PLAN_LP_FIELDS,
    specs: PLAN_LP_SPECS,
    columns: LP_COLUMNS,
    title: 'Shipment Plan LPs',
    search: 'Plan code, LP or order code',
    empty: 'No license plates on shipment plans yet',
    emptyHint: "LPs appear once a plan's orders are allocated or shipped from license plates.",
  },
};

export function PlanSubGridPage({ kind }: { readonly kind: 'orders' | 'lps' }) {
  const c = CONFIG[kind];
  const permissions = useHydratedPermissions();
  // Permissions hydrate after mount: only show the no-access state once they are known.
  if (permissions.size === 0) return <PageHeader title={c.title} tabs="shipment-plans" />;
  if (!permissions.has(c.permission) && !permissions.has('fulfillment.shipment_plan.view')) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
        <PageHeader title={c.title} tabs="shipment-plans" />
        <EmptyState
          icon={Lock}
          title="You don't have access to this view"
          description="Ask an administrator for this Shipment Plan permission. Plans themselves are still available on the Shipment Plan tab."
        />
      </div>
    );
  }
  return <PlanSubGrid c={c} />;
}

/** Plain cell value for CSV (status pills and links export their text). */
const csvValue = (row: Row, key: string): unknown => (row as unknown as Record<string, unknown>)[key];

/** CSV of the selected rows, columns in grid order (Logiwa "export selected"). */
export function selectedRowsCsv(
  rows: readonly Row[],
  columns: readonly { key: string; label: string }[],
): string {
  return [
    columns.map((c) => csvEscape(c.label)).join(','),
    ...rows.map((r) => columns.map((c) => csvEscape(csvValue(r, c.key))).join(',')),
  ].join('\r\n');
}

function downloadCsv(name: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PlanSubGrid({ c }: { readonly c: SubGridConfig }) {
  const fields = useFilterFields(c.fields);
  const g = useGrid<Row>({ gridKey: c.gridKey, path: c.path, fields });
  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const exportColumns = exportColumnsOf(c.specs);
  const bulkActions: readonly BulkAction[] = [
    {
      key: 'export-selected',
      label: 'Export selected',
      icon: Download,
      emptyReason: 'Select rows to export',
      onSelect: (ids) => {
        const picked = g.rows.filter((r) => ids.includes(r.id));
        downloadCsv(`${c.title} (${picked.length} selected).csv`, selectedRowsCsv(picked, exportColumns));
        toast.success(
          'Export ready',
          `${picked.length} ${picked.length === 1 ? 'row' : 'rows'} exported to CSV.`,
        );
      },
    },
  ];
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title={c.title} tabs="shipment-plans" />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder={c.search}
        onRefresh={g.refetch}
        bulkActions={bulkActions}
        selectedIds={g.selectedIds}
        bulkNoun="row"
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<Row>
          {...g.gridProps}
          columns={c.columns}
          exportColumns={exportColumns}
          getRowId={(r) => r.id}
          emptyTitle={hasState ? 'Nothing matches this view' : c.empty}
          emptyDescription={hasState ? 'Try changing the filters or search term.' : c.emptyHint}
        />
      </div>
    </div>
  );
}
