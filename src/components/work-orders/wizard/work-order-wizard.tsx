"use client";

/**
 * Create / Edit Work Order drawer (Logiwa parity + more):
 *   Step 0  Operation type card: Kitting (create only, skipped when prefilled from Kit Inventory)
 *   1.General → 2.Kit → 3.Advanced → 4.Other Info, pill stepper; Cancel/Next · Back/Next · Back/Save.
 * Every Next validates its step with inline errors and focuses the first one; Save validates
 * everything and jumps to the first step with an error. Stale edits raise 409 with Reload.
 * The unsaved-changes guard uses Logiwa's exact copy with No / Leave.
 */
import * as React from "react";
import { AlertTriangle, Boxes, ChevronRight, RefreshCw } from "lucide-react";
import { uploadFile } from "@/components/shared/upload-file";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { WizardPills, type StepMeta } from "@/components/ui/wizard";
import { apiFetch, isApiError } from "@/lib/api-client";
import { useCan, useMe } from "@/lib/permissions-client";
import { useApiQuery } from "@/lib/query-client";
import { useBeforeUnload, useNavigationGuard } from "@/lib/use-unsaved-changes";
import { WO_UNSAVED_DESCRIPTION, WO_UNSAVED_TITLE } from "@/lib/grid-defs/work-orders/work-order-model";
import { errorMessage, useInvalidateWorkOrders, WO_P, type KitDetail, type WorkOrderDetail, type WorkOrderRow } from "../wo-client";
import { focusFirst } from "../wo-ui";
import { ComponentSourceDialog } from "./component-source-dialog";
import { EMPTY_FORM, EMPTY_SOURCE, errorsForStep, firstErrorKey, formsEqual, stepOfField, validateForm, WIZARD_STEPS, type FormErrors, type WizardStepKey, type WoForm } from "./wo-form";
import { AdvancedStep, GeneralStep, KitStep, OtherStep } from "./wo-wizard-steps";

export interface WorkOrderPrefill {
  readonly warehouseId: string;
  readonly clientId: string;
  readonly kitProductId: string;
  readonly kitSku: string;
  readonly requestedQty?: number;
}

export interface WorkOrderWizardProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: "create" | "edit";
  readonly workOrderId?: string | null;
  readonly prefill?: WorkOrderPrefill | null;
  readonly onSaved?: (row: WorkOrderRow) => void;
}

export function WorkOrderWizard(props: WorkOrderWizardProps) {
  const [dirty, setDirty] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  useBeforeUnload(props.open && dirty);
  const nav = useNavigationGuard(props.open && dirty);
  const request = (next: boolean) => {
    if (!next && dirty) { setConfirm(true); return; }
    props.onOpenChange(next);
  };
  const leave = () => {
    setConfirm(false);
    setDirty(false);
    props.onOpenChange(false);
    if (nav.pendingHref) nav.proceed();
  };
  return (
    <>
      <Drawer open={props.open} onOpenChange={request} width={60} title={props.mode === "create" ? "Create Work Order" : "Edit Work Order"}>
        {props.open ? <Body key={`${props.mode}-${props.workOrderId ?? ""}-${props.prefill?.kitProductId ?? ""}`} {...props} onDirty={setDirty} onCancel={() => request(false)} /> : null}
      </Drawer>
      <ConfirmDialog
        open={confirm || nav.pendingHref !== null}
        onOpenChange={(o) => { if (!o) { setConfirm(false); nav.cancel(); } }}
        variant="danger" icon={AlertTriangle} title={WO_UNSAVED_TITLE} description={WO_UNSAVED_DESCRIPTION}
        cancelLabel="No" confirmLabel="Leave" onConfirm={leave}
      />
    </>
  );
}

