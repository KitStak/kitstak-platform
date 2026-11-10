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
import { useRouter } from "next/navigation";
import { AlertTriangle, Boxes, ChevronRight, RefreshCw } from "lucide-react";
import { uploadFile } from "@/components/shared/upload-file";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { WoStatusPill } from "../wo-status";
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
import { EMPTY_FORM, EMPTY_SOURCE, NO_COMPONENTS_PREFIX, errorsForStep, firstErrorKey, formsEqual, stepBlockReason, stepOfField, validateForm, WIZARD_STEPS, type FormErrors, type WizardStepKey, type WoForm } from "./wo-form";
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
  const router = useRouter();
  const isNew = mode === "create";
  const canManageFields = useCan(WO_P.customFields).allowed;
  const invalidate = useInvalidateWorkOrders();
  const detail = useApiQuery<WorkOrderDetail>(["work-order", workOrderId ?? ""], isNew ? null : `/api/work-orders/${encodeURIComponent(workOrderId ?? "")}`, { staleTime: 0, timeoutMs: 20_000 });
  const nextCode = useApiQuery<{ code: string }>(["wo-next-code"], isNew ? "/api/work-orders/next-code" : null, { staleTime: 0, timeoutMs: 15_000 });
  const onlyWarehouse = me.data?.data.contextOptions.warehouses.length === 1 ? me.data.data.contextOptions.warehouses[0]?.id ?? null : null;
  const prefWh = me.data?.data.preferences?.defaultWarehouseId;
  const preferredWarehouse = typeof prefWh === "string" && prefWh ? prefWh : null;
  // Default warehouse: the header context, else the user's default warehouse, else the only one.
  const contextWarehouse = me.data?.data.context.warehouseId
    ?? (preferredWarehouse && me.data?.data.contextOptions.warehouses.some((w) => w.id === preferredWarehouse) ? preferredWarehouse : null);

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
  const [assigning, setAssigning] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [codeChecking, setCodeChecking] = React.useState(false);
  // Last code confirmed taken by the on-blur check (so Next can stop on step 1 without a refetch).
  const takenCode = React.useRef<string | null>(null);
  const checkedCode = React.useRef<string | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  // Keys whose error came from the server (kept until that field changes).
  const serverErrorKeys = React.useRef<Set<string>>(new Set());

  // Seed: code suggestion + default warehouse (create), or the record (edit).
  // The suggestion is refetched on every open. It fills the field only while the user has never
  // touched it; once they type (or clear) the code, the suggestion is offered as an explicit
  // "Use WO…" link instead and never overwrites their value.
  const autoCode = React.useRef<string | null>(null);
  const codeTouched = React.useRef(false);
  React.useEffect(() => {
    const code = nextCode.data?.data.code;
    if (!isNew || !code || nextCode.isFetching) return;
    const replace = (f: WoForm | null) => (f && (!f.code || f.code === autoCode.current) ? { ...f, code } : f);
    if (!codeTouched.current) setForm(replace);
    setInitial(replace);
    autoCode.current = code;
  }, [isNew, nextCode.data, nextCode.isFetching]);
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
    // A hung server becomes an error with Retry after 20 s instead of an endless spinner.
    timeoutMs: 20_000,
  });
  const kit = form?.kitProductId ? kitQuery.data?.data ?? null : null;
  // Show the failure after the first failed attempt (not only after the retry), so a 500 never
  // leaves the Kit step on an endless spinner. A manual Retry clears it while it runs.
  const kitFailure = form?.kitProductId && !kit ? (kitQuery.error ?? kitQuery.failureReason ?? null) : null;
  const kitErrorMessage = kitFailure ? kitFailure.message || "The server did not answer" : null;
  // Latest form for the deferred blur check (read after a tick, outside render).
  const formRef = React.useRef(form);
  React.useEffect(() => { formRef.current = form; }, [form]);

  if (!form) {
    if (detail.error) return <Callout variant="error" title="Work order not available" action={<Button size="sm" variant="secondary" disabled={detail.isFetching} onClick={() => void detail.refetch()}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Retry</Button>}>{detail.error.message}</Callout>;
    return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-72" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-24 w-full" /></div>;
  }

  const record = detail.data?.data.workOrder;
  const status = record?.status ?? "Open";
  const lockCore = !isNew && status !== "Open";
  // Logiwa disables Client once the work order exists; warehouse and client are fixed after create.
  const lockOrg = Boolean(prefill) || !isNew;
  const components = (kit?.components ?? []).map((c) => ({ productId: c.productId, sku: c.sku }));
  // The selected kit (and its components) has loaded; until then "no components" is not known.
  const kitReady = !form.kitProductId || Boolean(kit);
  // Once the selected kit's components have loaded, a "no components" error raised while it was loading is stale.
  const shownErrors: FormErrors = kit && kit.components.length > 0 && errors.kitProductId?.startsWith(NO_COMPONENTS_PREFIX)
    ? Object.fromEntries(Object.entries(errors).filter(([k]) => k !== "kitProductId")) : errors;

  const update = (patch: Partial<WoForm>) => {
    if ("code" in patch) codeTouched.current = true;
    setForm((f) => (f ? { ...f, ...patch } : f));
    const keys = Object.keys(patch);
    // Live re-validation: once a step shows errors, every change re-checks them, so a step pill
    // turns back from amber the moment the step is valid (not only after leaving it). Server-side
    // errors (e.g. a duplicate code) stay until their own field changes.
    const next = form ? { ...form, ...patch } : null;
    // A new kit's components are not loaded yet: don't flag "no components" against the old list.
    const kitChanged = "kitProductId" in patch && patch.kitProductId !== form?.kitProductId;
    const res = next ? validateForm(next, kitChanged ? [] : components, { componentsLoaded: !kitChanged && kitReady }) : null;
    const live: Readonly<Record<string, string | undefined>> = res && !res.ok ? res.errors : {};
    setErrors((e) => Object.fromEntries(Object.entries(e).flatMap(([k, v]) => {
      const touched = keys.some((p) => k === p || (p === "sources" && k.startsWith("components")));
      if (touched) return live[k] ? [[k, live[k]]] : [];
      if (serverErrorKeys.current.has(k)) return [[k, v]];
      return live[k] ? [[k, live[k]]] : [];
    })));
    for (const k of keys) serverErrorKeys.current.delete(k);
  };

  const checkCode = async (code: string): Promise<string | null> => {
    const trimmed = code.trim();
    if (!trimmed) return null;
    setCodeChecking(true);
    try {
      const res = await apiFetch<{ available: boolean }>("/api/work-orders/code-available", { query: { code: trimmed, ...(record?.id ? { exceptId: record.id } : {}) } });
      const message = res.available ? null : `${trimmed} is already used by another work order`;
      takenCode.current = res.available ? null : trimmed;
      checkedCode.current = trimmed;
      if (formRef.current?.code.trim() !== trimmed) return null;
      setErrors((prev) => {
        if (message) { serverErrorKeys.current.add("code"); return { ...prev, code: message }; }
        if (prev.code && serverErrorKeys.current.has("code")) { serverErrorKeys.current.delete("code"); return Object.fromEntries(Object.entries(prev).filter(([k]) => k !== "code")); }
        return prev;
      });
      return message;
    } catch {
      return null; // the check is advisory; Save still enforces uniqueness
    } finally {
      setCodeChecking(false);
    }
  };

  const validateStep = (step: WizardStepKey): boolean => {
    const res = validateForm(form, components);
    const base = res.ok ? {} : errorsForStep(res.errors, step);
    const dup = step === "general" && takenCode.current && form.code.trim() === takenCode.current ? `${takenCode.current} is already used by another work order` : null;
    const stepErrors = dup && !base.code ? { ...base, code: dup } : base;
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
    // Leaving General with a code that was never checked: confirm it is free first (inline error on step 1).
    const code = form.code.trim();
    if (ti > stepIndex && stepIndex <= 0 && code && code !== (initial?.code ?? "").trim() && checkedCode.current !== code && validateStep("general")) {
      void checkCode(code).then((message) => {
        checkedCode.current = code;
        if (message) { setPhase("general"); focusFirst(rootRef.current, ["code"]); return; }
        goTo(target);
      });
      return;
    }
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
      // Confirm right away (Logiwa: "Work Order created successfully."), with a link to the record.
      toast.success(isNew ? "Work order created successfully" : "Work order updated successfully", `${saved.code} · ${saved.kitSku} × ${saved.requestedQty}`, {
        action: { label: "Open", onClick: () => router.push(`/work-orders/${saved.id}`) },
      });
      let failedUploads = 0;
      for (const file of files) {
        try { await uploadFile(file, "attachment", { entityType: "work_order", entityId: saved.id }); } catch { failedUploads += 1; }
      }
      if (failedUploads) toast.warning("Documents", `${failedUploads} document${failedUploads === 1 ? "" : "s"} could not be uploaded. Add them from the work order details.`);
      setFiles([]);
      setInitial(form);
      onDirty(false);
      void invalidate();
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
        serverErrorKeys.current = new Set(Object.keys(mapped));
        const first = firstErrorKey(mapped);
        if (first) { setPhase(stepOfField(first)); focusFirst(rootRef.current, [first]); }
      }
      setServerError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const errorSteps = new Set(Object.keys(shownErrors).map(stepOfField));
  const steps: StepMeta[] = WIZARD_STEPS.map((s, i) => ({
    key: s.key, label: s.label,
    status: errorSteps.has(s.key) ? "attention" : s.key === phase ? "active" : i < stepIndex || visited.has(s.key) ? "complete" : "upcoming",
    clickable: phase !== "operation",
  }));
  const isLast = phase === "other";
  const kitLoadingNow = Boolean(form.kitProductId) && !kit && !kitErrorMessage && (kitQuery.isPending || kitQuery.isFetching);
  // Next stays clickable: pressing it validates the step, shows every inline error and focuses
  // the first one (critic R4). It is only held while something is genuinely in flight or broken.
  const stepHint = phase === "operation" || isLast ? null : stepBlockReason(form, components, phase, { loading: kitLoadingNow, error: kitErrorMessage });
  const nextBlock = phase === "operation" || isLast ? null
    : phase === "kit" && assigning ? "Assigning component sources…"
    : phase === "kit" && kitLoadingNow ? "Loading kit and components…"
    : phase === "kit" && kitErrorMessage ? "The kit couldn't be loaded. Retry to continue"
    : phase === "general" && codeChecking ? "Checking the work order code…"
    : null;

  // Validate a field when focus leaves it (Logiwa shows errors on blur). Focus moving into a
  // portaled popover (select list, date picker) is not a blur of the field.
  const onBlurCapture = (e: React.FocusEvent<HTMLFormElement>) => {
    const field = (e.target as HTMLElement).closest<HTMLElement>("[data-field]");
    const key = field?.dataset.field;
    if (!field || !key) return;
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active && field.contains(active)) return;
      if (active && active !== document.body && rootRef.current && !rootRef.current.contains(active)) return;
      const current = formRef.current;
      if (!current) return;
      const res = validateForm(current, components, { componentsLoaded: kitReady });
      const message = res.ok ? undefined : res.errors[key];
      if (key === "code" && !message && current.code.trim() && current.code.trim() !== (initial?.code ?? "").trim()) { void checkCode(current.code); return; }
      setErrors((prev) => {
        if (message) return prev[key] === message ? prev : { ...prev, [key]: message };
        if (!(key in prev) || serverErrorKeys.current.has(key)) return prev;
        return Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key));
      });
    }, 120);
  };
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
        {record ? <WoStatusPill status={status} /> : null}
      </div>
      {lockCore ? <Callout variant="info" title={`This work order is ${status}`}>Warehouse, client, type, kit, quantity and component sources are locked. Notes, instructions, dates and custom fields can still change.</Callout> : null}
      {conflict ? (
        <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" variant="secondary" onClick={() => { setConflict(false); setForm(null); setInitial(null); void detail.refetch(); }}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Reload</Button>}>
          Someone else saved this work order. Reload to see the latest version, then repeat your change.
        </Callout>
      ) : null}
      {serverError ? <Callout variant="error" title="Not saved">{serverError}</Callout> : null}

      <form noValidate className="flex flex-1 flex-col gap-4" onBlurCapture={onBlurCapture} onSubmit={(e) => {
        e.preventDefault();
        if (isLast) void save();
        else { const next = order[stepIndex + 1]; if (next) goTo(next); }
      }}>
        {phase === "general" ? (
          <GeneralStep form={form} errors={shownErrors} onChange={update} lockOrg={lockOrg} lockCore={lockCore}
            codeLoading={isNew && nextCode.isFetching} codeError={isNew && nextCode.error ? nextCode.error.message : null} onRetryCode={() => void nextCode.refetch()}
            suggestedCode={isNew && !nextCode.isFetching ? nextCode.data?.data.code ?? null : null} codeChecking={codeChecking} />
        ) : null}
        {phase === "kit" ? <KitStep form={form} errors={shownErrors} onChange={update} kit={kit} kitLoading={kitLoadingNow} kitError={kitErrorMessage} kitRetrying={kitQuery.isFetching} onRetryKit={() => void kitQuery.refetch()} lockCore={lockCore} onEditSource={setSourceFor} assigning={assigning} onAssigning={setAssigning}
          sourceLocks={Object.fromEntries((detail.data?.data.components ?? []).filter((c) => c.sourceLockedBy && form.sources[c.componentProductId]?.locationId === c.locationId).map((c) => [c.componentProductId, c.sourceLockedBy as string]))} /> : null}
        {phase === "advanced" ? <AdvancedStep form={form} errors={shownErrors} onChange={update} files={files} onFiles={setFiles} isNew={isNew} /> : null}
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
            ) : (
              <DisabledReason reason={nextBlock}>
                <Button type="submit" variant="primary" disabled={Boolean(nextBlock)} title={!nextBlock && stepHint ? stepHint : undefined} aria-busy={phase === "kit" && (kitLoadingNow || assigning)}>
                  {phase === "kit" && (kitLoadingNow || assigning) ? <Spinner className="h-3.5 w-3.5" label={assigning ? "Assigning sources" : "Loading kit"} /> : null}
                  Next
                </Button>
              </DisabledReason>
            )}
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
        requireLocation={form.type !== "Work Order with Picking"}
        onChange={(v) => { if (sourceFor) update({ sources: { ...form.sources, [sourceFor]: v } }); }}
      />
    </div>
  );
}

