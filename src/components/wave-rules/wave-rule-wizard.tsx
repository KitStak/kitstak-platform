"use client";

/**
 * Create / edit wave rule drawer (Logiwa 02 §2). Step 0 picks the operation type from five
 * cards; then 1.General → 2.Selection → 3.Schedule → 4.Assign (Order Merge has no Assign).
 * Every step validates with inline errors; edit mode opens every step ("free").
 */
import * as React from "react";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { CalendarClock, ClipboardCheck, Filter, GitMerge, PackageSearch, RefreshCw, Settings2, Sparkles, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { RadioCards } from "@/components/ui/radio-cards";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { Wizard, type WizardStep } from "@/components/ui/wizard";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import type { WAVE_OP_TYPES } from "@/lib/enums";
import { waveRuleBaseSchema, waveRuleIssues } from "@/lib/grid-defs/jobs/forms";
import { canonicalOrderByField } from "@/lib/grid-defs/jobs/conditions";
import type { getWaveRuleDetail } from "@/server/repositories/wave-rules";
import type { WaveRuleOptions } from "@/server/repositories/wave-rules-options";
import { FormBridge } from "./rule-editors";
import { AssignStep, GeneralStep, ScheduleStep, SelectionStep, type F } from "./wave-rule-steps";

type Op = (typeof WAVE_OP_TYPES)[number];
type Detail = Awaited<ReturnType<typeof getWaveRuleDetail>>;

const OP_CARDS: readonly { readonly value: Op; readonly title: string; readonly description: string; readonly icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "Picking", title: "Picking", description: "Set up rules for picking jobs.", icon: PackageSearch },
  { value: "Cycle Count", title: "Cycle count", description: "Set up rules for count jobs.", icon: ClipboardCheck },
  { value: "Replenishment", title: "Replenishment", description: "Set up rules for replenishment jobs.", icon: RefreshCw },
  { value: "Order Merge", title: "Order merge", description: "Set up rules for merging orders based on configured criteria.", icon: GitMerge },
  // Logiwa's AI Wave copy. Built in: the AI Jobs app (Settings → Apps) only tunes batch size and routing.
  { value: "AI Job", title: "AI job", description: "Create an AI Wave and set up rules for job creation. The jobs created by AI Wave will be optimized by AI.", icon: Sparkles },
];

export function emptyWaveRule(op: Op, warehouseId: string): F {
  return {
    name: "", warehouseId, operationType: op, priority: "None", deleteIfNotStarted: false, deleteMethod: "None", deleteTime: null, jobTypeIds: [], filters: [], orderBy: [],
    scheduleDays: [], scheduleTimes: [], assignMode: "Pool", assigneeRoleIds: [], assigneeUserIds: [], countType: op === "Cycle Count" ? "Location" : null, lockLocations: false,
    softAllocation: false, mergeRuleIds: [],
  };
}

export function detailToForm(d: Detail): F {
  return {
    name: d.name, warehouseId: d.warehouseId, operationType: d.operationType, priority: d.priority as F["priority"], deleteIfNotStarted: d.deleteIfNotStarted,
    deleteMethod: d.deleteMethod, deleteTime: d.deleteTime, jobTypeIds: [...d.jobTypeIds], filters: [...d.filters], orderBy: d.orderBy.map((o) => ({ ...o, field: canonicalOrderByField(o.field) })),
    scheduleDays: [...d.scheduleDays] as F["scheduleDays"], scheduleTimes: [...d.scheduleTimes], assignMode: d.assignMode, assigneeRoleIds: [...(d.assigneeRoleIds ?? [])],
    assigneeUserIds: [...(d.assigneeUserIds ?? [])], countType: d.countType, lockLocations: d.lockLocations, softAllocation: d.softAllocation, mergeRuleIds: [...(d.mergeRuleIds ?? [])],
    version: d.version,
  };
}

