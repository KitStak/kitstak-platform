"use client";

/**
 * Create / Edit Mobile Cart drawer: 1. Mobile cart (code, warehouse, description, cart type
 * from Data Setup, levels × columns, operation) · 2. Cell list (auto-generated barcodes, a
 * live cart layout and per-cell editing). Cells lock while an open job holds the cart.
 */
import * as React from "react";
import { Grid3x3, RefreshCw, ShoppingCart } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { buildCells, CART_OPERATION_TYPES, MAX_CART_COLUMNS, MAX_CART_LEVELS, MOBILE_CART_DEFAULTS, mobileCartInfoSchema, mobileCartSchema, type MobileCartInput } from "@/lib/grid-defs/facility/mobile-carts";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormGrid, FormSection } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { Wizard, type WizardStep } from "@/components/ui/wizard";
import { ComboField, enumSelectOptions, NumberField, SelectField, TextInput, YesNoField } from "@/components/facility/form-controls";
import { useLookups, useWarehouseOptions, apiErrorMessage } from "@/components/facility/facility-shared";
import type { MobileCartDetail } from "@/server/repositories/mobile-carts";

type F = MobileCartInput;

const levelLetter = (level: number) => String.fromCharCode(64 + level);
const metaNumber = (meta: Record<string, unknown> | null | undefined, key: string): number | null => {
  const v = meta?.[key];
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
};

function CartStep({ form, isEdit, locked }: { readonly form: UseFormReturn<F>; readonly isEdit: boolean; readonly locked: string | null }) {
  const warehouses = useWarehouseOptions();
  const warehouseId = form.watch("warehouseId") || null;
  const types = useLookups("mobile_cart_type", warehouseId);
  const levels = Number(form.watch("levels")) || 0;
  const columns = Number(form.watch("columns")) || 0;
  const applyType = (id: string | null) => {
    const row = types.rows.find((r) => r.id === id);
    const l = metaNumber(row?.meta, "levels");
    const c = metaNumber(row?.meta, "columns");
    if (l) form.setValue("levels", l, { shouldDirty: true, shouldValidate: true });
    if (c) form.setValue("columns", c, { shouldDirty: true, shouldValidate: true });
  };
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Mobile cart">
        <FormGrid>
          <TextInput<F> name="code" label="Code" required maxLength={40} transform={(v) => v.toUpperCase()} placeholder="e.g. MC-05" />
          <ComboField<F> name="warehouseId" label="Warehouse" required options={warehouses.options} disabled={isEdit} info={isEdit ? "A cart can't move between warehouses" : undefined}
            onValueChange={() => form.setValue("cartTypeId", "", { shouldDirty: true })} />
          <ComboField<F> name="cartTypeId" label="Mobile cart type" required options={types.options} onValueChange={applyType} disabled={!warehouseId}
            placeholder={warehouseId ? "Select a cart type" : "Select a warehouse first"} emptyText="No cart types yet. Add one in Data Setup → Mobile Cart Type." info="The type sets the default levels × columns" />
          <SelectField<F> name="operationType" label="Operation type" required options={enumSelectOptions(CART_OPERATION_TYPES)} />
          <TextInput<F> name="description" label="Description" maxLength={250} placeholder="e.g. 24-bin pick cart" className="md:col-span-2" />
        </FormGrid>
      </FormSection>
      <FormSection title="Layout" description="Cells are generated level by level (A, B, C…) and column by column.">
        <FormGrid columns={3}>
          <NumberField<F> name="levels" label="Levels" required min={1} max={MAX_CART_LEVELS} disabled={Boolean(locked)} info={locked ?? undefined} />
          <NumberField<F> name="columns" label="Columns" required min={1} max={MAX_CART_COLUMNS} disabled={Boolean(locked)} info={locked ?? undefined} />
          <div className="flex flex-col justify-end pb-1">
            <p className="text-[11px] text-faint">Cells</p>
            <p className="text-[20px] font-semibold tabular-nums text-foreground">{levels * columns || 0}</p>
          </div>
        </FormGrid>
      </FormSection>
      <FormSection title="Behavior">
        <FormGrid>
          <YesNoField<F> name="allowMultipleJob" label="Allow multiple jobs" info="Several open jobs may share this cart" />
          <YesNoField<F> name="isDynamic" label="Dynamic cart" info="Cells are assigned to orders as they are scanned" />
        </FormGrid>
      </FormSection>
    </div>
  );
}