function fromDetail(d: WorkOrderDetail): WoForm {
  const wo = d.workOrder;
  const toDate = (s: string | null) => (s ? new Date(s) : null);
  return {
    warehouseId: wo.warehouseId, clientId: wo.clientId, code: wo.code, type: wo.type, extraNote: wo.extraNote ?? "", buildFor: wo.buildFor,
    shipmentOrderId: wo.shipmentOrderId, shipmentOrderCode: wo.shipmentOrderCode, kitProductId: wo.kitProductId, kitSku: wo.kitSku,
    requestedQty: wo.requestedQty, kittingInstructions: wo.kittingInstructions ?? "",
    sources: Object.fromEntries(d.components.map((c) => [c.componentProductId, {
      locationId: c.locationId, locationCode: c.locationCode, lpId: c.lpId, lpNumber: c.lpNumber, lotNumber: c.lotNumber, expiryDate: c.expiryDate, productionDate: c.productionDate,
    }])),
    plannedStartAt: toDate(wo.plannedStartAt), plannedFinishAt: toDate(wo.plannedFinishAt), actualStartAt: toDate(wo.actualStartAt), actualFinishAt: toDate(wo.actualFinishAt),
    customFields: wo.customFields,
  };
}

type Phase = "operation" | WizardStepKey;

