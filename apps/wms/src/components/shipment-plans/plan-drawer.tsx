"use client";

/**
 * Create / Edit Shipment Plan drawer (Logiwa: 1.General · 2.Others · 3.Orders). Create is
 * linear (each step validates on Next and can go Back); edit is free (every tab clickable,
 * Save from any tab). Server field errors land inline; a stale edit shows Reload (409).
 */
import * as React from "react";
import type { UseFormReturn } from "react-hook-form";
import { ClipboardList, Info, Package } from "lucide-react";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { useMe, usePermissionSet } from "@/lib/permissions-client";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { Wizard, type WizardStep } from "@/components/ui/wizard";
import { GeneralStep, OrdersStep, OthersStep, fetchEstimate, usePlanOptions, type Estimate } from "./plan-drawer-steps";
import { detailToForm, emptyPlanForm, formToBody, generalStepSchema, ordersStepSchema, othersStepSchema, statusChoices, type PlanFormValues } from "./plan-form-model";
import { PLAN_PERMS, planDetailKey, useInvalidatePlans, type PlanDetail, type PlanRow } from "./plans-client";

type F = PlanFormValues;

function Body({ initial, detail, onDone, onCancel, onDirtyChange }: { readonly initial: F; readonly detail: PlanDetail | null; readonly onDone: (row: PlanRow) => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void }) {
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [estimate, setEstimate] = React.useState<Estimate | null>(null);
  const { permissions } = usePermissionSet();
  const editId = detail?.id ?? null;
  const statuses = statusChoices(editId ? "edit" : "create", initial.status, detail?.nextStatuses ?? []);
  const statusKey = statuses.join("|");

  // Seed the estimate for edits so "totals follow orders" compares against real numbers.
  React.useEffect(() => {
    if (initial.orders.length === 0) return;
    let live = true;
    fetchEstimate(initial.orders.map((o) => o.id)).then((e) => { if (live) setEstimate(e); }).catch(() => undefined);
    return () => { live = false; };
  }, [initial.orders]);

  const applyEstimate = () => {
    const form = formRef.current;
    if (!form || !estimate) return;
    form.setValue("expectedTotalWeight", estimate.weightLb, { shouldDirty: true });
    form.setValue("expectedTotalVolume", estimate.volumeFt3, { shouldDirty: true });
  };

  const steps = React.useMemo<readonly WizardStep<F>[]>(() => [
    { key: "general", label: "General", icon: Info, schema: generalStepSchema, render: ({ form }) => { formRef.current = form; return <GeneralStep form={form} statuses={statuses} isEdit={Boolean(editId)} lastEstimate={estimate} onApplyEstimate={applyEstimate} />; } },
    { key: "others", label: "Others", icon: ClipboardList, isOptional: true, description: "Who receives the load, plus your custom fields.", schema: othersStepSchema, render: ({ form }) => { formRef.current = form; return <OthersStep form={form} canManageFields={permissions.has(PLAN_PERMS.customFields)} />; } },
    { key: "orders", label: "Orders", icon: Package, description: "Orders loaded on this truck.", schema: ordersStepSchema, render: ({ form }) => { formRef.current = form; return <OrdersStep form={form} planId={editId} lastEstimate={estimate} onEstimate={setEstimate} />; } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [editId, estimate, statusKey, permissions]);

  const [emptyConfirm, setEmptyConfirm] = React.useState<((ok: boolean) => void) | null>(null);

  const submit = async (values: F) => {
    if (values.orders.length === 0) {
      // A plan without orders can't be loaded, picked or shipped: make the user confirm it on purpose.
      const ok = await new Promise<boolean>((resolve) => setEmptyConfirm(() => resolve));
      setEmptyConfirm(null);
      if (!ok) throw new Error("Save cancelled");
    }
    try {
      const { data } = await apiRequest<PlanRow>(editId ? `/api/shipment-plans/${encodeURIComponent(editId)}` : "/api/shipment-plans", { method: editId ? "PATCH" : "POST", body: formToBody(values, detail?.version) });
      toast.success("Success", editId ? `Shipment plan ${data.code} updated.` : `Shipment plan ${data.code} created with ${data.orderCount} ${data.orderCount === 1 ? "order" : "orders"}.`);
      onDone(data);
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      if (formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the shipment plan", isApiError(error) ? error.message : "Something went wrong");
      throw error;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {conflict ? (
        <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>
          Someone else saved this plan. Reload to see their changes before editing.
        </Callout>
      ) : null}
      <Wizard<F> steps={steps} variant="drawer" mode={editId ? "free" : "linear"} defaultValues={initial} draftScope={false} guardUnsaved={false} onDirtyChange={onDirtyChange}
        submitLabel={editId ? "Save" : "Save plan"} onCancel={onCancel} onComplete={submit} />
      <ConfirmDialog open={emptyConfirm !== null} onOpenChange={(o) => { if (!o) emptyConfirm?.(false); }} variant="attention"
        title="Save a plan with no orders?"
        description="This plan has no orders yet, so it can't be picked, loaded or shipped. You can add orders later from the plan page or with Edit."
        cancelLabel="Add orders first" confirmLabel="Save without orders" onConfirm={() => emptyConfirm?.(true)} />
    </div>
  );
}

export interface PlanDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Plan id to edit; null creates. */
  readonly editId: string | null;
  readonly onSaved?: (row: PlanRow) => void;
}

export function PlanDrawer({ open, onOpenChange, editId, onSaved }: PlanDrawerProps) {
  const [dirty, setDirty] = React.useState(false);
  const invalidate = useInvalidatePlans();
  const me = useMe();
  const defaultWarehouse = me.data?.data.contextOptions.warehouses.length === 1 ? me.data.data.contextOptions.warehouses[0]?.id ?? null : null;
  const detail = useApiQuery<PlanDetail>(planDetailKey(editId ?? ""), open && editId ? `/api/shipment-plans/${encodeURIComponent(editId)}` : null, { staleTime: 0 });
  const options = usePlanOptions(null, null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const close = () => { setDirty(false); setConfirmDiscard(false); onOpenChange(false); };
  /** Cancel button: same unsaved-changes guard as Esc / the close icon. */
  const cancel = () => (dirty ? setConfirmDiscard(true) : close());
  const d = detail.data?.data ?? null;
  const initial: F | null = editId ? (d ? detailToForm(d) : null) : options.data ? emptyPlanForm(options.data.data.nextCode, defaultWarehouse) : null;
  const editBlocked = d?.editBlockedReason ?? null;
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} dirty={dirty} width={60}
      // The wizard footer is sticky inside the body: no bottom padding under it, so nothing scrolls below the bar.
      bodyClassName="pb-0 [&_.sticky]:pb-4"
      title={editId ? `Edit shipment plan ${d?.code ?? ""}`.trim() : "Create shipment plan"}
      description={editId ? "Every tab is editable; Save applies all of them." : "General details, then the consignee, then the orders on the truck."}>
      {(editId && detail.isError) || (!editId && options.isError) ? (
        <EmptyState title="Couldn't load the shipment plan" description={(detail.error ?? options.error)?.message} action={<Button onClick={() => void (editId ? detail.refetch() : options.refetch())}>Retry</Button>} />
      ) : editBlocked ? (
        <EmptyState title={editBlocked} description="Shipped and cancelled plans are read-only. Open the plan to see its orders and timeline." action={<Button onClick={close}>Close</Button>} />
      ) : !initial ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-72 w-full" /></div>
      ) : (
        <Body key={`${editId ?? "new"}-${detail.dataUpdatedAt}`} initial={initial} detail={d} onDirtyChange={setDirty} onCancel={cancel}
          onDone={(row) => { setDirty(false); invalidate(); onSaved?.(row); onOpenChange(false); }} />
      )}
      <ConfirmDialog open={confirmDiscard} onOpenChange={setConfirmDiscard} variant="danger" title="Discard unsaved changes?"
        description="Your changes to this shipment plan haven't been saved. Leaving now discards them." cancelLabel="Keep editing" confirmLabel="Discard" onConfirm={close} />
    </Drawer>
  );
}
