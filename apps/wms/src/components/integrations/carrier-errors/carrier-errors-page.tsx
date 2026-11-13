'use client';

/**
 * Carrier Monitoring › Carrier Errors (spec 06 §17): Label Generation / Rate Call / Void-Cancel
 * Label grids from `carrier_call_logs`; row ⋯ Show details (Transaction Details drawer with
 * REQUEST / RESPONSE JSON tabs) · Download request · Download response.
 */
import * as React from 'react';
import Link from 'next/link';
import { Download, Eye } from 'lucide-react';
import { DataGrid, GridToolbar, useGrid, type GridColumnDef, type RowAction } from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { SegmentedTabs } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { apiRequest } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { z } from 'zod';
import {
  CALL_LOG_FIELDS,
  CARRIER_ERRORS_GRID_KEYS,
  type CallStep,
} from '@/lib/grid-defs/integrations/carriers';
import type { CallLogDetail, CallLogRow } from '@/server/repositories/carriers';
import {
  DateTimeText,
  DetailList,
  Muted,
  toFilterFields,
  useClientOptions,
  useModuleDates,
  useStableGroupTabs,
  useWarehouseOptions,
  integrationDomain,
} from '@/components/integrations/shared/shared';
import { brandText } from '@/lib/grid-defs/integrations/common';

/** One response-time treatment for grid and drawer: sandbox calls answered locally read "Sandbox". */
function ResponseTime({ provider, ms }: { readonly provider: string; readonly ms: number }) {
  if (provider === 'kitstaks-sandbox' && ms < 5) {
    return (
      <Tooltip
        content={`Sandbox calls are answered locally (${ms.toLocaleString('en-US')} ms), so there is no carrier round-trip to time.`}
      >
        <span tabIndex={0} className="text-faint focus-visible:outline-none focus-visible:underline">
          Sandbox
        </span>
      </Tooltip>
    );
  }
  return <span className="tabular-nums">{ms.toLocaleString('en-US')} ms</span>;
}
import { downloadText, JsonViewer, prettyJson } from '@/components/integrations/shared/json-viewer';
import { ProviderCell, providerOptions } from '@/components/integrations/shared/logos';

const optionList = z.array(z.object({ id: z.string(), setupName: z.string() }));
const STEP_LABEL: Readonly<Record<string, string>> = {
  LabelGeneration: 'Label Generation',
  RateCall: 'Rate Call',
  VoidLabel: 'Void/Cancel Label',
  Tracking: 'Tracking',
  Pickup: 'Pickup',
};

