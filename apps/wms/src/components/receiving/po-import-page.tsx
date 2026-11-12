'use client';

/**
 * Import purchase orders (`/receiving/import`), Logiwa's Purchase Order import screen:
 * a tab per import (Purchase orders, Serial numbers), the green template download, an
 * **Import manual** (every template column with its rules, example and notes, plus the
 * processing rules), drag-and-drop upload and the import history grid with master row,
 * success and error counts, Details, Download original and Download error file.
 * Uploads post to the shared `/api/imports/[key]` pipeline (M05 handlers).
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Download, FileSpreadsheet, FileText, FileWarning } from 'lucide-react';
import { DataGrid } from '@/components/grid/data-grid';
import { DateCell, QtyCell, UserCell } from '@/components/grid/cells';
import type { RowAction } from '@/components/grid/grid-types';
import { fileUrl, importBatchSchema, parseList, type ImportBatch } from '@/components/shared/contracts';
import { ImportDetailsDrawer } from '@/components/shared/import-details-drawer';
import { IMPORT_ACCEPT, MAX_UPLOAD_BYTES } from '@/components/shared/upload-file';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Drawer } from '@/components/ui/drawer';
import { FileDropzone } from '@/components/ui/file-dropzone';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/toast';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import type { ImportColumn } from '@/server/imports/types';
import { useCan } from './receiving-shared';

export interface PoImportDefinition {
  readonly key: 'purchase-orders' | 'po-serials';
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly configured: boolean;
  readonly permission: string;
  readonly columns: readonly ImportColumn[];
}

/** Processing rules shown in the manual, per import. */
export const IMPORT_RULES: Readonly<Record<PoImportDefinition['key'], readonly string[]>> = {
  'purchase-orders': [
    'One row per purchase order line. Rows with the same PO number, client and warehouse become one purchase order.',
    'A PO number that already exists and is still Pending gets the new lines appended; a Started, Completed or Cancelled PO is rejected for that row.',
    'Vendors are matched by name within the client and created when missing.',
    'Each row is validated on its own: valid rows are imported, invalid rows are listed in the error file with the reason in the last column.',
    'Fix the rows listed in the error file and upload just those rows again.',
  ],
  'po-serials': [
    'One row per serial number. The PO must be open and the SKU must be serial tracked and on the PO.',
    'A serial already pre-advised on an open PO, or already in stock, is rejected (case-insensitive).',
    'Serials fill the first line of that SKU that still has room: one serial per ordered unit times the pack ratio.',
    'Invalid rows are listed in the error file with the reason; valid rows are imported.',
  ],
};

const COLUMNS: ColumnDef<ImportBatch, unknown>[] = [
  {
    id: 'status',
    header: 'Status',
    enableSorting: false,
    cell: ({ row }) => <StatusPill status={row.original.status} domain="integration" />,
  },
  {
    id: 'masterRowCount',
    header: 'Master row count',
    enableSorting: false,
    meta: { align: 'right' },
    cell: ({ row }) => <QtyCell value={row.original.masterRowCount} />,
  },
  {
    id: 'successCount',
    header: 'Success',
    enableSorting: false,
    meta: { align: 'right' },
    cell: ({ row }) => <QtyCell value={row.original.successCount} muteZero />,
  },
  {
    id: 'errorCount',
    header: 'Error',
    enableSorting: false,
    meta: { align: 'right' },
    cell: ({ row }) => (
      <span className={row.original.errorCount ? 'font-semibold text-danger' : 'text-faint'}>
        {row.original.errorCount}
      </span>
    ),
  },
  {
    id: 'uploadedBy',
    header: 'Uploaded by',
    enableSorting: false,
    cell: ({ row }) => <UserCell name={row.original.uploadedByName ?? row.original.uploadedBy} />,
  },
  {
    id: 'createdAt',
    header: 'Created date time',
    enableSorting: false,
    cell: ({ row }) => <DateCell value={row.original.createdAt} />,
  },
];

function download(id: string): void {
  const a = document.createElement('a');
  a.href = fileUrl(id, true);
  a.download = '';
  a.click();
}

const TYPE_LABEL: Readonly<Record<string, string>> = {
  text: 'Text',
  number: 'Number',
  integer: 'Whole number',
  boolean: 'Yes / No',
  date: 'Date',
  enum: 'List',
};