/** Step schema: optional base fields + the cross-field rules whose path belongs to the step. */
export function stepSchema(paths: readonly string[], base: z.ZodObject = z.object({})): z.ZodType {
  // Critic R4: one pass reports the base fields AND the cross-field issues (e.g. "Select at least one
  // job type"), so Next on an empty step outlines every section at once. (A refinement on the base
  // object would be skipped while name / warehouse are still invalid.)
  return z.any().superRefine((value, ctx) => {
    const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const own = base.passthrough().safeParse(raw);
    if (!own.success) for (const issue of own.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    const parsed = waveRuleBaseSchema.safeParse({ ...raw, name: raw.name || "-", warehouseId: raw.warehouseId || "-" });
    if (!parsed.success) return;
    for (const issue of waveRuleIssues(parsed.data)) if (paths.includes(issue.path)) ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
  });
}

const GENERAL = stepSchema(["jobTypeIds", "mergeRuleIds", "countType", "deleteMethod", "deleteTime"], z.object({ name: waveRuleBaseSchema.shape.name, warehouseId: waveRuleBaseSchema.shape.warehouseId }));
const SCHEDULE = stepSchema(["scheduleTimes"]);
const ASSIGN = stepSchema(["assigneeRoleIds", "assigneeUserIds"]);

function useOptions(warehouseId: string | null) {
  return useApiQuery<WaveRuleOptions>(["wave-rule-options", warehouseId ?? ""], "/api/wave-rules/options", { query: { warehouseId: warehouseId ?? undefined }, staleTime: 30_000, placeholderData: (prev) => prev });
}

function Body({ initial, editId, onDone, onCancel, onDirtyChange }: { readonly initial: F; readonly editId: string | null; readonly onDone: (name: string) => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void }) {
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [warehouseId, setWarehouseId] = React.useState<string | null>(initial.warehouseId || null);
  const [conflict, setConflict] = React.useState(false);
  const options = useOptions(warehouseId);
  const opts = options.data?.data;
  const op = initial.operationType;
  const tz = opts?.warehouses.find((w) => w.id === warehouseId)?.timezone ?? "UTC";
  const onForm = React.useCallback((form: UseFormReturn<F>) => {
    formRef.current = form;
    setWarehouseId(form.getValues("warehouseId") || null);
    const sub = form.watch((v, info) => {
      if (info.name === "warehouseId") setWarehouseId(v.warehouseId || null);
    });
    return () => sub.unsubscribe();
  }, []);
  const bridge = (form: UseFormReturn<F>) => <FormBridge<F> form={form} onForm={onForm} />;
  const steps = React.useMemo<readonly WizardStep<F>[]>(() => {
    const list: WizardStep<F>[] = [
      { key: "general", label: "General", icon: Settings2, schema: GENERAL, render: ({ form }) => <>{bridge(form)}<GeneralStep form={form} options={opts} loading={options.isPending} optionsLoading={options.isPending || options.isPlaceholderData} /></> },
      { key: "selection", label: "Selection", icon: Filter, isOptional: true, render: ({ form }) => <>{bridge(form)}<SelectionStep form={form} options={opts} /></> },
      { key: "schedule", label: "Schedule", icon: CalendarClock, schema: SCHEDULE, render: ({ form }) => <>{bridge(form)}<ScheduleStep form={form} timezone={tz} /></> },
    ];
    if (op !== "Order Merge") list.push({ key: "assign", label: "Assign", icon: UserCheck, schema: ASSIGN, render: ({ form }) => <>{bridge(form)}<AssignStep form={form} options={opts} /></> });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, opts, options.isPending, options.isPlaceholderData, tz]);

  const submit = async (values: F) => {
    try {
      const { data } = await apiRequest<{ name: string }>(editId ? `/api/wave-rules/${editId}` : "/api/wave-rules", { method: editId ? "PATCH" : "POST", body: { ...values } });
      toast.success("Success", editId ? `Wave rule ${data.name} updated.` : `Wave rule ${data.name} created.`);
      onDone(data.name);
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      if (formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the wave rule", isApiError(error) ? error.message : "Something went wrong");
      throw error;
    }
  };

  // Blind judge R1: AI waves are built in (the AI Jobs app only tunes them), so the steps are never gated.
  return (
    <div className="flex flex-col gap-3">
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this wave rule. Reload to see their changes.</Callout> : null}
      <Wizard<F> steps={steps} variant="drawer" mode={editId ? "free" : "linear"} defaultValues={initial} draftScope={false} guardUnsaved={false} onDirtyChange={onDirtyChange} submitLabel={editId ? "Save" : "Save"} onCancel={onCancel} onComplete={submit} />
    </div>
  );
}

/** Warms the wizard options (job types, users, roles) for one warehouse while the drawer is open. */
function PrefetchOptions({ warehouseId }: { readonly warehouseId: string }) {
  useOptions(warehouseId);
  return null;
}

export function WaveRuleDrawer({ open, onOpenChange, editId, defaultWarehouseId, onSaved }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly editId: string | null; readonly defaultWarehouseId: string | null; readonly onSaved: () => void }) {
  const [dirty, setDirty] = React.useState(false);
  const [op, setOp] = React.useState<Op | null>(null);
  const detail = useApiQuery<Detail>(["wave-rule", editId ?? ""], open && editId ? `/api/wave-rules/${editId}` : null, { staleTime: 0 });
  React.useEffect(() => {
    if (open) setOp(null);
  }, [open, editId]);
  const close = () => {
    setDirty(false);
    onOpenChange(false);
  };
  // Critic R3: prefetch every warehouse's options when the drawer opens, so the job-type list is ready on pick.
  const base = useApiQuery<WaveRuleOptions>(["wave-rule-options", ""], open ? "/api/wave-rules/options" : null, { query: {}, staleTime: 30_000 });
  const warehouseIds = open ? (base.data?.data.warehouses ?? []).map((w) => w.id) : [];
  const d = detail.data?.data;
  const chosen: Op | null = editId ? (d?.operationType ?? null) : op;
  const initial = editId ? (d ? detailToForm(d) : null) : chosen ? emptyWaveRule(chosen, defaultWarehouseId ?? "") : null;
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(o) : close())}
      dirty={dirty}
      width={60}
      title={editId ? `Edit wave rule ${d?.name ?? ""}`.trim() : "Create a new wave rule"}
      description={editId || chosen ? undefined : "Choose the operation type of the jobs this rule creates."}
      headerExtra={chosen ? <span className="inline-flex w-fit rounded-full bg-primary-soft px-2 py-0.5 text-2xs font-semibold text-primary">{chosen}</span> : null}
    >
      {warehouseIds.map((id) => <PrefetchOptions key={id} warehouseId={id} />)}
      {editId && detail.isError ? (
        <EmptyState title="Couldn't load this wave rule" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
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