function CellStep({ form, locked }: { readonly form: UseFormReturn<F>; readonly locked: string | null }) {
  const code = form.watch("code") || "CART";
  const levels = Number(form.watch("levels")) || 0;
  const columns = Number(form.watch("columns")) || 0;
  const cells = form.watch("cells");
  const errors = form.formState.errors.cells;
  const regenerate = React.useCallback(() => form.setValue("cells", buildCells(code, levels, columns), { shouldDirty: true, shouldValidate: false }), [form, code, levels, columns]);
  React.useEffect(() => {
    if (!locked && cells.length !== levels * columns) regenerate();
  }, [cells.length, levels, columns, locked, regenerate]);
  const listError = errors && !Array.isArray(errors) ? (errors as { message?: string }).message : undefined;
  return (
    <div className="flex flex-col gap-5">
      {locked ? <Callout variant="attention" title="Cells are locked">{locked}</Callout> : null}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-secondary">Cart layout · {levels} × {columns}</h3>
          <Button size="sm" variant="secondary" onClick={regenerate} disabled={Boolean(locked)}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Regenerate barcodes</Button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface-sunken/50 p-3">
          <div className="inline-grid gap-1.5" style={{ gridTemplateColumns: `2rem repeat(${Math.max(1, columns)}, minmax(4.5rem, 1fr))` }}>
            <span />
            {Array.from({ length: columns }, (_, c) => <span key={c} className="text-center text-[11px] font-medium text-faint">{c + 1}</span>)}
            {Array.from({ length: levels }, (_, l) => (
              <React.Fragment key={l}>
                <span className="flex items-center text-[11px] font-semibold text-faint">{levelLetter(l + 1)}</span>
                {Array.from({ length: columns }, (_, c) => {
                  const cell = cells.find((x) => x.level === l + 1 && x.column === c + 1);
                  return (
                    <span key={c} title={cell?.barcode} className="truncate rounded-md border border-border bg-surface px-1.5 py-1 text-center font-mono text-[10px] text-body shadow-xs">
                      {cell?.barcode.slice(code.length + 1) || "—"}
                    </span>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-secondary">Cell list</h3>
        {listError ? <p role="alert" className="text-[12px] text-danger">{listError}</p> : null}
        <div className="max-h-[40vh] overflow-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-[1] bg-surface-sunken text-[11px] uppercase text-secondary">
              <tr><th className="w-20 px-3 py-2 text-left">Level</th><th className="w-20 px-3 py-2 text-left">Column</th><th className="px-3 py-2 text-left">Cell barcode *</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cells.map((cell, i) => {
                const err = Array.isArray(errors) ? (errors[i] as { barcode?: { message?: string } } | undefined)?.barcode?.message : undefined;
                return (
                  <tr key={`${cell.level}-${cell.column}`}>
                    <td className="px-3 py-1.5 font-medium">{levelLetter(cell.level)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{cell.column}</td>
                    <td className="px-3 py-1.5">
                      <TextField aria-label={`Barcode for cell ${levelLetter(cell.level)}${cell.column}`} value={cell.barcode} maxLength={60} disabled={Boolean(locked)} invalid={Boolean(err)} size="sm"
                        onChange={(e) => form.setValue(`cells.${i}.barcode`, e.target.value.toUpperCase(), { shouldDirty: true, shouldValidate: true })} />
                      {err ? <p className="mt-0.5 text-[11px] text-danger">{err}</p> : null}
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
    code: d.code, warehouseId: d.warehouseId, description: d.description ?? "", cartTypeId: d.cartTypeId, levels: d.levels, columns: d.columns,
    operationType: d.operationType, allowMultipleJob: d.allowMultipleJob, isDynamic: d.isDynamic,
    cells: d.cells.map((c) => ({ level: c.level, column: c.column, barcode: c.barcode })),
  };
}

function Body({ initial, detail, onDone, onCancel, onDirtyChange }: { readonly initial: F; readonly detail: MobileCartDetail | null; readonly onDone: () => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void }) {
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const editId = detail?.id ?? null;
  const locked = detail?.status === "Occupied" ? `Job ${detail.jobCode ?? ""} is using this cart. Layout and cells unlock when the job finishes.` : null;
  const steps = React.useMemo<readonly WizardStep<F>[]>(() => [
    { key: "cart", label: "Mobile cart", icon: ShoppingCart, schema: mobileCartInfoSchema, render: ({ form }) => { formRef.current = form; return <CartStep form={form} isEdit={Boolean(editId)} locked={locked} />; } },
    { key: "cells", label: "Cell list", icon: Grid3x3, schema: mobileCartSchema, render: ({ form }) => { formRef.current = form; return <CellStep form={form} locked={locked} />; } },
  ], [editId, locked]);
  const submit = async (values: F) => {
    try {
      const { data } = await apiRequest<{ code: string }>(editId ? `/api/mobile-carts/${editId}` : "/api/mobile-carts", { method: editId ? "PATCH" : "POST", body: { ...values, version: detail?.version } });
      toast.success("Success", editId ? `Mobile cart ${data.code} updated.` : `Mobile cart ${data.code} created with ${values.cells.length} cells.`);
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      if (formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the mobile cart", apiErrorMessage(error));
      throw error;
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this cart. Reload to see their changes.</Callout> : null}
      <Wizard<F> steps={steps} variant="drawer" mode={editId ? "free" : "linear"} defaultValues={initial} draftScope={false} guardUnsaved={false} onDirtyChange={onDirtyChange}
        submitLabel={editId ? "Save" : "Create mobile cart"} onCancel={onCancel} onComplete={submit} />
    </div>
  );
}

export function MobileCartWizardDrawer({ open, onOpenChange, editId, defaultWarehouseId, onSaved }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly editId: string | null; readonly defaultWarehouseId: string | null; readonly onSaved: () => void }) {
  const [dirty, setDirty] = React.useState(false);
  const detail = useApiQuery<MobileCartDetail>(["mobile-cart", editId ?? ""], open && editId ? `/api/mobile-carts/${editId}` : null, { staleTime: 0 });
  const close = () => { setDirty(false); onOpenChange(false); };
  const initial = editId ? (detail.data ? detailToForm(detail.data.data) : null) : { ...MOBILE_CART_DEFAULTS, warehouseId: defaultWarehouseId ?? "" };
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} dirty={dirty} width={60}
      title={editId ? `Edit mobile cart ${detail.data?.data.code ?? ""}`.trim() : "Create mobile cart"}
      description={editId ? "Both steps are editable; Save applies them." : "Describe the cart, then review its generated cell barcodes."}>
      {editId && detail.isError ? (
        <EmptyState title="Couldn't load this mobile cart" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
      ) : !initial ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <Body key={`${editId ?? "new"}-${detail.dataUpdatedAt}`} initial={initial} detail={editId ? detail.data?.data ?? null : null} onDirtyChange={setDirty} onCancel={close}
          onDone={() => { setDirty(false); onSaved(); onOpenChange(false); }} />
      )}
    </Drawer>
  );
}

