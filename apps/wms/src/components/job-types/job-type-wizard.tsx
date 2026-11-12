"use client";

/**
 * Create / edit job type drawer (Logiwa 02 §6). Step 0: Picking / Count / Replenishment /
 * Work Orders. Picking: General → Templates → Settings → Conditions → Grouping (no Templates
 * when editing). Count: General → Settings → Loc. conditions → SKU conditions.
 * Replenishment and Work Order: General → Settings → Conditions.
 */
import * as React from "react";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { Boxes, ClipboardCheck, Filter, LayoutTemplate, Layers, MapPin, PackageSearch, RefreshCw, Settings2, SlidersHorizontal, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { RadioCards } from "@/components/ui/radio-cards";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { Wizard, type WizardStep } from "@/components/ui/wizard";
import { apiRequest, isApiError } from "@/lib/api-client";
import { FormBridge } from "@/components/wave-rules/rule-editors";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import type { OPERATION_TYPES } from "@/lib/enums";
import { jobTypeInputSchema } from "@/lib/grid-defs/jobs/forms";
import type { getJobTypeDetail } from "@/server/repositories/job-types";
import type { WaveRuleOptions } from "@/server/repositories/wave-rules-options";
import {
  CountLocationStep, CountSkuStep, defaultSettings, GeneralStep, GroupingStep, PickingConditionsStep, ReplenishmentConditionsStep, SettingsStep, TemplatesStep,
  WorkOrderConditionsStep, type JF,
} from "./job-type-steps";

type Op = (typeof OPERATION_TYPES)[number];
type Detail = Awaited<ReturnType<typeof getJobTypeDetail>>;

const OP_CARDS: readonly { readonly value: Op; readonly title: string; readonly description: string; readonly icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "Picking", title: "Picking", description: "Assign settings for your picking jobs.", icon: PackageSearch },
  { value: "Count", title: "Count", description: "Assign settings for your count jobs.", icon: ClipboardCheck },
  { value: "Replenishment", title: "Replenishment", description: "Assign settings for your replenishment jobs.", icon: RefreshCw },
  { value: "Work Order", title: "Work orders", description: "Assign settings for your work orders.", icon: Wrench },
];

export function emptyJobType(op: Op, warehouseId: string): JF {
  return {
    code: "", description: "", warehouseId, operationType: op, allocationAlgorithmId: null, template: "Custom", settings: defaultSettings(), conditions: [],
    locationConditions: [], skuConditions: [], sourceLocationConditions: [], destinationLocationConditions: [], lpConditions: [], productConditions: [],
    orderBy: op === "Replenishment" || op === "Work Order" ? [] : [{ field: "walkingPathPriority", dir: "asc" }], groupBy: [],
  };
}

export function jobTypeDetailToForm(d: Detail): JF {
  return {
    code: d.code, description: d.description ?? "", warehouseId: d.warehouseId, operationType: d.operationType, allocationAlgorithmId: d.allocationAlgorithmId,
    template: d.template ?? "Custom", settings: { ...defaultSettings(), ...d.settings }, conditions: [...d.conditions], locationConditions: [...(d.locationConditions ?? [])],
    skuConditions: [...(d.skuConditions ?? [])], sourceLocationConditions: [...(d.sourceLocationConditions ?? [])], destinationLocationConditions: [...(d.destinationLocationConditions ?? [])],
    lpConditions: [...(d.lpConditions ?? [])], productConditions: [...(d.productConditions ?? [])], orderBy: [...d.orderBy], groupBy: [...(d.groupBy ?? [])], version: d.version,
  };
}