function Body({ mode, workOrderId, prefill, onOpenChange, onSaved, onDirty, onCancel }: WorkOrderWizardProps & { readonly onDirty: (d: boolean) => void; readonly onCancel: () => void }) {
  const me = useMe();
  const isNew = mode === "create";
  const canManageFields = useCan(WO_P.customFields).allowed;
  const invalidate = useInvalidateWorkOrders();
  const detail = useApiQuery<WorkOrderDetail>(["work-order", workOrderId ?? ""], isNew ? null : `/api/work-orders/${encodeURIComponent(workOrderId ?? "")}`, { staleTime: 0 });
  const nextCode = useApiQuery<{ code: string }>(["wo-next-code"], isNew ? "/api/work-orders/next-code" : null, { staleTime: 0 });
  const onlyWarehouse = me.data?.data.contextOptions.warehouses.length === 1 ? me.data.data.contextOptions.warehouses[0]?.id ?? null : null;
  const contextWarehouse = me.data?.data.context.warehouseId ?? null;

  const [phase, setPhase] = React.useState<Phase>(isNew && !prefill ? "operation" : "general");
  const [form, setForm] = React.useState<WoForm | null>(isNew ? {
    ...EMPTY_FORM,
    ...(prefill ? { warehouseId: prefill.warehouseId, clientId: prefill.clientId, kitProductId: prefill.kitProductId, kitSku: prefill.kitSku, requestedQty: prefill.requestedQty ?? 1 } : {}),
  } : null);
  const [initial, setInitial] = React.useState<WoForm | null>(form);
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [visited, setVisited] = React.useState<ReadonlySet<WizardStepKey>>(new Set(["general"]));
  const [files, setFiles] = React.useState<readonly File[]>([]);
  const [sourceFor, setSourceFor] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Seed: code suggestion + default warehouse (create), or the record (edit).
  React.useEffect(() => {
    const code = nextCode.data?.data.code;
    if (!isNew || !code) return;
    setForm((f) => (f && !f.code ? { ...f, code } : f));
    setInitial((f) => (f && !f.code ? { ...f, code } : f));
  }, [isNew, nextCode.data]);
  React.useEffect(() => {
    const wh = contextWarehouse ?? onlyWarehouse;
    if (!isNew || !wh) return;
    setForm((f) => (f && !f.warehouseId ? { ...f, warehouseId: wh } : f));
    setInitial((f) => (f && !f.warehouseId ? { ...f, warehouseId: wh } : f));
  }, [isNew, contextWarehouse, onlyWarehouse]);
  React.useEffect(() => {
    const d = detail.data?.data;
    if (isNew || !d || form) return;
    const f = fromDetail(d);
    setForm(f);
    setInitial(f);
  }, [isNew, detail.data, form]);

  const dirty = Boolean(form && initial && (!formsEqual(form, initial) || files.length > 0));
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const kitQuery = useApiQuery<KitDetail>(["kit", form?.kitProductId ?? "", form?.warehouseId ?? ""], form?.kitProductId ? `/api/kits/${encodeURIComponent(form.kitProductId)}` : null, {
    query: { warehouseId: form?.warehouseId ?? "" },
  });
  const kit = form?.kitProductId ? kitQuery.data?.data ?? null : null;

  if (!form) {
    if (detail.error) return <Callout variant="error" title="Work order not available">{detail.error.message}</Callout>;
    return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-72" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-24 w-full" /></div>;
  }

  const record = detail.data?.data.workOrder;
  const status = record?.status ?? "Open";
  const lockCore = !isNew && status !== "Open";
  const lockOrg = Boolean(prefill);
  const components = (kit?.components ?? []).map((c) => ({ productId: c.productId, sku: c.sku }));

  const update = (patch: Partial<WoForm>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    const keys = Object.keys(patch);
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.some((p) => k === p || (p === "sources" && k.startsWith("components"))))));
  };

  const validateStep = (step: WizardStepKey): boolean => {
    const res = validateForm(form, components);
    const stepErrors = res.ok ? {} : errorsForStep(res.errors, step);
    if (step === "kit" && form.kitProductId && kitQuery.isPending) return false;
    setErrors((e) => ({ ...Object.fromEntries(Object.entries(e).filter(([k]) => stepOfField(k) !== step)), ...stepErrors }));
    const first = firstErrorKey(stepErrors);
    if (first) focusFirst(rootRef.current, [first]);
    return !first;
  };

  const order = WIZARD_STEPS.map((s) => s.key);
  const stepIndex = phase === "operation" ? -1 : order.indexOf(phase);
  const goTo = (target: WizardStepKey) => {
    const ti = order.indexOf(target);
    if (ti > stepIndex) {
      for (let i = Math.max(0, stepIndex); i < ti; i += 1) {
        const k = order[i];
        if (k && !validateStep(k)) { setPhase(k); return; }
      }
    }
    setVisited((v) => new Set([...v, target]));
    setPhase(target);
  };

  const save = async () => {
    const res = validateForm(form, components);
    if (!res.ok) {
      setErrors(res.errors);
      const first = firstErrorKey(res.errors);
      if (first) { setPhase(stepOfField(first)); focusFirst(rootRef.current, [first]); }
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      const saved = await apiFetch<WorkOrderRow>(isNew ? "/api/work-orders" : `/api/work-orders/${encodeURIComponent(record?.id ?? "")}`, {
        method: isNew ? "POST" : "PATCH", body: isNew ? res.input : { version: record?.version, data: res.input },
      });
      let failedUploads = 0;
      for (const file of files) {
        try { await uploadFile(file, "attachment", { entityType: "work_order", entityId: saved.id }); } catch { failedUploads += 1; }
      }
      toast.success("Success", isNew ? `You have successfully created work order ${saved.code}.` : `Work order ${saved.code} is updated.`);
      if (failedUploads) toast.warning("Documents", `${failedUploads} document${failedUploads === 1 ? "" : "s"} could not be uploaded. Add them from the work order details.`);
      setFiles([]);
      setInitial(form);
      onDirty(false);
      await invalidate();
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") { setConflict(true); return; }
      if (isApiError(error) && Object.keys(error.fieldErrors).length) {
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(error.fieldErrors)) {
          const m = /^components\.(\d+)\./.exec(k);
          const key = m ? `components.${components[Number(m[1])]?.productId ?? ""}` : k;
          if (v[0]) mapped[key] = v[0];
        }
        setErrors(mapped);
        const first = firstErrorKey(mapped);
        if (first) { setPhase(stepOfField(first)); focusFirst(rootRef.current, [first]); }
      }
      setServerError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const errorSteps = new Set(Object.keys(errors).map(stepOfField));
  const steps: StepMeta[] = WIZARD_STEPS.map((s, i) => ({
    key: s.key, label: `${i + 1}.${s.label}`,
    status: errorSteps.has(s.key) ? "attention" : s.key === phase ? "active" : i < stepIndex || visited.has(s.key) ? "complete" : "upcoming",
    clickable: phase !== "operation",
  }));
  const isLast = phase === "other";
  const sourceComponent = sourceFor && kit ? kit.components.find((c) => c.productId === sourceFor) : undefined;

  if (phase === "operation") {
    return (
      <div className="flex min-h-full flex-col gap-4">
        <p className="text-[13px] text-secondary">Choose the operation type of the new work order.</p>
        <button type="button" onClick={() => setPhase("general")} autoFocus
          className="group flex items-center gap-4 rounded-xl border border-primary/40 bg-primary-soft/50 p-4 text-left shadow-xs outline-none transition-all hover:border-primary hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary/30">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-white"><Boxes className="h-5 w-5" aria-hidden /></span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[14px] font-semibold text-foreground">Kitting</span>
            <span className="text-[12px] text-secondary">Create a work order for kitting operations of kit-to-stock products</span>
          </span>
          <ChevronRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden />
        </button>
        <div className="mt-auto flex justify-start border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex min-h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <WizardPills steps={steps} onSelect={(k) => goTo(k as WizardStepKey)} />
        {record ? <StatusPill status={status} domain="workOrder" /> : null}
      </div>
      {lockCore ? <Callout variant="info" title={`This work order is ${status}`}>Warehouse, client, type, kit, quantity and component sources are locked. Notes, instructions, dates and custom fields can still change.</Callout> : null}
      {conflict ? (
        <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" variant="secondary" onClick={() => { setConflict(false); setForm(null); setInitial(null); void detail.refetch(); }}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Reload</Button>}>
          Someone else saved this work order. Reload to see the latest version, then repeat your change.
        </Callout>
      ) : null}
      {serverError ? <Callout variant="error" title="Not saved">{serverError}</Callout> : null}

      <form noValidate className="flex flex-1 flex-col gap-4" onSubmit={(e) => {
        e.preventDefault();
        if (isLast) void save();
        else { const next = order[stepIndex + 1]; if (next) goTo(next); }
      }}>
        {phase === "general" ? <GeneralStep form={form} errors={errors} onChange={update} lockOrg={lockOrg} lockCore={lockCore} /> : null}
        {phase === "kit" ? <KitStep form={form} errors={errors} onChange={update} kit={kit} kitLoading={Boolean(form.kitProductId) && kitQuery.isPending} lockCore={lockCore} onEditSource={setSourceFor} /> : null}
        {phase === "advanced" ? <AdvancedStep form={form} errors={errors} onChange={update} files={files} onFiles={setFiles} /> : null}
        {phase === "other" ? <OtherStep form={form} onChange={update} canManage={canManageFields} /> : null}

        <div className="sticky bottom-0 mt-auto flex items-center justify-between gap-2 border-t border-border bg-surface pt-3 pb-1">
          {stepIndex === 0 ? <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button> : (
            <Button type="button" variant="secondary" onClick={() => { const prev = order[stepIndex - 1]; if (prev) setPhase(prev); }} disabled={saving}>Back</Button>
          )}
          <div className="flex items-center gap-2">
            {stepIndex !== 0 ? <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button> : null}
            {isLast ? (
              <DisabledReason reason={saving ? "Saving…" : null}>
                <Button type="submit" variant="primary" disabled={saving} aria-busy={saving}>
                  {saving ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}
                  Save
                </Button>
              </DisabledReason>
            ) : <Button type="submit" variant="primary">Next</Button>}
          </div>
        </div>
      </form>

      <ComponentSourceDialog
        open={Boolean(sourceComponent)}
        onOpenChange={(o) => { if (!o) setSourceFor(null); }}
        component={sourceComponent ? { productId: sourceComponent.productId, sku: sourceComponent.sku, name: sourceComponent.name, totalQty: sourceComponent.bomQty * (form.requestedQty ?? 0) } : null}
        warehouseId={form.warehouseId}
        clientId={form.clientId}
        value={sourceFor ? form.sources[sourceFor] ?? EMPTY_SOURCE : EMPTY_SOURCE}
        onChange={(v) => { if (sourceFor) update({ sources: { ...form.sources, [sourceFor]: v } }); }}
      />
    </div>
  );
}