function TransactionDrawer({
  id,
  onOpenChange,
}: {
  readonly id: string | null;
  readonly onOpenChange: (o: boolean) => void;
}) {
  const dates = useModuleDates();
  const q = useApiQuery<CallLogDetail>(
    ['carrier-call', id ?? ''],
    id ? `/api/carriers/call-logs/${id}` : null,
    { staleTime: 60_000 },
  );
  const d = q.data?.data;
  const [tab, setTab] = React.useState<'request' | 'response'>('request');
  React.useEffect(() => setTab('request'), [id]);
  return (
    <Drawer
      open={id !== null}
      onOpenChange={onOpenChange}
      width={60}
      title="Transaction details"
      description="Full request, response and error details for this carrier transaction."
    >
      {q.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : !d ? (
        <EmptyState
          title="Couldn't load this transaction"
          description={q.error?.message}
          action={<Button onClick={() => void q.refetch()}>Retry</Button>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <DetailList
            items={[
              { label: 'Integration step', value: STEP_LABEL[d.step] },
              { label: 'Created date', value: dates.dateTime(d.at) },
              {
                label: 'Status',
                value: (
                  <StatusPill
                    status={d.status === 'Success' ? 'Successful' : 'Error'}
                    domain={integrationDomain(d.status === 'Success' ? 'Successful' : 'Error')}
                  />
                ),
              },
              { label: 'HTTP code', value: <span className="font-mono">{d.httpCode}</span> },
              { label: 'Response time', value: <ResponseTime provider={d.provider} ms={d.responseMs} /> },
              {
                label: 'Shipment order',
                value:
                  d.orderId && d.orderCode ? (
                    <Link className="text-primary hover:underline" href={`/orders/${d.orderId}`}>
                      {d.orderCode}
                    </Link>
                  ) : null,
              },
              { label: 'Carrier setup', value: d.connectionLabel },
              { label: 'Shipping option', value: d.serviceName },
              { label: 'Rate shopping', value: d.rateShoppingName ?? 'No' },
              { label: 'Source', value: d.source },
            ]}
          />
          {d.error ? (
            <section className="rounded-lg border border-danger/30 bg-danger-soft/30 p-4">
              <p className="text-2xs font-semibold text-danger">Error details · carrier returned an error</p>
              <p className="mt-1 text-base font-medium text-foreground">{brandText(d.error)}</p>
            </section>
          ) : null}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-secondary">API log details</h3>
            <SegmentedTabs
              ariaLabel="Request or response"
              tabs={[
                { key: 'request', label: 'REQUEST' },
                { key: 'response', label: 'RESPONSE' },
              ]}
              active={tab}
              onChange={(k) => setTab(k as 'request' | 'response')}
            />
            {tab === 'request' ? (
              <JsonViewer
                title="Request body (JSON)"
                value={d.requestJson}
                filename={`${d.orderCode ?? d.id}-request.json`}
              />
            ) : (
              <JsonViewer
                title="Response body (JSON)"
                value={d.responseJson}
                filename={`${d.orderCode ?? d.id}-response.json`}
              />
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

export function CarrierErrorsPage({ step }: { readonly step: CallStep }) {
  const tabs = useStableGroupTabs('carrier-errors');
  const clients = useClientOptions();
  const warehouses = useWarehouseOptions();
  const setupsQ = useApiQuery<unknown>(['carrier-options'], '/api/carriers/options', { staleTime: 60_000 });
  const setupsP = optionList.safeParse(setupsQ.data?.data);
  const setups = setupsP.success ? setupsP.data.map((x) => ({ value: x.id, label: x.setupName })) : [];
  const fields = React.useMemo(
    () =>
      toFilterFields(
        CALL_LOG_FIELDS.filter((f) =>
          step === 'VoidLabel'
            ? !['isInternational', 'isRateShopping'].includes(f.field)
            : f.field !== 'trackingNumber',
        ),
        {
          connectionId: setups,
          clientId: clients,
          warehouseId: warehouses.short,
          provider: [...providerOptions('carrier'), { value: 'kitstaks-sandbox', label: 'KitStak Sandbox' }],
        },
      ),
    [setups, clients, warehouses.short, step],
  );
  const extraQuery = React.useMemo(() => ({ step }), [step]);
  const g = useGrid<CallLogRow>({
    gridKey: CARRIER_ERRORS_GRID_KEYS[step],
    path: '/api/carriers/call-logs',
    fields,
    extraQuery,
  });
  const [detail, setDetail] = React.useState<string | null>(null);
  const download = async (row: CallLogRow, which: 'request' | 'response') => {
    const { data } = await apiRequest<CallLogDetail>(`/api/carriers/call-logs/${row.id}`);
    downloadText(
      `${row.orderCode ?? row.id}-${which}.json`,
      prettyJson(which === 'request' ? data.requestJson : data.responseJson),
    );
  };
  const order: GridColumnDef<CallLogRow> = {
    id: 'orderCode',
    header: 'Shipment order',
    size: 130,
    cell: ({ row }) =>
      row.original.orderId && row.original.orderCode ? (
        <Link
          className="font-medium text-primary hover:underline"
          href={`/orders/${row.original.orderId}`}
          onClick={(e) => e.stopPropagation()}
        >
          {row.original.orderCode}
        </Link>
      ) : (
        <Muted />
      ),
  };
  const COLUMNS: GridColumnDef<CallLogRow>[] = [
    {
      id: 'at',
      header: 'Timestamp',
      size: 180,
      meta: { alwaysVisible: true },
      cell: ({ row }) => <DateTimeText value={row.original.at} />,
    },
    {
      id: 'step',
      header: 'Integration step',
      size: 140,
      enableSorting: false,
      cell: ({ row }) => STEP_LABEL[row.original.step],
    },
    ...(step === 'VoidLabel'
      ? [
          {
            id: 'trackingNumber',
            header: 'Tracking number',
            size: 190,
            cell: ({ row }) => (
              <span className="font-mono text-xs">{row.original.trackingNumber ?? 'None'}</span>
            ),
          } satisfies GridColumnDef<CallLogRow>,
          order,
        ]
      : [
          order,
          {
            id: 'destinationType',
            header: 'Destination type',
            size: 130,
            enableSorting: false,
            cell: ({ row }) =>
              row.original.destinationType ? (
                <Badge
                  size="sm"
                  shape="pill"
                  tone={row.original.destinationType === 'International' ? 'info' : 'neutral'}
                >
                  {row.original.destinationType}
                </Badge>
              ) : (
                <Muted />
              ),
          } satisfies GridColumnDef<CallLogRow>,
        ]),
    {
      id: 'provider',
      header: 'Carrier',
      size: 190,
      cell: ({ row }) => <ProviderCell kind="carrier" provider={row.original.provider} />,
    },
    {
      id: 'status',
      header: 'Status',
      size: 90,
      cell: ({ row }) => (
        <StatusPill
          size="sm"
          status={row.original.status === 'Success' ? 'Successful' : 'Error'}
          domain={integrationDomain(row.original.status === 'Success' ? 'Successful' : 'Error')}
        />
      ),
    },
    {
      id: 'httpCode',
      header: 'HTTP code',
      size: 96,
      cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.httpCode}</span>,
    },
    {
      id: 'error',
      header: 'Error',
      size: 240,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.error ? (
          <Tooltip content={brandText(row.original.error)}>
            <span
              tabIndex={0}
              className="inline-flex min-w-0 max-w-full rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Badge tone="danger" size="sm" shape="pill" className="min-w-0 max-w-full">
                <span className="min-w-0 truncate">{brandText(row.original.error)}</span>
              </Badge>
            </span>
          </Tooltip>
        ) : (
          <Muted />
        ),
    },
    {
      id: 'responseMs',
      header: 'Resp. time',
      size: 110,
      meta: { align: 'right', label: 'Response time', headerTip: 'Carrier response time' },
      cell: ({ row }) => (
        <div className="text-right">
          <ResponseTime provider={row.original.provider} ms={row.original.responseMs} />
        </div>
      ),
    },
    {
      id: 'serviceName',
      header: 'Shipping option',
      size: 170,
      cell: ({ row }) => row.original.serviceName ?? <Muted />,
    },
    {
      id: 'connection',
      header: 'Carrier connection',
      size: 210,
      enableSorting: false,
      meta: { defaultVisible: false },
      cell: ({ row }) => row.original.connectionLabel,
    },
    { id: 'setupName', header: 'Carrier setup', size: 150, cell: ({ row }) => row.original.setupName },
    ...(step === 'VoidLabel'
      ? [
          {
            id: 'warehouseCode',
            header: 'Warehouse',
            size: 100,
            cell: ({ row }) => row.original.warehouseCode,
          } satisfies GridColumnDef<CallLogRow>,
        ]
      : []),
    {
      id: 'clientName',
      header: 'Client',
      size: 160,
      cell: ({ row }) => row.original.clientName ?? <Muted />,
    },
    {
      id: 'userEmail',
      header: 'User',
      size: 190,
      cell: ({ row }) => row.original.userEmail ?? <Muted>System</Muted>,
    },
    ...(step !== 'VoidLabel'
      ? [
          {
            id: 'source',
            header: 'Source',
            size: 130,
            cell: ({ row }) => row.original.source ?? <Muted />,
          } satisfies GridColumnDef<CallLogRow>,
        ]
      : []),
    ...(step !== 'RateCall'
      ? [
          {
            id: 'labelType',
            header: 'Label type',
            size: 120,
            cell: ({ row }) =>
              row.original.labelType ? (
                <StatusPill size="sm" status={row.original.labelType} domain="labelType" />
              ) : (
                <Muted />
              ),
          } satisfies GridColumnDef<CallLogRow>,
        ]
      : []),
    ...(step !== 'VoidLabel'
      ? [
          {
            id: 'rateShoppingName',
            header: 'Rate shopping name',
            size: 160,
            cell: ({ row }) => row.original.rateShoppingName ?? <Muted />,
          } satisfies GridColumnDef<CallLogRow>,
        ]
      : []),
  ];
  const rowActions = (row: CallLogRow): readonly RowAction[] => [
    { key: 'details', label: 'Show details', icon: Eye, onSelect: () => setDetail(row.id) },
    { key: 'req', label: 'Download request', icon: Download, onSelect: () => void download(row, 'request') },
    {
      key: 'res',
      label: 'Download response',
      icon: Download,
      onSelect: () => void download(row, 'response'),
    },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Carrier Monitoring"
        tabs={tabs}
        helpHref="/integrations/help#carrier-errors"
        breadcrumbs={[
          { label: 'Integrations' },
          { label: 'Carrier Errors', href: '/integrations/carrier-errors/label-generation' },
          { label: `${STEP_LABEL[step]} Errors` },
        ]}
        helper="Every failed carrier call with the exact request and response, so you can fix the setup or the order and try again."
      />
      <div className="flex min-h-0 flex-1 flex-col pb-4">
        <GridToolbar
          {...g.toolbarProps}
          searchPlaceholder={
            step === 'VoidLabel' ? 'Search order code or tracking number' : 'Search shipment order code'
          }
        />
        <DataGrid<CallLogRow>
          {...g.gridProps}
          columns={COLUMNS}
          getRowId={(r) => r.id}
          rowActions={rowActions}
          onRowClick={(r) => setDetail(r.id)}
          emptyTitle="No carrier errors recorded yet"
          emptyDescription={`Failed ${STEP_LABEL[step].toLowerCase()} calls show up here. Add a Status filter to include successful calls.`}
        />
      </div>
      <TransactionDrawer id={detail} onOpenChange={(o) => !o && setDetail(null)} />
    </div>
  );
}
