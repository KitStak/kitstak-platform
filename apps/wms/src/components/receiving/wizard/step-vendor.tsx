'use client';

/**
 * Step 3 — Vendor. The client's active vendors (never another client's), with search and
 * filter. Exactly one can be selected; Add new vendor opens the vendor drawer with the
 * client prefilled and locked; each row has an edit pencil.
 */
import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Pencil, Plus } from 'lucide-react';
import { DataGrid, GridToolbar, useLocalGrid } from '@/components/grid';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { DisabledReason } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { VENDOR_GRID_FIELDS } from '@/lib/grid-defs/receiving/vendors';
import { VendorDrawer } from '@/components/vendors/vendor-drawer';
import { useFilterFields, type VendorRow, useCan } from '../receiving-shared';
import type { PoFormValues } from './po-form-model';

const STEP_FIELDS = VENDOR_GRID_FIELDS.filter((f) => f.field !== 'clientId' && f.field !== 'isActive');

export function StepVendor({ form }: { readonly form: UseFormReturn<PoFormValues> }) {
  const clientId = useWatch({ control: form.control, name: 'clientId' });
  const vendorId = useWatch({ control: form.control, name: 'vendorId' });
  const fields = useFilterFields(STEP_FIELDS);
  const extraQuery = React.useMemo(() => ({ clientId, active: '1' }), [clientId]);
  const g = useLocalGrid<VendorRow>({
    gridKey: 'po-wizard-vendors',
    path: clientId ? '/api/vendors' : null,
    fields,
    extraQuery,
  });
  const canCreate = useCan('settings.vendors.create').allowed;
  const canEdit = useCan('settings.vendors.edit').allowed;
  const [drawer, setDrawer] = React.useState<{ id: string | null } | null>(null);
  const error = form.formState.errors.vendorId?.message;
  const vendorSelection = React.useMemo<Record<string, boolean>>(
    () => (vendorId ? { [vendorId]: true } : {}),
    [vendorId],
  );

  const choose = (row: Pick<VendorRow, 'id' | 'displayName'>) => {
    form.setValue('vendorId', row.id, { shouldDirty: true, shouldValidate: true });
    form.setValue('vendorLabel', row.displayName);
  };

  // Exactly one vendor: a radio column instead of the grid's multi-select checkboxes.
  const columns = React.useMemo<ColumnDef<VendorRow, unknown>[]>(
    () => [
      {
        id: 'pick',
        header: '',
        size: 44,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const checked = row.original.id === vendorId;
          return (
            <span
              role="radio"
              aria-checked={checked}
              aria-label={`Select ${row.original.displayName}`}
              className={cn(
                'flex h-4 w-4 items-center justify-center rounded-full border',
                checked ? 'border-primary' : 'border-border-strong',
              )}
            >
              {checked ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
            </span>
          );
        },
      },
      {
        id: 'displayName',
        accessorKey: 'displayName',
        header: 'Vendor display name',
        size: 240,
        cell: ({ getValue }) => (
          <span className="truncate font-medium text-foreground">{String(getValue())}</span>
        ),
      },
      {
        id: 'vendorName',
        accessorKey: 'vendorName',
        header: 'Vendor name',
        size: 260,
        cell: ({ getValue }) => <span className="truncate">{String(getValue())}</span>,
      },
      {
        id: 'location',
        header: 'Ships from',
        size: 160,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="truncate text-secondary">
            {[row.original.city, row.original.state].filter(Boolean).join(', ') || 'None'}
          </span>
        ),
      },
      {
        id: 'edit',
        header: '',
        size: 56,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <DisabledReason reason={canEdit ? null : "You don't have permission to edit vendors"}>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!canEdit}
              aria-label={`Edit ${row.original.displayName}`}
              onClick={(e) => {
                e.stopPropagation();
                setDrawer({ id: row.original.id });
              }}
            >
              <Pencil className="h-3.5 w-3.5 text-warning" aria-hidden />
            </Button>
          </DisabledReason>
        ),
      },
    ],
    [canEdit, vendorId],
  );

  if (!clientId)
    return (
      <Callout variant="attention" title="Choose a client first">
        Vendors belong to a client. Go back to PO details and choose one.
      </Callout>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-secondary">
          {vendorId ? (
            <>
              Selected: <span className="font-semibold text-foreground">{form.getValues('vendorLabel')}</span>
            </>
          ) : null}
        </p>
        <DisabledReason reason={canCreate ? null : "You don't have permission to create vendors"}>
          <Button variant="primary" size="sm" disabled={!canCreate} onClick={() => setDrawer({ id: null })}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add new vendor
          </Button>
        </DisabledReason>
      </div>
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by vendor name" />
      <div className="flex h-[400px] min-h-0 flex-col">
        <DataGrid<VendorRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(r) => r.id}
          selectable={false}
          // Single-select: the footer counter follows the radio (1 when a vendor is chosen).
          selection={vendorSelection}
          onRowClick={(r) => choose(r)}
          emptyTitle="This client has no active vendors yet"
          emptyDescription="Add the vendor that ships this order."
          emptyAction={
            canCreate ? (
              <Button variant="primary" onClick={() => setDrawer({ id: null })}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add new vendor
              </Button>
            ) : undefined
          }
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
      <VendorDrawer
        open={drawer !== null}
        onOpenChange={(open) => !open && setDrawer(null)}
        vendorId={drawer?.id ?? null}
        defaultClientId={clientId}
        lockClient
        onSaved={(v, created) => {
          if (created || v.id === vendorId) choose(v);
          g.refetch();
        }}
      />
    </div>
  );
}