/** Per-step validation through the authoritative schema, keeping only the step's paths. */
function stepSchema(paths: readonly string[]): z.ZodType {
  return z.object({}).passthrough().superRefine((value, ctx) => {
    const res = jobTypeInputSchema.safeParse(value);
    if (res.success) return;
    for (const issue of res.error.issues) {
      const path = issue.path.map(String).join(".");
      if (paths.some((p) => path === p || path.startsWith(`${p}.`))) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
  });
}

const GENERAL = stepSchema(["code", "description", "warehouseId", "allocationAlgorithmId"]);
const SETTINGS = stepSchema(["settings"]);
const SKU = stepSchema(["skuConditions"]);

function Body({ initial, editId, onDone, onCancel, onDirtyChange }: { readonly initial: JF; readonly editId: string | null; readonly onDone: () => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void }) {
  const formRef = React.useRef<UseFormReturn<JF> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const op = initial.operationType;
  const options = useApiQuery<WaveRuleOptions>(["wave-rule-options", initial.warehouseId ?? ""], op === "Picking" ? "/api/wave-rules/options" : null, { query: { warehouseId: initial.warehouseId || undefined }, staleTime: 60_000 });
  const opts = options.data?.data;
  const onForm = React.useCallback((form: UseFormReturn<JF>) => { formRef.current = form; }, []);
  const steps = React.useMemo<readonly WizardStep<JF>[]>(() => {
    const r = (fn: (form: UseFormReturn<JF>) => React.ReactNode) => function StepBody({ form }: { form: UseFormReturn<JF> }) { return <><FormBridge<JF> form={form} onForm={onForm} />{fn(form)}</>; };
    const general: WizardStep<JF> = { key: "general", label: "General", icon: Settings2, schema: GENERAL, render: r((form) => <GeneralStep form={form} isEdit={Boolean(editId)} />) };
    const settings: WizardStep<JF> = { key: "settings", label: "Settings", icon: SlidersHorizontal, schema: SETTINGS, render: r((form) => <SettingsStep form={form} />) };
    if (op === "Picking") {
      return [
        general,
        ...(editId ? [] : [{ key: "templates", label: "Templates", icon: LayoutTemplate, isOptional: true, render: r((form) => <TemplatesStep form={form} />) } as WizardStep<JF>]),
        settings,
        { key: "conditions", label: "Conditions", icon: Filter, isOptional: true, render: r((form) => <PickingConditionsStep form={form} options={opts} />) },
        { key: "grouping", label: "Grouping", icon: Layers, isOptional: true, render: r((form) => <GroupingStep form={form} />) },
      ];
    }
    if (op === "Count") {
      return [
        general,
        settings,
        { key: "loc", label: "Loc. conditions", icon: MapPin, isOptional: true, render: r((form) => <CountLocationStep form={form} />) },
        { key: "sku", label: "SKU conditions", icon: Boxes, schema: SKU, render: r((form) => <CountSkuStep form={form} />) },
      ];
    }
    return [
      general,
      settings,
      { key: "conditions", label: "Conditions", icon: Filter, isOptional: true, render: r((form) => (op === "Replenishment" ? <ReplenishmentConditionsStep form={form} /> : <WorkOrderConditionsStep form={form} />)) },
    ];
  }, [op, editId, opts, onForm]);

  const submit = async (values: JF) => {
    try {
      const body = { ...values, template: values.settings?.template ?? values.template };
      const { data } = await apiRequest<{ code: string }>(editId ? `/api/job-types/${editId}` : "/api/job-types", { method: editId ? "PATCH" : "POST", body });
      toast.success("Success", editId ? `Job type ${data.code} updated.` : `Job type ${data.code} created.`);
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      if (formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the job type", isApiError(error) ? error.message : "Something went wrong");
      throw error;
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this job type. Reload to see their changes.</Callout> : null}
      <Wizard<JF> steps={steps} variant="drawer" mode={editId ? "free" : "linear"} defaultValues={initial} draftScope={false} guardUnsaved={false} onDirtyChange={onDirtyChange} submitLabel="Save" onCancel={onCancel} onComplete={submit} />
    </div>
  );
}

export function JobTypeDrawer({ open, onOpenChange, editId, onSaved }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly editId: string | null; readonly onSaved: () => void }) {
  const [dirty, setDirty] = React.useState(false);
  const [op, setOp] = React.useState<Op | null>(null);
  const detail = useApiQuery<Detail>(["job-type", editId ?? ""], open && editId ? `/api/job-types/${editId}` : null, { staleTime: 0 });
  React.useEffect(() => {
    if (open) setOp(null);
  }, [open, editId]);
  const close = () => {
    setDirty(false);
    onOpenChange(false);
  };
  const d = detail.data?.data;
  const chosen: Op | null = editId ? (d?.operationType ?? null) : op;
  const initial = editId ? (d ? jobTypeDetailToForm(d) : null) : chosen ? emptyJobType(chosen, "") : null;
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(o) : close())}
      dirty={dirty}
      width={60}
      title={editId ? `Edit job type ${d?.code ?? ""}`.trim() : "Create new job type"}
      description={chosen ? undefined : "Choose the operation type this job type is for."}
      headerExtra={chosen ? <span className="inline-flex w-fit rounded-full bg-primary-soft px-2 py-0.5 text-2xs font-semibold text-primary">{chosen}</span> : null}
    >
      {editId && detail.isError ? (
        <EmptyState title="Couldn't load this job type" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
      ) : editId && !d ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : !chosen || !initial ? (
        <RadioCards ariaLabel="Operation type" chevron value={op} onChange={setOp} options={OP_CARDS.map((c) => ({ value: c.value, title: c.title, description: c.description, icon: c.icon }))} />
      ) : (
        <Body
          key={`${editId ?? chosen}-${detail.dataUpdatedAt}`}
          initial={initial}
          editId={editId}
          onDirtyChange={setDirty}
          onCancel={editId ? close : () => { setDirty(false); setOp(null); }}
          onDone={() => { setDirty(false); onSaved(); onOpenChange(false); }}
        />
      )}
    </Drawer>
  );
}