/** One line of rules for a template column: type, length / range and allowed values. */
export function columnRule(c: ImportColumn): string {
  const parts = [TYPE_LABEL[c.type] ?? c.type];
  if (c.maxLength) parts.push(`max ${c.maxLength} characters`);
  if (c.min !== undefined && c.max !== undefined) parts.push(`${c.min}–${c.max}`);
  else if (c.min !== undefined) parts.push(`at least ${c.min}`);
  else if (c.max !== undefined) parts.push(`at most ${c.max}`);
  if (c.options && c.options.length > 0) parts.push(`one of: ${c.options.join(', ')}`);
  return parts.join(' · ');
}

function ImportManual({
  def,
  open,
  onOpenChange,
}: {
  readonly def: PoImportDefinition;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const required = def.columns.filter((c) => c.required).length;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width={45}
      title={
        <span className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" aria-hidden />
          Import manual · {def.label}
        </span>
      }
      description={`${def.columns.length} columns, ${required} required (marked *)`}
      footer={
        <>
          <a
            href={`/api/imports/${def.key}/template`}
            download
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-surface-sunken"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download template
          </a>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5" data-testid="import-manual">
        <section>
          <h3 className="mb-2 text-xs font-semibold text-faint">How the import works</h3>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-body">
            {IMPORT_RULES[def.key].map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ol>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold text-faint">Columns</h3>
          <div className="overflow-x-auto ks-scroll">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-left text-2xs font-semibold text-faint">
                  {['Column', 'Rules', 'Example', 'Notes'].map((h) => (
                    <th key={h} className="border-b border-border px-2 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {def.columns.map((c) => (
                  <tr key={c.key} className="align-top">
                    <td className="border-b border-border px-2 py-2 font-semibold text-foreground">
                      {c.header.replace(/\s*\*$/, '')}
                      {c.required ? <span className="text-danger"> *</span> : null}
                    </td>
                    <td className="border-b border-border px-2 py-2 text-secondary">{columnRule(c)}</td>
                    <td className="border-b border-border px-2 py-2 font-mono text-2xs text-body">
                      {c.example || '—'}
                    </td>
                    <td className="border-b border-border px-2 py-2 text-secondary">
                      {c.description ?? (c.required ? 'Required.' : 'Optional.')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Drawer>
  );
}

function ImportPanel({ def }: { readonly def: PoImportDefinition }) {
  const queryClient = useQueryClient();
  const allowed = useCan(def.permission);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(100);
  const [manual, setManual] = React.useState(false);
  const [uploading, setUploading] = React.useState<{
    readonly name: string;
    readonly size: number;
    readonly error?: string;
  } | null>(null);
  const [details, setDetails] = React.useState<ImportBatch | null>(null);
  // Same key as the shared import page, so both views share one cache.
  const key = ['imports', def.key] as const;
  const history = useApiQuery<unknown>(key, `/api/imports/${def.key}`, {
    query: { page, ps: pageSize },
    placeholderData: (p) => p,
  });
  const batches = parseList(importBatchSchema, history.data?.data);
  const processing = batches.some((b) => b.status === 'Processing');

  React.useEffect(() => {
    if (!processing) return;
    const id = setInterval(
      () => void queryClient.invalidateQueries({ queryKey: ['imports', def.key] }),
      3000,
    );
    return () => clearInterval(id);
  }, [processing, def.key, queryClient]);

  const upload = async (file: File) => {
    setUploading({ name: file.name, size: file.size });
    try {
      const form = new FormData();
      form.append('file', file);
      await apiRequest(`/api/imports/${def.key}`, { method: 'POST', body: form });
      toast.success(
        'Import started',
        `${file.name} is being processed. Results appear in the import history.`,
      );
      setUploading(null);
      setPage(1);
      await queryClient.invalidateQueries({ queryKey: ['imports', def.key] });
    } catch (error) {
      setUploading({
        name: file.name,
        size: file.size,
        error: isApiError(error) ? error.message : 'Upload failed',
      });
    }
  };

  const rowActions = (b: ImportBatch): readonly RowAction[] => [
    { key: 'details', label: 'Details', icon: FileText, onSelect: () => setDetails(b) },
    {
      key: 'original',
      label: 'Download original',
      icon: Download,
      disabledReason: b.fileId ? null : 'The original file is no longer available',
      onSelect: () => b.fileId && download(b.fileId),
    },
    {
      key: 'errors',
      label: 'Download error file',
      icon: FileWarning,
      disabledReason: b.errorFileId ? null : 'This import has no errors',
      onSelect: () => b.errorFileId && download(b.errorFileId),
    },
  ];
  const blocked =
    !allowed.isLoading && !allowed.allowed
      ? `You don't have permission to import ${def.label.toLowerCase()}`
      : !def.configured
        ? 'This import is not configured yet'
        : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-4 px-6 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-3xl text-sm text-secondary">{def.description}</p>
          <Button variant="secondary" onClick={() => setManual(true)} data-testid="open-import-manual">
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            Import manual
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          <a
            href={`/api/imports/${def.key}/template`}
            download
            className="group flex items-center gap-3 rounded-lg border border-success/40 bg-success-soft p-4 transition-colors hover:border-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-success text-white">
              <FileSpreadsheet className="h-5 w-5" aria-hidden />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-success">Download our excel template</span>
              <span className="text-xs text-secondary">
                {def.columns.length} columns, an example row and field notes
              </span>
            </span>
            <Download
              className="ml-auto h-4 w-4 text-success transition-transform group-hover:translate-y-0.5"
              aria-hidden
            />
          </a>
          <FileDropzone
            accept={IMPORT_ACCEPT}
            maxSizeBytes={MAX_UPLOAD_BYTES}
            maxFiles={1}
            disabled={Boolean(blocked) || (uploading !== null && !uploading.error)}
            title={blocked ?? 'Drag and drop your .xlsx or .csv file here, or browse'}
            hint="Up to 10 MB · one file at a time"
            onFiles={(files) => {
              const f = files[0];
              if (f) void upload(f);
            }}
            items={
              uploading
                ? [
                    {
                      id: 'upload',
                      name: uploading.name,
                      size: uploading.size,
                      progress: uploading.error ? undefined : 50,
                      error: uploading.error,
                    },
                  ]
                : []
            }
            onRemove={uploading?.error ? () => setUploading(null) : undefined}
          />
        </div>
        {processing ? (
          <Callout variant="info" title="An import is processing">
            The history refreshes automatically until it finishes.
          </Callout>
        ) : null}
      </div>
      <DataGrid<ImportBatch>
        columns={COLUMNS}
        data={[...batches]}
        total={history.data?.meta?.total ?? batches.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        loading={history.isPending}
        error={history.error?.message ?? null}
        onRetry={() => void history.refetch()}
        onRefresh={() => void history.refetch()}
        getRowId={(b) => b.id}
        selectable={false}
        rowActions={rowActions}
        onRowClick={(b) => setDetails(b)}
        exportName={`${def.key}-import-history`}
        emptyTitle="No imports yet"
        emptyDescription="Download the template, fill it in and drop the file above. Each upload is listed here with its success and error counts."
        toolbarLeft={<h2 className="text-base font-semibold text-foreground">Import history</h2>}
      />
      <ImportDetailsDrawer batch={details} onOpenChange={(o) => !o && setDetails(null)} />
      <ImportManual def={def} open={manual} onOpenChange={setManual} />
    </div>
  );
}

export function PoImportPage({
  defs,
  initialKey,
}: {
  readonly defs: readonly PoImportDefinition[];
  readonly initialKey: PoImportDefinition['key'];
}) {
  const router = useRouter();
  const [active, setActive] = React.useState(initialKey);
  const def = defs.find((d) => d.key === active) ?? defs[0];
  if (!def) return null;
  const select = (key: PoImportDefinition['key']) => {
    setActive(key);
    router.replace(`/receiving/import?type=${key}`, { scroll: false });
  };
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <div className="flex flex-col gap-3 px-6 pt-5">
        <Link
          href="/receiving"
          className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-secondary hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to purchase orders
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">Import purchase orders</h1>
          {!def.configured ? (
            <Badge tone="warning" size="sm">
              Not configured
            </Badge>
          ) : null}
        </div>
        <div role="tablist" aria-label="Import type" className="flex gap-1 border-b border-border">
          {defs.map((d) => (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={d.key === def.key}
              onClick={() => select(d.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${d.key === def.key ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-foreground'}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <ImportPanel key={def.key} def={def} />
    </div>
  );
}
