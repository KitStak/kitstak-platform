'use client';

/**
 * Create / Edit Mobile Cart drawer: 1. Mobile cart (code, warehouse, description, cart type
 * from Data Setup, levels × columns, operation) · 2. Cell list (auto-generated barcodes, a
 * live cart layout and per-cell editing). Cells lock while an open job holds the cart.
 */
import * as React from 'react';
import { Grid3x3, Plus, RefreshCw, ShoppingCart } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { UseFormReturn } from 'react-hook-form';
import { apiRequest, isApiError } from '@/lib/api-client';
import { applyServerFieldErrors, useApiQuery } from '@/lib/query-client';
import {
  buildCells,
  cellColor,
  cellDisplayName,
  cellSequence,
  CART_OPERATION_TYPES,
  MAX_CART_COLUMNS,
  MAX_CART_LEVELS,
  MOBILE_CART_DEFAULTS,
  mobileCartInfoSchema,
  mobileCartSchema,
  type MobileCartInput,
} from '@/lib/grid-defs/facility/mobile-carts';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { FormGrid, FormSection } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { Wizard, type WizardStep } from '@/components/ui/wizard';
import {
  ComboField,
  enumSelectOptions,
  NumberField,
  SelectField,
  TextInput,
  YesNoField,
} from '@/components/facility/form-controls';
import {
  useLookups,
  useWarehouseOptions,
  usePagePerms,
  apiErrorMessage,
} from '@/components/facility/facility-shared';
import type { MobileCartDetail } from '@/server/repositories/mobile-carts';
import { ERROR_TOAST_MS } from '@/lib/grid-defs/facility/common';
import { useAvailabilityCheck, useWizardGuard, type WizardGuard } from '@/components/facility/wizard-guard';

type F = MobileCartInput;

const levelLetter = (level: number) => String.fromCharCode(64 + level);
const metaNumber = (meta: Record<string, unknown> | null | undefined, key: string): number | null => {
  const v = meta?.[key];
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
};
/** Levels × columns a cart type fixes, or null when its Data Setup meta doesn't define both. */
const cartTypeLayout = (
  meta: Record<string, unknown> | null | undefined,
): { levels: number; columns: number } | null => {
  const levels = metaNumber(meta, 'levels'),
    columns = metaNumber(meta, 'columns');
  return levels && columns ? { levels, columns } : null;
};

/**
 * Inline "Add mobile cart type" panel (Logiwa opens a sub-drawer): creates a Data Setup
 * value scoped to the picked warehouse with default levels × columns, then selects it.
 */
/** "12 × 24 × 18 in" from a cart type's meta (H × L × W, Logiwa's read-only summary), or null. */
export function cartDimensionText(
  meta: Record<string, unknown> | null | undefined,
  prefix: '' | 'cell',
): string | null {
  const key = (k: string) => (prefix ? `${prefix}${k[0]!.toUpperCase()}${k.slice(1)}` : k);
  const h = metaNumber(meta, key('height')),
    l = metaNumber(meta, key('length')),
    w = metaNumber(meta, key('width'));
  if (!h && !l && !w) return null;
  const unit =
    meta && typeof meta === 'object' && typeof (meta as Record<string, unknown>).dimensionUnit === 'string'
      ? ` ${(meta as Record<string, string>).dimensionUnit}`
      : '';
  return `${h ?? '—'} × ${l ?? '—'} × ${w ?? '—'}${unit}`;
}

function CartTypeDimensions({ meta }: { readonly meta: Record<string, unknown> | null | undefined }) {
  if (!meta) return null;
  const cart = cartDimensionText(meta, '');
  const cell = cartDimensionText(meta, 'cell');
  return (
    <dl
      className="mt-3 grid grid-cols-2 gap-3 rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs"
      aria-label="Cart type dimensions"
    >
      <div>
        <dt className="text-faint">Cart H × L × W</dt>
        <dd className="tabular-nums text-foreground">{cart ?? 'Not set in Data Setup'}</dd>
      </div>
      <div>
        <dt className="text-faint">Cell H × L × W</dt>
        <dd className="tabular-nums text-foreground">{cell ?? 'Not set in Data Setup'}</dd>
      </div>
    </dl>
  );
}

