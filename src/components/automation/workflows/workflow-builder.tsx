"use client";

/**
 * Workflow builder (`/automation/workflows/new|[id]`, KitStaks-designed): trigger + scope,
 * Match All/Any conditions (order fields), ordered actions with params, stop processing,
 * Test against order (dry run, rolled back) and the Run history tab.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2, ChevronLeft, CircleSlash, FlaskConical, GripVertical, Pencil, Plus, Trash2, XCircle, Zap } from "lucide-react";
import { apiFetch, apiRequest, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RuleCondition } from "@/lib/domain-types";
import { MATCH_MODES, WORKFLOW_TRIGGERS } from "@/lib/enums";
import { describeCondition } from "@/lib/grid-defs/integrations/rule-fields";
import {
  ACTION_COPY, ACTION_PARAMS, WORKFLOW_DEFAULTS, WORKFLOW_RUN_FIELDS, WORKFLOW_RUNS_GRID_KEY, actionsForTrigger, workflowSaveSchema,
  type WorkflowActionName, type WorkflowSaveInput,
} from "@/lib/grid-defs/integrations/workflows";
import { DataGrid, GridToolbar, useLocalGrid, type GridColumnDef } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { UnderlineTabs } from "@/components/ui/tabs";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { UnsavedChangesGuard } from "@/components/ui/unsaved-changes";
import { Muted, NO_PERMISSION, toFilterFields, useClientOptions, usePagePerms, useWarehouseOptions } from "@/components/integrations/shared/shared";
import type { WorkflowDetail, WorkflowRunRow, WorkflowTestResult } from "@/server/repositories/workflows";
import { ConditionModal, type ConditionModalState } from "../rules/rule-modals";
import { useRuleNames } from "../rules/rule-names";
import { ActionParamField } from "./workflow-action-params";

type Form = Required<Pick<WorkflowSaveInput, "name" | "trigger" | "match" | "conditions" | "isActive" | "stopProcessing">> & {
  description: string; warehouseId: string | null; clientId: string | null; actions: { key: string; action: WorkflowActionName; params: Record<string, unknown> }[];
};
type Errors = Record<string, string>;
const key = () => Math.random().toString(36).slice(2);

function toForm(d: WorkflowDetail | null): Form {
  if (!d) return { ...WORKFLOW_DEFAULTS, description: "", warehouseId: null, clientId: null, conditions: [], actions: [], trigger: "Shipment Order Created", match: "All", isActive: true, stopProcessing: false, name: "" };
  return { name: d.name, description: d.description ?? "", trigger: d.trigger, warehouseId: d.warehouseId, clientId: d.clientId, match: d.match, conditions: d.conditions, isActive: d.isActive, stopProcessing: d.stopProcessing,
    actions: d.actionList.map((a) => ({ key: key(), action: a.action, params: a.params })) };
}
const payload = (f: Form) => ({ ...f, description: f.description || null, actions: f.actions.map(({ action, params }) => ({ action, params })) });

function SortableAction({ id, index, children, readOnly, onDelete, label }: { readonly id: string; readonly index: number; readonly children: React.ReactNode; readonly readOnly: boolean; readonly onDelete: () => void; readonly label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: readOnly });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("rounded-lg border border-border bg-surface p-3", isDragging && "z-10 shadow-lg")}>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success-soft text-[11px] font-bold text-success">{index + 1}</span>
        <p className="flex-1 text-[13px] font-semibold text-foreground">{label}</p>
        {!readOnly ? <button type="button" aria-label={`Remove ${label}`} onClick={onDelete} className="rounded p-1 text-secondary hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"><Trash2 className="h-3.5 w-3.5" /></button> : null}
        <button type="button" aria-label={`Reorder ${label}`} disabled={readOnly} {...attributes} {...listeners} className="cursor-grab rounded p-1 text-faint hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed"><GripVertical className="h-3.5 w-3.5" /></button>
      </div>
      {children}
    </li>
  );
}

export function WorkflowBuilder({ id }: { readonly id: string | null }) {
  const detail = useApiQuery<WorkflowDetail>(["workflow", id ?? "new"], id ? `/api/workflows/${id}` : null, { staleTime: 0 });
  if (id && detail.isPending) return <div className="flex flex-col gap-3 p-6"><Skeleton className="h-10 w-72" /><Skeleton className="h-[480px] w-full" /></div>;
  if (id && (detail.isError || !detail.data)) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState title={detail.error?.status === 404 ? "Workflow not found" : "Couldn't load this workflow"} description={detail.error?.status === 404 ? "It may have been deleted, or it is scoped to a warehouse or client you can't access." : detail.error?.message}
          action={<div className="flex gap-2"><Button onClick={() => void detail.refetch()}>Retry</Button><Link href="/automation/workflows"><Button variant="secondary">Back to workflows</Button></Link></div>} />
      </div>
    );
  }
  return <Body key={`${id ?? "new"}-${detail.dataUpdatedAt}`} detail={id ? detail.data?.data ?? null : null} />;
}

function Body({ detail }: { readonly detail: WorkflowDetail | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const names = useRuleNames();
  const warehouses = useWarehouseOptions();
  const clients = useClientOptions();
  const perms = usePagePerms("automation.workflows", ["create", "edit"] as const);
  const isEdit = detail !== null;
  const readOnly = isEdit ? !perms.edit : !perms.create;
  const [form, setForm] = React.useState<Form>(() => toForm(detail));
  const [baseline, setBaseline] = React.useState(() => JSON.stringify(payload(toForm(detail))));
  const [errors, setErrors] = React.useState<Errors>({});
  const [tab, setTab] = React.useState(params.get("tab") === "runs" && isEdit ? "runs" : "builder");
  const [cond, setCond] = React.useState<{ index: number; insert: boolean } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const dirty = JSON.stringify(payload(form)) !== baseline;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [String(k)]: "" })); };
  const allowed = actionsForTrigger(form.trigger);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const validate = (): boolean => {
    const parsed = workflowSaveSchema.safeParse(payload(form));
    const next: Errors = {};
    if (!parsed.success) for (const i of parsed.error.issues) next[i.path.join(".")] ??= i.message;
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      setTab("builder");
      setTimeout(() => document.getElementById(`wf-${first.replace(/\./g, "-")}`)?.focus() ?? document.getElementById("wf-actions")?.focus(), 0);
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const { data } = await apiRequest<WorkflowDetail>(isEdit ? `/api/workflows/${detail.id}` : "/api/workflows", { method: isEdit ? "PATCH" : "POST", body: { ...payload(form), version: detail?.version } });
      toast.success("Success", isEdit ? `Workflow ${data.name} saved.` : `Workflow ${data.name} created. It runs on the next ${form.trigger.toLowerCase()} event.`);
      setBaseline(JSON.stringify(payload(form)));
      if (!isEdit) router.replace(`/automation/workflows/${data.id}`);
      else router.refresh();
    } catch (error) {
      if (isApiError(error)) {
        if (error.code === "CONFLICT") setConflict(true);
        const next: Errors = {};
        for (const [k, v] of Object.entries(error.fieldErrors)) if (v[0]) next[k] = v[0];
        setErrors(next);
      }
      toast.error("Couldn't save the workflow", isApiError(error) ? error.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const addAction = (action: WorkflowActionName) => setForm((f) => ({ ...f, actions: [...f.actions, { key: key(), action, params: {} }] }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setForm((f) => ({ ...f, actions: arrayMove(f.actions, f.actions.findIndex((a) => a.key === e.active.id), f.actions.findIndex((a) => a.key === e.over?.id)) }));
  };
  const condState: ConditionModalState | null = cond ? { title: cond.insert ? "Add condition" : "Edit condition", catalog: "order", initial: cond.insert ? null : form.conditions[cond.index] ?? null, allowApplyAll: false } : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <UnsavedChangesGuard when={dirty && !saving} />
      <PageHeader title={isEdit ? detail.name : "Create Workflow"} crumbLabel={isEdit ? "Workflow Details" : "Create Workflow"} helper="When the trigger fires and the conditions match, the actions run in order."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/automation/workflows" className="inline-flex items-center gap-1 text-[13px] text-secondary hover:text-primary"><ChevronLeft className="h-4 w-4" />Workflows</Link>
            <Button variant="secondary" onClick={() => router.push("/automation/workflows")}>Cancel</Button>
            <DisabledReason reason={readOnly ? NO_PERMISSION : !dirty ? "No changes to save" : null}><Button variant="primary" disabled={readOnly || !dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button></DisabledReason>
          </div>
        } />
      {isEdit ? <UnderlineTabs className="px-6" ariaLabel="Workflow sections" tabs={[{ key: "builder", label: "Builder" }, { key: "runs", label: "Run history", count: detail.runCount }]} active={tab} onChange={setTab} /> : null}
      {conflict ? <div className="px-6 pt-3"><Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this workflow. Reload to see their changes.</Callout></div> : null}
      {tab === "runs" && isEdit ? <RunHistory id={detail.id} /> : (
        <div className="grid flex-1 gap-5 overflow-auto p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-5">
            <section className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-foreground"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] text-white">1</span>When</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="wf-name" className="text-[12px] font-medium text-body">Workflow name <span className="text-danger">*</span></label>
                  <TextField id="wf-name" value={form.name} maxLength={80} disabled={readOnly} invalid={Boolean(errors.name)} placeholder="e.g. Block PO box addresses" onChange={(e) => set("name", e.target.value)} />
                  {errors.name ? <p role="alert" className="text-[12px] text-danger">{errors.name}</p> : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="wf-trigger" className="text-[12px] font-medium text-body">Trigger <span className="text-danger">*</span></label>
                  <Select id="wf-trigger" value={form.trigger} disabled={readOnly} options={WORKFLOW_TRIGGERS.map((t) => ({ value: t, label: t }))} onChange={(v) => v && set("trigger", v)} invalid={Boolean(errors.trigger)} />
                </div>
                <div className="flex flex-col gap-1 md:col-span-2">
                  <label htmlFor="wf-description" className="text-[12px] font-medium text-body">Description</label>
                  <Textarea id="wf-description" rows={2} maxLength={500} value={form.description} disabled={readOnly} onChange={(e) => set("description", e.target.value)} placeholder="Why this workflow exists, so the team knows when to release its orders" />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="wf-warehouseId" className="text-[12px] font-medium text-body">Warehouse</label>
                  <Select id="wf-warehouseId" value={form.warehouseId} clearable disabled={readOnly} options={warehouses.options} placeholder="All warehouses" onChange={(v) => set("warehouseId", v)} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="wf-clientId" className="text-[12px] font-medium text-body">Client</label>
                  <Combobox id="wf-clientId" value={form.clientId} clearable disabled={readOnly} options={clients} placeholder="All clients" onChange={(v) => set("clientId", v)} />
                </div>
                <div className="flex flex-wrap items-center gap-6 md:col-span-2">
                  <Checkbox checked={form.isActive} disabled={readOnly} onCheckedChange={(v) => set("isActive", v === true)} label="Active" description="Inactive workflows never run" />
                  <Checkbox checked={form.stopProcessing} disabled={readOnly} onCheckedChange={(v) => set("stopProcessing", v === true)} label="Stop processing" description="When this matches, later workflows are skipped" />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-info text-[11px] text-white">2</span>If</h2>
                <SegmentedControl size="sm" ariaLabel="Match" value={form.match} disabled={readOnly} onChange={(v) => set("match", v)}
                  options={MATCH_MODES.map((m) => ({ value: m, label: m === "All" ? "Match all" : "Match any" }))} />
                <Button size="sm" variant="secondary" className="ml-auto" disabled={readOnly} onClick={() => setCond({ index: form.conditions.length, insert: true })}><Plus className="h-3.5 w-3.5" />Add condition</Button>
              </div>
              {form.conditions.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-3 text-[12px] text-secondary">No conditions: the workflow applies to every {form.trigger.toLowerCase().includes("purchase") ? "purchase order" : "order"} in its scope.</p> : (
                <ul className="flex flex-col gap-1.5">
                  {form.conditions.map((c, i) => (
                    <li key={`${c.field}-${i}`} className="flex items-center gap-2 rounded-lg border border-info/30 bg-info-soft/30 px-3 py-2">
                      {i > 0 ? <span className="rounded-full bg-surface px-2 text-[10px] font-bold text-secondary">{form.match === "All" ? "AND" : "OR"}</span> : <span className="text-[11px] font-semibold text-info">If</span>}
                      <span className="flex-1 text-[13px] text-foreground">{describeCondition("order", c, names)}</span>
                      {!readOnly ? <>
                        <button type="button" aria-label="Edit condition" onClick={() => setCond({ index: i, insert: false })} className="rounded p-1 text-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" aria-label="Delete condition" onClick={() => set("conditions", form.conditions.filter((_, j) => j !== i))} className="rounded p-1 text-secondary hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                      </> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-3 flex items-center gap-3">
                <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-success text-[11px] text-white">3</span>Then</h2>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button id="wf-actions" size="sm" variant="secondary" className="ml-auto" disabled={readOnly}><Plus className="h-3.5 w-3.5" />Add action</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-80">
                    {allowed.map((a) => <DropdownMenuItem key={a} icon={Zap} description={ACTION_COPY[a]} onSelect={() => addAction(a)}>{a}</DropdownMenuItem>)}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {errors.actions ? <p role="alert" className="mb-2 text-[12px] text-danger">{errors.actions}</p> : null}
              {form.actions.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-3 text-[12px] text-secondary">Add at least one action. Actions run in the order shown; drag to reorder.</p> : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={form.actions.map((a) => a.key)} strategy={verticalListSortingStrategy}>
                    <ol className="flex flex-col gap-2">
                      {form.actions.map((a, i) => (
                        <SortableAction key={a.key} id={a.key} index={i} label={a.action} readOnly={readOnly} onDelete={() => set("actions", form.actions.filter((x) => x.key !== a.key))}>
                          <p className="mt-1 pl-8 text-[11px] text-secondary">{ACTION_COPY[a.action]}</p>
                          {errors[`actions.${i}.action`] ? <p role="alert" className="pl-8 text-[11px] text-danger">{errors[`actions.${i}.action`]}</p> : null}
                          {ACTION_PARAMS[a.action].length > 0 ? (
                            <div className="mt-2 grid gap-2 pl-8 md:grid-cols-2">
                              {ACTION_PARAMS[a.action].map((p) => (
                                <ActionParamField key={p.key} id={`wf-actions-${i}-params-${p.key}`} action={a.action} def={p} value={a.params[p.key]} warehouseId={form.warehouseId} clientId={form.clientId}
                                  error={errors[`actions.${i}.params.${p.key}`] ?? null}
                                  onChange={(v) => { setForm((f) => ({ ...f, actions: f.actions.map((x) => (x.key === a.key ? { ...x, params: { ...x.params, [p.key]: v } } : x)) })); setErrors((e) => ({ ...e, [`actions.${i}.params.${p.key}`]: "" })); }} />
                              ))}
                            </div>
                          ) : null}
                        </SortableAction>
                      ))}
                    </ol>
                  </SortableContext>
                </DndContext>
              )}
            </section>
          </div>
          <TestPanel form={form} />
        </div>
      )}
      <ConditionModal state={condState} onClose={() => setCond(null)} onSubmit={(c) => {
        if (!cond || c === "all") return;
        const list = [...form.conditions];
        list.splice(cond.index, cond.insert ? 0 : 1, c as RuleCondition);
        set("conditions", list);
        setCond(null);
      }} />
    </div>
  );
}

const orderOptions = z.array(z.object({ id: z.string(), label: z.string() }));

function TestPanel({ form }: { readonly form: Form }) {
  const [orderId, setOrderId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<WorkflowTestResult | null>(null);
  const load = React.useCallback(async (q: string, signal: AbortSignal) => {
    const parsed = orderOptions.safeParse(await apiFetch<unknown>("/api/workflows/test-orders", { query: { q }, signal }));
    return parsed.success ? parsed.data.map((o) => ({ value: o.id, label: o.label })) : [];
  }, []);
  const run = async () => {
    if (!orderId) { setError("Choose an order to test against"); document.getElementById("wf-test-order")?.focus(); return; }
    const parsed = workflowSaveSchema.safeParse({ ...payload(form), name: form.name || "Untitled workflow" });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Complete the workflow first"); return; }
    setPending(true);
    setError(null);
    try {
      const { data } = await apiRequest<WorkflowTestResult>("/api/workflows/test", { method: "POST", body: { orderId, draft: { ...payload(form), name: form.name || "Untitled workflow" } } });
      setResult(data);
    } catch (e) {
      setResult(null);
      setError(isApiError(e) ? e.message : "The test could not run");
    } finally {
      setPending(false);
    }
  };
  return (
    <aside className="flex flex-col gap-3 self-start rounded-xl border border-border bg-surface p-4 xl:sticky xl:top-4">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground"><FlaskConical className="h-4 w-4 text-primary" />Test against order</h2>
      <p className="text-[12px] text-secondary">Runs the unsaved workflow on a real order and rolls everything back.</p>
      <Combobox id="wf-test-order" aria-label="Order to test" loadOptions={load} minChars={0} value={orderId} onChange={(v) => { setOrderId(v); setError(null); }} placeholder="Search order code, customer or address" invalid={Boolean(error)} clearable />
      {error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
      <Button variant="primary" onClick={() => void run()} disabled={pending}>{pending ? <Spinner className="h-3.5 w-3.5" /> : <FlaskConical className="h-4 w-4" />}Run test</Button>
      {result ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <p className="flex items-center gap-2 text-[13px]">
            {result.matched ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-danger" />}
            <span className="font-semibold">{result.orderCode}</span>{result.matched ? "matches" : "doesn't match"}
            {result.blockType ? <Badge tone="danger" size="sm">Blocked · {result.blockType}</Badge> : null}
          </p>
          {result.scopeNote ? <Callout variant="attention">{result.scopeNote}</Callout> : null}
          {result.conditions.length > 0 ? (
            <ul className="flex flex-col gap-1">{result.conditions.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[12px]">{c.passed ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />}<span className={c.passed ? "text-foreground" : "text-secondary"}>{c.text}</span></li>
            ))}</ul>
          ) : <p className="text-[12px] text-secondary">No conditions — every order matches.</p>}
          {result.actions.length > 0 ? (
            <div><h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-secondary">Actions</h3>
              <ul className="flex flex-col gap-1">{result.actions.map((a, i) => (
                <li key={i} className="text-[12px]"><span className={a.applied ? "font-medium text-success" : "font-medium text-secondary"}>{a.applied ? "Applied" : "Skipped"}</span> · {a.action}{a.message ? <span className="text-faint"> — {a.message}</span> : null}</li>
              ))}</ul></div>
          ) : null}
          {result.changes.length > 0 ? (
            <div><h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-secondary">Order would change</h3>
              <ul className="flex flex-col gap-1">{result.changes.map((c) => (
                <li key={c.field} className="text-[12px]"><span className="font-medium">{c.field}</span> <span className="text-faint line-through">{c.from}</span> → <span className="font-medium text-foreground">{c.to}</span></li>
              ))}</ul></div>
          ) : result.matched ? <p className="text-[12px] text-secondary">No order fields would change.</p> : null}
        </div>
      ) : null}
    </aside>
  );
}

function RunHistory({ id }: { readonly id: string }) {
  const fmt = useFormat();
  const fields = React.useMemo(() => toFilterFields(WORKFLOW_RUN_FIELDS), []);
  const g = useLocalGrid<WorkflowRunRow>({ gridKey: WORKFLOW_RUNS_GRID_KEY, path: `/api/workflows/${id}/runs`, fields, initial: { sort: [{ field: "at", dir: "desc" }] } });
  const COLUMNS: GridColumnDef<WorkflowRunRow>[] = [
    { id: "at", header: "Run date", size: 180, cell: ({ row }) => fmt.dateTime(row.original.at) },
    { id: "orderCode", header: "Order", size: 140, cell: ({ row }) => (row.original.orderCode ? <Link className="font-medium text-primary hover:underline" href={`/orders/${row.original.entityId}`}>{row.original.orderCode}</Link> : <Muted>Deleted</Muted>) },
    { id: "matched", header: "Matched", size: 100, cell: ({ row }) => (row.original.matched ? <Badge tone="success" size="sm" shape="pill">Yes</Badge> : <Badge tone="neutral" size="sm" shape="pill">No</Badge>) },
    { id: "actionsApplied", header: "Actions applied", size: 260, enableSorting: false, cell: ({ row }) => (row.original.actionsApplied.length > 0 ? row.original.actionsApplied.join(", ") : <Muted />) },
    { id: "blockType", header: "Block", size: 100, enableSorting: false, cell: ({ row }) => (row.original.blockType ? <Badge tone="danger" size="sm">{row.original.blockType}</Badge> : <Muted />) },
    { id: "error", header: "Notes", size: 300, enableSorting: false, cell: ({ row }) => (row.original.error ? <span className="truncate text-danger" title={row.original.error}>{row.original.error}</span> : <Muted />) },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search order code" />
      <DataGrid<WorkflowRunRow> {...g.gridProps} columns={COLUMNS} getRowId={(r) => r.id} emptyTitle="No runs yet" emptyDescription="Runs appear here each time the trigger fires for an order in scope." />
    </div>
  );
}