function AddCartTypePanel({
  warehouseId,
  onCreated,
  onCancel,
}: {
  readonly warehouseId: string;
  readonly onCreated: (id: string, levels: number, columns: number) => void;
  readonly onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [levels, setLevels] = React.useState(4);
  const [columns, setColumns] = React.useState(6);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const valid =
    name.trim().length > 0 &&
    levels >= 1 &&
    levels <= MAX_CART_LEVELS &&
    columns >= 1 &&
    columns <= MAX_CART_COLUMNS;
  const submit = async () => {
    if (!valid) {
      setError(
        name.trim() ? `Levels 1–${MAX_CART_LEVELS}, columns 1–${MAX_CART_COLUMNS}` : 'Name is required',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ id: string }>('/api/lookups/mobile_cart_type', {
        method: 'POST',
        body: { name: name.trim(), warehouseId, meta: { levels, columns } },
      });
      await qc.invalidateQueries({ queryKey: ['lookups', 'mobile_cart_type'] });
      toast.success('Success', `Mobile cart type ${name.trim()} created.`);
      onCreated(res.data.id, levels, columns);
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't create the cart type"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role="group"
      aria-label="Add mobile cart type"
      className="rounded-md border border-border bg-surface-2 p-3 md:col-span-2"
    >
      <p className="mb-2 text-sm font-semibold text-foreground">New mobile cart type</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_96px_96px]">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Name
          <TextField
            autoFocus
            value={name}
            maxLength={120}
            invalid={Boolean(error) && !name.trim()}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 24-bin cart"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Levels
          <TextField
            type="number"
            min={1}
            max={MAX_CART_LEVELS}
            value={levels}
            onChange={(e) => setLevels(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Columns
          <TextField
            type="number"
            min={1}
            max={MAX_CART_COLUMNS}
            value={columns}
            onChange={(e) => setColumns(Number(e.target.value))}
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Creating…' : 'Create cart type'}
        </Button>
      </div>
    </div>
  );
}

function CartStep({
  form,
  isEdit,
  locked,
  guard,
  editId,
}: {
  readonly form: UseFormReturn<F>;
  readonly isEdit: boolean;
  readonly locked: string | null;
  readonly guard: WizardGuard;
  readonly editId: string | null;
}) {
  const warehouses = useWarehouseOptions();
  useAvailabilityCheck<F>(guard, form, {
    url: '/api/mobile-carts/availability',
    paths: ['code'],
    params: (v) =>
      v.warehouseId && v.code?.trim()
        ? { warehouseId: v.warehouseId, code: v.code.trim(), excludeId: editId ?? undefined }
        : null,
  });
  const warehouseId = form.watch('warehouseId') || null;
  // The default can resolve after mount (/api/me, warehouses): fill it once without dirtying the form.
  React.useEffect(() => {
    if (!isEdit && !form.getValues('warehouseId') && warehouses.defaultId)
      form.setValue('warehouseId', warehouses.defaultId, { shouldDirty: false });
  }, [isEdit, warehouses.defaultId, form]);
  const types = useLookups('mobile_cart_type', warehouseId);
  const canAddType = usePagePerms('settings.data_setup', ['view'] as const).view;
  const [adding, setAdding] = React.useState(false);
  const levels = Number(form.watch('levels')) || 0;
  const columns = Number(form.watch('columns')) || 0;
  // Logiwa parity: when the cart type defines levels × columns, the layout follows the type and
  // can't diverge from it (critic R2). A type without that meta leaves the layout editable.
  const typeRow = types.rows.find((r) => r.id === form.watch('cartTypeId'));
  const typeLayout = cartTypeLayout(typeRow?.meta);
  const typeLevels = typeLayout?.levels ?? null,
    typeColumns = typeLayout?.columns ?? null;
  React.useEffect(() => {
    if (locked || typeLevels === null || typeColumns === null) return;
    if (form.getValues('levels') !== typeLevels)
      form.setValue('levels', typeLevels, { shouldDirty: true, shouldValidate: true });
    if (form.getValues('columns') !== typeColumns)
      form.setValue('columns', typeColumns, { shouldDirty: true, shouldValidate: true });
  }, [locked, typeLevels, typeColumns, form]);
  const layoutReason =
    locked ?? (typeLayout ? `Set by the cart type ${typeRow?.name ?? ''} in Data Setup` : undefined);
  const applyType = (id: string | null) => {
    const row = types.rows.find((r) => r.id === id);
    const l = metaNumber(row?.meta, 'levels');
    const c = metaNumber(row?.meta, 'columns');
    if (l) form.setValue('levels', l, { shouldDirty: true, shouldValidate: true });
    if (c) form.setValue('columns', c, { shouldDirty: true, shouldValidate: true });
  };
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Identity">
        <FormGrid>
          <TextInput<F>
            name="code"
            label="Code"
            required
            maxLength={40}
            transform={(v) => v.toUpperCase()}
            placeholder="e.g. MC-05"
          />
          <ComboField<F>
            name="warehouseId"
            label="Warehouse"
            required
            options={warehouses.selectable(warehouseId)}
            disabled={isEdit}
            info={isEdit ? "A cart can't move between warehouses" : undefined}
            description={
              !isEdit && warehouses.defaultHint && warehouseId === warehouses.defaultId
                ? warehouses.defaultHint
                : undefined
            }
            onValueChange={() => form.setValue('cartTypeId', '', { shouldDirty: true })}
          />
          <ComboField<F>
            name="cartTypeId"
            label="Mobile cart type"
            required
            options={types.options}
            onValueChange={applyType}
            disabled={!warehouseId}
            placeholder={warehouseId ? 'Select a cart type' : 'Select a warehouse first'}
            emptyText="No cart types for this warehouse yet. Use Add cart type below."
            info="The type sets the default levels × columns"
          />
          {warehouseId && !adding && canAddType ? (
            <div className="-mt-3 flex items-center gap-2 text-xs text-muted md:col-span-2">
              {!types.loading && types.options.length === 0 ? (
                <span>No cart types for this warehouse yet.</span>
              ) : null}
              <Button size="sm" variant="ghost" className="text-primary" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add cart type
              </Button>
            </div>
          ) : null}
          {warehouseId && adding ? (
            <AddCartTypePanel
              warehouseId={warehouseId}
              onCancel={() => setAdding(false)}
              onCreated={(id, l, c) => {
                setAdding(false);
                form.setValue('cartTypeId', id, { shouldDirty: true, shouldValidate: true });
                if (!locked) {
                  form.setValue('levels', l, { shouldDirty: true, shouldValidate: true });
                  form.setValue('columns', c, { shouldDirty: true, shouldValidate: true });
                }
              }}
            />
          ) : null}
          <SelectField<F>
            name="operationType"
            label="Operation type"
            required
            options={enumSelectOptions(CART_OPERATION_TYPES)}
          />
          <TextInput<F>
            name="description"
            label="Description"
            maxLength={250}
            placeholder="e.g. 24-bin pick cart"
            className="md:col-span-2"
          />
        </FormGrid>
      </FormSection>
      <FormSection
        title="Layout"
        description="Each cell is named by its level letter and column: A01 is level A, column 01. Its barcode is the cart code plus that name (e.g. MC-01-A01), and cell labels print the same."
      >
        <FormGrid columns={3}>
          <NumberField<F>
            name="levels"
            label="Levels"
            required
            min={1}
            max={MAX_CART_LEVELS}
            disabled={Boolean(layoutReason)}
            info={layoutReason}
          />
          <NumberField<F>
            name="columns"
            label="Columns"
            required
            min={1}
            max={MAX_CART_COLUMNS}
            disabled={Boolean(layoutReason)}
            info={layoutReason}
          />
          <div className="flex flex-col justify-end pb-1">
            <p className="text-2xs text-faint">Cells</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">{levels * columns || 0}</p>
          </div>
        </FormGrid>
        <CartTypeDimensions meta={types.rows.find((r) => r.id === form.watch('cartTypeId'))?.meta} />
      </FormSection>
      <FormSection title="Behavior">
        <FormGrid>
          <YesNoField<F>
            name="allowMultipleJob"
            label="Allow multiple jobs"
            info="Several open jobs may share this cart"
          />
          <YesNoField<F>
            name="isDynamic"
            label="Dynamic cart"
            info="Cells are assigned to orders as they are scanned"
          />
        </FormGrid>
      </FormSection>
    </div>
  );
}

function CellStep({ form, locked }: { readonly form: UseFormReturn<F>; readonly locked: string | null }) {
  const code = form.watch('code') || 'CART';
  const levels = Number(form.watch('levels')) || 0;
  const columns = Number(form.watch('columns')) || 0;
  const cells = form.watch('cells');
  const errors = form.formState.errors.cells;
  const regenerate = React.useCallback(
    () =>
      form.setValue('cells', buildCells(code, levels, columns), { shouldDirty: true, shouldValidate: false }),
    [form, code, levels, columns],
  );
  React.useEffect(() => {
    if (!locked && cells.length !== levels * columns) regenerate();
  }, [cells.length, levels, columns, locked, regenerate]);
  const listError = errors && !Array.isArray(errors) ? (errors as { message?: string }).message : undefined;
  return (
    <div className="flex flex-col gap-5">
      {locked ? (
        <Callout variant="attention" title="Cells are locked">
          {locked}
        </Callout>
      ) : null}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-secondary">
            Cart layout · {levels} × {columns}
          </h3>
          <Button size="sm" variant="secondary" onClick={regenerate} disabled={Boolean(locked)}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Regenerate barcodes
          </Button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface-sunken/50 p-3">
          <div
            className="inline-grid gap-1.5"
            style={{ gridTemplateColumns: `2rem repeat(${Math.max(1, columns)}, minmax(4.5rem, 1fr))` }}
          >
            <span />
            {Array.from({ length: columns }, (_, c) => (
              <span key={c} className="text-center text-2xs font-medium text-faint">
                {c + 1}
              </span>
            ))}
            {Array.from({ length: levels }, (_, l) => (
              <React.Fragment key={l}>
                <span className="flex items-center text-2xs font-semibold text-faint">
                  {levelLetter(l + 1)}
                </span>
                {Array.from({ length: columns }, (_, c) => {
                  const cell = cells.find((x) => x.level === l + 1 && x.column === c + 1);
                  const color = cellColor(cellSequence(l + 1, c + 1, columns));
                  return (
                    <span
                      key={c}
                      title={`${cellDisplayName(l + 1, c + 1)} · ${color.name} · ${cell?.barcode ?? ''}`}
                      className="truncate rounded-md border border-border border-t-[3px] bg-surface px-1.5 py-1 text-center font-mono text-2xs text-body shadow-xs"
                      style={{ borderTopColor: color.hex }}
                    >
                      {cell?.barcode.slice(code.length + 1) || '—'}
                    </span>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-secondary">Cell list</h3>
        {listError ? (
          <p role="alert" className="text-xs text-danger">
            {listError}
          </p>
        ) : null}
        <div className="max-h-[40vh] overflow-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-surface-sunken text-2xs text-secondary">
              <tr>
                <th className="w-14 px-3 py-2 text-right">Seq.</th>
                <th
                  className="w-20 px-3 py-2 text-left"
                  title="Level letter + column; the end of the cell barcode"
                >
                  Cell
                </th>
                <th className="w-14 px-3 py-2 text-left">Level</th>
                <th className="w-16 px-3 py-2 text-left">Column</th>
                <th className="w-28 px-3 py-2 text-left">Color</th>
                <th className="px-3 py-2 text-left">Cell barcode *</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cells.map((cell, i) => {
                const err = Array.isArray(errors)
                  ? (errors[i] as { barcode?: { message?: string } } | undefined)?.barcode?.message
                  : undefined;
                const seq = cellSequence(cell.level, cell.column, columns);
                const color = cellColor(seq);
                return (
                  <tr key={`${cell.level}-${cell.column}`}>
                    <td className="px-3 py-1.5 text-right tabular-nums text-secondary">{seq}</td>
                    <td className="px-3 py-1.5 font-medium">{cellDisplayName(cell.level, cell.column)}</td>
                    <td className="px-3 py-1.5">{levelLetter(cell.level)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{cell.column}</td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: color.hex }}
                        />
                        {color.name}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <TextField
                        aria-label={`Barcode for cell ${cellDisplayName(cell.level, cell.column)}`}
                        value={cell.barcode}
                        maxLength={60}
                        disabled={Boolean(locked)}
                        invalid={Boolean(err)}
                        size="sm"
                        onChange={(e) =>
                          form.setValue(`cells.${i}.barcode`, e.target.value.toUpperCase(), {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                      />
                      {err ? <p className="mt-0.5 text-2xs text-danger">{err}</p> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function detailToForm(d: MobileCartDetail): F {
  return {
    code: d.code,
    warehouseId: d.warehouseId,
    description: d.description ?? '',
    cartTypeId: d.cartTypeId,
    levels: d.levels,
    columns: d.columns,
    operationType: d.operationType,
    allowMultipleJob: d.allowMultipleJob,
    isDynamic: d.isDynamic,
    cells: d.cells.map((c) => ({ level: c.level, column: c.column, barcode: c.barcode })),
  };
}

function Body({
  initial,
  detail,
  onDone,
  onCancel,
  onDirtyChange,
}: {
  readonly initial: F;
  readonly detail: MobileCartDetail | null;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  readonly onDirtyChange: (d: boolean) => void;
}) {
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const editId = detail?.id ?? null;
  const locked =
    detail?.status === 'Occupied'
      ? `Job ${detail.jobCode ?? ''} is using this cart. Layout and cells unlock when the job finishes.`
      : null;
  const guard = useWizardGuard();
  const steps = React.useMemo<readonly WizardStep<F>[]>(
    () => [
      {
        key: 'cart',
        label: 'Mobile cart',
        icon: ShoppingCart,
        schema: guard.guard(mobileCartInfoSchema, (p) => !p.startsWith('cells')),
        render: ({ form }) => {
          formRef.current = form;
          return (
            <CartStep form={form} isEdit={Boolean(editId)} locked={locked} guard={guard} editId={editId} />
          );
        },
      },
      {
        key: 'cells',
        label: 'Cell list',
        icon: Grid3x3,
        schema: guard.guard(mobileCartSchema, (p) => p.startsWith('cells')),
        render: ({ form }) => {
          formRef.current = form;
          return <CellStep form={form} locked={locked} />;
        },
      },
      // `guard` is stable for the life of the body.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ],
    [editId, locked],
  );
  const submit = async (values: F) => {
    guard.dismissBanner();
    try {
      const { data } = await apiRequest<{ code: string }>(
        editId ? `/api/mobile-carts/${editId}` : '/api/mobile-carts',
        { method: editId ? 'PATCH' : 'POST', body: { ...values, version: detail?.version } },
      );
      toast.success(
        'Success',
        editId
          ? `Mobile cart ${data.code} updated.`
          : `Mobile cart ${data.code} created with ${values.cells.length} cells.`,
      );
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      const routed = guard.handleServerError(error, values);
      if (!routed && formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the mobile cart", apiErrorMessage(error), { duration: ERROR_TOAST_MS });
      throw error;
    }
  };
  return (
    <div ref={guard.rootRef} className="flex flex-col gap-3">
      {guard.banner && !conflict ? (
        <Callout variant="error" title="Couldn't save the mobile cart" onDismiss={guard.dismissBanner}>
          {guard.banner}
        </Callout>
      ) : null}
      {conflict ? (
        <Callout
          variant="attention"
          title="This record changed since you opened it"
          action={
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          Someone else saved this cart. Reload to see their changes.
        </Callout>
      ) : null}
      <Wizard<F>
        steps={steps}
        variant="drawer"
        mode={editId ? 'free' : 'linear'}
        defaultValues={initial}
        draftScope={false}
        guardUnsaved={false}
        onDirtyChange={onDirtyChange}
        submitLabel={editId ? 'Save' : 'Create mobile cart'}
        onCancel={onCancel}
        onComplete={submit}
      />
    </div>
  );
}

export function MobileCartWizardDrawer({
  open,
  onOpenChange,
  editId,
  defaultWarehouseId,
  onSaved,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly editId: string | null;
  readonly defaultWarehouseId: string | null;
  readonly onSaved: () => void;
}) {
  const [dirty, setDirty] = React.useState(false);
  const detail = useApiQuery<MobileCartDetail>(
    ['mobile-cart', editId ?? ''],
    open && editId ? `/api/mobile-carts/${editId}` : null,
    { staleTime: 0 },
  );
  const close = () => {
    setDirty(false);
    onOpenChange(false);
  };
  const initial = editId
    ? detail.data
      ? detailToForm(detail.data.data)
      : null
    : { ...MOBILE_CART_DEFAULTS, warehouseId: defaultWarehouseId ?? '' };
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(o) : close())}
      dirty={dirty}
      width={60}
      bodyClassName="pb-0"
      title={editId ? `Edit mobile cart ${detail.data?.data.code ?? ''}`.trim() : 'Create mobile cart'}
      description={
        editId
          ? 'Both steps are editable; Save applies them.'
          : 'Describe the cart, then review its generated cell barcodes.'
      }
    >
      {editId && detail.isError ? (
        <EmptyState
          title="Couldn't load this mobile cart"
          description={detail.error.message}
          action={<Button onClick={() => void detail.refetch()}>Retry</Button>}
        />
      ) : !initial ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <Body
          key={`${editId ?? 'new'}-${detail.dataUpdatedAt}`}
          initial={initial}
          detail={editId ? (detail.data?.data ?? null) : null}
          onDirtyChange={setDirty}
          onCancel={close}
          onDone={() => {
            setDirty(false);
            onSaved();
            onOpenChange(false);
          }}
        />
      )}
    </Drawer>
  );
}
