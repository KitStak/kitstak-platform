"use client";

/**
 * Putaway / Allocation algorithm editor (spec 06 §3–§4). Left panel: Primary Information
 * (name, warehouse, Active/Passive, dynamic replenishment exclusivity + info box, enforce suggested)
 * and Rules (If / If-else list, drag reorder, active checkbox, delete, Create New). Right: the rule
 * canvas. Test Algorithm / Dry run test the unsaved draft on the real engines.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, FlaskConical, GripVertical, Info, Plus, Trash2 } from "lucide-react";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { REPLENISHMENT_INFO, algorithmHeaderSchema, type AlgorithmRuleInput, type AlgorithmSlug } from "@/lib/grid-defs/integrations/algorithms";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/ui/info-tip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { UnsavedChangesGuard } from "@/components/ui/unsaved-changes";
import { NO_PERMISSION, usePagePerms, useWarehouseOptions } from "@/components/integrations/shared/shared";
import type { AlgorithmDetail, SaveResult } from "@/server/repositories/algorithms";
import { EmptyCanvas, RuleCanvas } from "../rules/rule-canvas";
import { useRuleNames } from "../rules/rule-names";
import { PutawayTestDialog, type PutawayTestTarget } from "./putaway-test-dialog";
import { DryRunDialog, type DryRunTarget } from "./dry-run-dialog";
import { AlgorithmEditorSkeleton } from "./algorithm-editor-skeleton";

type Rule = AlgorithmRuleInput & { readonly key: string };
interface Header { name: string; warehouseId: string; status: "Active" | "Passive"; isDynamicReplenishment: boolean; enforceSuggestedLocations: boolean }

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));
const stripKey = ({ key: _key, ...r }: Rule): AlgorithmRuleInput => r;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function newRule(kind: "Putaway" | "Allocation", n: number): Rule {
  return kind === "Putaway"
    ? { key: newKey(), name: `Rule ${n}`, isActive: true, conditions: [], inventoryConditions: [], actions: [], orderBy: [{ field: "walkingPathPriority", dir: "asc" }] }
    : { key: newKey(), name: `Rule ${n}`, isActive: true, conditions: [], actions: [],
      inventoryConditions: [{ field: "inventoryDamageReason", comparator: "isEmpty", value: null }, { field: "isAllowOnlyDamaged", comparator: "equals", value: false }],
      orderBy: [{ field: "inventoryExpiryDate", dir: "asc" }, { field: "walkingPathPriority", dir: "asc" }] };
}

function SortableRule({ rule, index, selected, readOnly, onSelect, onToggle, onDelete }: {
  readonly rule: Rule; readonly index: number; readonly selected: boolean; readonly readOnly: boolean;
  readonly onSelect: () => void; readonly onToggle: (v: boolean) => void; readonly onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rule.key, disabled: readOnly });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5", selected ? "border-primary bg-primary-soft/40" : "border-border bg-surface hover:bg-surface-sunken", isDragging && "z-10 shadow-lg")}>
      <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold", index === 0 ? "bg-primary text-white" : "bg-neutral-soft text-secondary")}>{index === 0 ? "If" : `${index}. If else`}</span>
      <Checkbox aria-label={`${rule.name} active`} checked={rule.isActive ?? true} disabled={readOnly} onCheckedChange={(v) => onToggle(v === true)} />
      <button type="button" onClick={onSelect} className={cn("min-w-0 flex-1 truncate text-left text-[13px] focus-visible:outline-none focus-visible:underline", rule.isActive === false ? "text-faint line-through" : "text-foreground", selected && "font-semibold")}>{rule.name || "Untitled rule"}</button>
      {selected && !readOnly ? <button type="button" aria-label={`Delete ${rule.name}`} onClick={onDelete} className="rounded p-1 text-secondary hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"><Trash2 className="h-3.5 w-3.5" /></button> : null}
      <button type="button" aria-label={`Reorder ${rule.name}`} disabled={readOnly} {...attributes} {...listeners} className="cursor-grab rounded p-1 text-faint hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed"><GripVertical className="h-3.5 w-3.5" /></button>
    </li>
  );
}

const replRow = z.array(z.object({ id: z.string(), name: z.string(), status: z.string() }));

export function AlgorithmEditor({ slug, id, initial = null }: { readonly slug: AlgorithmSlug; readonly id: string | null; readonly initial?: AlgorithmDetail | null }) {
  const kind = slug === "putaway" ? "Putaway" : "Allocation";
  // Server-rendered detail paints the editor in the first response; the query still revalidates.
  const detail = useApiQuery<AlgorithmDetail>(["algorithm", id ?? "new"], id ? `/api/algorithms/${id}` : null, initial ? { initialData: { data: initial }, staleTime: 5_000 } : { staleTime: 0 });
  if (id && detail.isPending) return <AlgorithmEditorSkeleton title={`Edit ${kind} Algorithm`} />;
  if (id && (detail.isError || !detail.data)) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState title={detail.error?.status === 404 ? "Algorithm not found" : "Couldn't load this algorithm"} description={detail.error?.status === 404 ? "It may have been deleted, or it belongs to a warehouse you can't access." : detail.error?.message}
          action={<div className="flex gap-2"><Button onClick={() => void detail.refetch()}>Retry</Button><Link href={`/automation/algorithms/${slug}`}><Button variant="secondary">Back to algorithms</Button></Link></div>} />
      </div>
    );
  }
  return <EditorBody key={`${id ?? "new"}-${detail.dataUpdatedAt}`} slug={slug} kind={kind} detail={id ? detail.data?.data ?? null : null} />;
}

function EditorBody({ slug, kind, detail }: { readonly slug: AlgorithmSlug; readonly kind: "Putaway" | "Allocation"; readonly detail: AlgorithmDetail | null }) {
  const router = useRouter();
  const names = useRuleNames();
  const warehouses = useWarehouseOptions();
  const perms = usePagePerms("automation.algorithms", ["create", "edit", "test"] as const);
  const isEdit = detail !== null;
  const readOnly = isEdit ? !perms.edit : !perms.create;
  const initialHeader: Header = detail
    ? { name: detail.name, warehouseId: detail.warehouseId, status: detail.status, isDynamicReplenishment: detail.isDynamicReplenishment, enforceSuggestedLocations: detail.enforceSuggestedLocations }
    : { name: "", warehouseId: warehouses.defaultId ?? "", status: "Active", isDynamicReplenishment: false, enforceSuggestedLocations: false };
  const initialRules: Rule[] = (detail?.rules ?? []).map((r) => ({ key: r.id, name: r.name, isActive: r.isActive, conditions: r.conditions, inventoryConditions: r.inventoryConditions, actions: r.actions, orderBy: r.orderBy }));
  const [header, setHeader] = React.useState<Header>(initialHeader);
  const [rules, setRules] = React.useState<Rule[]>(initialRules);
  const [step, setStep] = React.useState<"info" | "rules">(isEdit ? "rules" : "info");
  const [selected, setSelected] = React.useState<string | null>(initialRules[0]?.key ?? null);
  const [draft, setDraft] = React.useState<Rule | null>(initialRules[0] ?? null);
  const [pendingNew, setPendingNew] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const [test, setTest] = React.useState<PutawayTestTarget | null>(null);
  const [dry, setDry] = React.useState<DryRunTarget | null>(null);
  const [toDelete, setToDelete] = React.useState<Rule | null>(null);
  const [baseline, setBaseline] = React.useState(() => JSON.stringify({ h: initialHeader, r: initialRules.map(stripKey) }));
  if (!isEdit && !header.warehouseId && warehouses.defaultId) setHeader((h) => ({ ...h, warehouseId: warehouses.defaultId ?? "" }));

  const committed = rules.find((r) => r.key === selected) ?? null;
  const draftDirty = draft !== null && (committed === null || !sameJson(stripKey(draft), stripKey(committed)) || pendingNew === draft.key);
  const dirty = draftDirty || JSON.stringify({ h: header, r: rules.filter((r) => r.key !== pendingNew).map(stripKey) }) !== baseline;

  // Replenishment exclusivity (putaway only).
  const repl = useApiQuery<unknown>(["algo-repl", header.warehouseId], kind === "Putaway" && header.warehouseId ? "/api/algorithms" : null,
    { query: { kind: "putaway", "f.isDynamicReplenishment": "bool:true", "f.warehouseId": `in:${header.warehouseId}`, ps: 100 } });
  const replRows = replRow.safeParse(repl.data?.data);
  const otherActiveRepl = (replRows.success ? replRows.data : []).filter((r) => r.id !== detail?.id && r.status === "Active");
  const lockedRepl = kind === "Putaway" && isEdit && detail?.isDynamicReplenishment === true && detail.status === "Active" && otherActiveRepl.length === 0;
  const willPassivate = kind === "Putaway" && header.isDynamicReplenishment && header.status === "Active" && !(detail?.isDynamicReplenishment && detail.status === "Active") ? otherActiveRepl : [];

  const validateHeader = (): boolean => {
    const parsed = algorithmHeaderSchema.safeParse(header);
    const next: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) { setStep("info"); setTimeout(() => document.getElementById(`algo-${first}`)?.focus(), 0); }
    return !first;
  };

  const ruleError = (r: Rule | null): string | null => {
    if (!r) return null;
    if (!r.name.trim()) return "Rule name is required";
    if (rules.some((x) => x.key !== r.key && x.name.trim().toLowerCase() === r.name.trim().toLowerCase())) return "Rule names must be unique";
    if (kind === "Putaway" && (r.actions ?? []).length === 0) return "Add at least one action";
    return null;
  };

  // Inline (not a toast): a toast sits on top of the canvas footer Cancel / Test / Save Rule buttons.
  const [openRuleWarning, setOpenRuleWarning] = React.useState<string | null>(null);
  React.useEffect(() => { if (!draftDirty) setOpenRuleWarning(null); }, [draftDirty]);
  const warnOpenRule = (message: string) => {
    setOpenRuleWarning(message);
    document.getElementById("open-rule-warning")?.scrollIntoView({ block: "nearest" });
  };

  // A new rule nobody has touched yet (e.g. the one Next opens) is discarded silently, never a "finish the rule" warning.
  const untouchedNew = draft !== null && pendingNew === draft.key && committed !== null && sameJson(stripKey(draft), stripKey(committed));
  const focusRuleName = () => setTimeout(() => document.getElementById("rule-name")?.focus(), 0);
  const selectRule = (key: string) => {
    if (key === selected) return;
    if (draftDirty && !untouchedNew) { warnOpenRule("Save Rule or Cancel Rule before switching to another rule."); return; }
    const remaining = untouchedNew ? rules.filter((x) => x.key !== pendingNew) : rules;
    if (untouchedNew) { setRules(remaining); setPendingNew(null); }
    const r = remaining.find((x) => x.key === key) ?? null;
    setSelected(key);
    setDraft(r);
  };
  const createNew = () => {
    if (untouchedNew) { focusRuleName(); return; }
    if (draftDirty) { warnOpenRule("Save Rule or Cancel Rule before creating another one."); return; }
    const r = newRule(kind, rules.length + 1);
    focusRuleName();
    setRules((list) => [...list, r]);
    setPendingNew(r.key);
    setSelected(r.key);
    setDraft(r);
  };
  const cancelRule = () => {
    if (pendingNew && draft?.key === pendingNew) {
      setRules((list) => list.filter((r) => r.key !== pendingNew));
      setPendingNew(null);
      const first = rules.find((r) => r.key !== pendingNew) ?? null;
      setSelected(first?.key ?? null);
      setDraft(first);
      return;
    }
    setDraft(committed);
  };
  const saveRule = () => {
    if (!draft) return;
    const err = ruleError(draft);
    if (err) { toast.error("Rule not saved", err); return; }
    setRules((list) => list.map((r) => (r.key === draft.key ? draft : r)));
    if (pendingNew === draft.key) setPendingNew(null);
  };
  const deleteRule = (r: Rule) => {
    const rest = rules.filter((x) => x.key !== r.key);
    setRules(rest);
    if (pendingNew === r.key) setPendingNew(null);
    setSelected(rest[0]?.key ?? null);
    setDraft(rest[0] ?? null);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setRules((list) => arrayMove(list, list.findIndex((r) => r.key === e.active.id), list.findIndex((r) => r.key === e.over?.id)));
  };

  const draftRulesForTest = (): AlgorithmRuleInput[] => rules.filter((r) => r.key !== pendingNew || r.key === draft?.key).map((r) => stripKey(r.key === draft?.key ? draft : r));
  const testReason = !perms.test ? NO_PERMISSION : !header.warehouseId ? "Choose a warehouse first" : rules.length === 0 && !draft ? "Create at least one rule to test" : kind === "Putaway" && draftRulesForTest().every((r) => (r.actions ?? []).length === 0) ? "Add an action to a rule first" : null;
  const openTest = (onlyDraft: boolean) => {
    const list = onlyDraft && draft ? [stripKey(draft)] : draftRulesForTest();
    const name = onlyDraft && draft ? `${header.name || "New algorithm"} · ${draft.name}` : header.name || "New algorithm";
    // Saved algorithm without edits: test the stored version (no "unsaved" label).
    const draftRules = onlyDraft || dirty || !isEdit ? list : undefined;
    if (kind === "Putaway") setTest({ algorithmId: detail?.id ?? null, name, warehouseId: header.warehouseId, draftRules });
    else setDry({ algorithmId: detail?.id ?? null, name, warehouseId: header.warehouseId, draftRules });
  };

  const save = async () => {
    if (!validateHeader()) return;
    if (draftDirty) { warnOpenRule("Save Rule or Cancel Rule before saving the algorithm."); return; }
    const list = rules.filter((r) => r.key !== pendingNew);
    const bad = list.map((r) => ruleError(r)).find(Boolean);
    if (bad) { setStep("rules"); toast.error("Fix the rules first", bad); return; }
    setSaving(true);
    try {
      const body = { ...header, kind, rules: list.map(stripKey), version: detail?.version };
      const { data } = await apiRequest<SaveResult>(isEdit ? `/api/algorithms/${detail.id}` : "/api/algorithms", { method: isEdit ? "PATCH" : "POST", body });
      toast.success("Success", isEdit ? `Algorithm ${data.algorithm.name} saved.` : `Algorithm ${data.algorithm.name} created.`);
      for (const n of data.notes) toast.info("Dynamic replenishment", n);
      setBaseline(JSON.stringify({ h: header, r: list.map(stripKey) }));
      if (!isEdit) router.replace(`/automation/algorithms/${slug}/${data.algorithm.id}`);
      else router.refresh();
    } catch (error) {
      if (isApiError(error)) {
        if (error.code === "CONFLICT") setConflict(true);
        const fe = error.fieldErrors ?? {};
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(fe)) if (v[0] && ["name", "warehouseId", "status", "isDynamicReplenishment"].includes(k)) next[k] = v[0];
        if (Object.keys(next).length > 0) { setErrors(next); setStep("info"); }
      }
      toast.error("Couldn't save the algorithm", isApiError(error) ? error.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const next = () => { if (validateHeader()) { setStep("rules"); if (rules.length === 0) createNew(); } };
  const draftIndex = draft ? rules.findIndex((r) => r.key === draft.key) : -1;
  const backHref = `/automation/algorithms/${slug}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <UnsavedChangesGuard when={dirty && !saving} />
      <PageHeader title={isEdit ? `Edit ${kind} Algorithm` : `Create ${kind} Algorithm`} crumbLabel="Algorithm Details"
        helper={isEdit ? detail.name : "Primary information first, then the If / If-else rule chain."}
        actions={<Link href={backHref} className="inline-flex items-center gap-1 text-[13px] text-secondary hover:text-primary"><ChevronLeft className="h-4 w-4" />Back to algorithms</Link>} />
      {conflict ? <div className="px-6 pb-2"><Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this algorithm. Reload to see their changes.</Callout></div> : null}
      <div className="flex min-h-[560px] flex-1 overflow-hidden border-t border-border">
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-border bg-surface">
          <div className="p-3">
            <SegmentedControl ariaLabel="Editor step" value={step} onChange={(v) => (v === "rules" && !isEdit ? next() : setStep(v))}
              options={[{ value: "info", label: "Primary Information" }, { value: "rules", label: "Rules" }]} />
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {step === "info" ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <label htmlFor="algo-name" className="text-[12px] font-medium text-body">Algorithm name <span className="text-danger">*</span></label>
                  <TextField id="algo-name" value={header.name} maxLength={80} placeholder="Enter algorithm name" disabled={readOnly || (detail?.isSystem ?? false)} invalid={Boolean(errors.name)}
                    aria-describedby={errors.name ? "algo-name-error" : undefined} onChange={(e) => { setHeader((h) => ({ ...h, name: e.target.value })); setErrors((x) => ({ ...x, name: "" })); }} />
                  {errors.name ? <p id="algo-name-error" role="alert" className="text-[12px] text-danger">{errors.name}</p> : detail?.isSystem ? <p className="text-[11px] text-faint">System algorithms keep their name.</p> : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="algo-warehouseId" className="text-[12px] font-medium text-body">Warehouse <span className="text-danger">*</span></label>
                  <Select id="algo-warehouseId" value={header.warehouseId || null} options={warehouses.options} placeholder="Select warehouse" disabled={readOnly || isEdit} invalid={Boolean(errors.warehouseId)}
                    onChange={(v) => { setHeader((h) => ({ ...h, warehouseId: v ?? "" })); setErrors((x) => ({ ...x, warehouseId: "" })); }} />
                  {errors.warehouseId ? <p role="alert" className="text-[12px] text-danger">{errors.warehouseId}</p> : isEdit ? <p className="text-[11px] text-faint">An algorithm can’t move to another warehouse.</p> : null}
                </div>
                <div className="flex flex-col gap-1">
                  <span id="algo-status-label" className="text-[12px] font-medium text-body">Algorithm status</span>
                  <SegmentedControl ariaLabel="Algorithm status" value={header.status} disabled={readOnly || lockedRepl} onChange={(v) => setHeader((h) => ({ ...h, status: v }))}
                    options={[{ value: "Active", label: "Active" }, { value: "Passive", label: "Passive" }]} />
                  {errors.status ? <p role="alert" className="text-[12px] text-danger">{errors.status}</p> : null}
                </div>
                {kind === "Putaway" ? (
                  <>
                    <Checkbox checked={header.isDynamicReplenishment} disabled={readOnly || lockedRepl} onCheckedChange={(v) => setHeader((h) => ({ ...h, isDynamicReplenishment: v === true }))}
                      label="Use this algorithm as dynamic replenishment algorithm." />
                    {errors.isDynamicReplenishment ? <p role="alert" className="text-[12px] text-danger">{errors.isDynamicReplenishment}</p> : null}
                    <div className="flex items-start gap-1">
                      <Checkbox checked={header.enforceSuggestedLocations} disabled={readOnly} onCheckedChange={(v) => setHeader((h) => ({ ...h, enforceSuggestedLocations: v === true }))}
                        label="Enforce suggested locations on mobile directed putaway." />
                      <InfoTip content="Mobile users must put away to one of the suggested locations; other locations are rejected." />
                    </div>
                    {lockedRepl || header.isDynamicReplenishment ? <Callout variant="info" title="Dynamic replenishment">{REPLENISHMENT_INFO}</Callout> : null}
                    {willPassivate.length > 0 ? (
                      <Callout variant="attention" title="Another algorithm will become passive">
                        {willPassivate.map((r) => r.name).join(", ")} {willPassivate.length === 1 ? "handles" : "handle"} dynamic replenishment today. When you save, {willPassivate.length === 1 ? "it becomes" : "they become"} passive and this algorithm takes over.
                      </Callout>
                    ) : null}
                  </>
                ) : (
                  <p className="rounded-lg bg-surface-sunken px-3 py-2 text-[12px] text-secondary">Orders are allocated with the first rule whose order conditions match; its inventory conditions filter stock and its order-by keys pick what goes first.</p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-[13px] font-semibold text-foreground">Rule List</h2>
                    <p className="text-[11px] text-secondary">All the rules for this {kind.toLowerCase()} algorithm, evaluated top to bottom.</p>
                  </div>
                  <DisabledReason reason={readOnly ? NO_PERMISSION : null}><Button size="sm" variant="secondary" disabled={readOnly} onClick={createNew}><Plus className="h-3.5 w-3.5" />Create New</Button></DisabledReason>
                </div>
                <div id="open-rule-warning" aria-live="polite">{openRuleWarning ? <Callout variant="attention" title="Finish the open rule">{openRuleWarning}</Callout> : null}</div>
                {rules.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-secondary">No rules yet. Without rules the {kind === "Putaway" ? "default same SKU / empty location" : "default FEFO"} chain is used.</p> : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={rules.map((r) => r.key)} strategy={verticalListSortingStrategy}>
                      <ul className="flex flex-col gap-1.5" aria-label="Rules">
                        {rules.map((r, i) => (
                          <SortableRule key={r.key} rule={r.key === draft?.key ? draft : r} index={i} selected={r.key === selected} readOnly={readOnly}
                            onSelect={() => selectRule(r.key)} onDelete={() => setToDelete(r)}
                            onToggle={(v) => { setRules((list) => list.map((x) => (x.key === r.key ? { ...x, isActive: v } : x))); if (draft?.key === r.key) setDraft({ ...draft, isActive: v }); }} />
                        ))}
                      </ul>
                    </SortableContext>
                  </DndContext>
                )}
                <p className="flex items-start gap-1.5 rounded-lg bg-surface-sunken px-3 py-2 text-[11px] text-secondary"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />Use Create New to add an If else rule. Drag the handle to change the order.</p>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t border-border p-3">
            <DisabledReason reason={testReason}>
              <Button variant="secondary" className="w-full" disabled={Boolean(testReason)} onClick={() => openTest(false)}><FlaskConical className="h-4 w-4" />{kind === "Putaway" ? "Test Algorithm" : "Dry run for order"}</Button>
            </DisabledReason>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => router.push(backHref)}>Cancel</Button>
              {!isEdit && step === "info"
                ? <Button variant="primary" className="flex-1" onClick={next} disabled={readOnly}>Next</Button>
                : <DisabledReason reason={readOnly ? NO_PERMISSION : !dirty ? "No changes to save" : null}><Button variant="primary" className="flex-1" onClick={() => void save()} disabled={readOnly || saving || !dirty}>{saving ? "Saving…" : "Save"}</Button></DisabledReason>}
            </div>
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          {step === "rules" && draft ? (
            <RuleCanvas kind={kind} rule={draft} index={Math.max(0, draftIndex)} onChange={(r) => setDraft({ ...r, key: draft.key })} names={names} warehouseId={header.warehouseId || null}
              readOnly={readOnly} dirty={draftDirty} nameError={draft.name.trim() ? null : "Rule name is required"} onCancel={cancelRule} onSave={saveRule}
              onTest={() => openTest(true)} testReason={!perms.test ? NO_PERMISSION : kind === "Putaway" && (draft.actions ?? []).length === 0 ? "Add an action to test this rule" : null} />
          ) : (
            <EmptyCanvas message={step === "info" ? (isEdit ? "Open Rules to view and edit the rule chain." : "Fill in the primary information, then press Next to build the rules.") : kind === "Putaway" ? "Press 'Create New' to create a rule. Select a rule to view its details." : "Press 'Create New' to create a rule."} />
          )}
        </section>
      </div>
      <PutawayTestDialog target={test} onOpenChange={(o) => !o && setTest(null)} />
      <DryRunDialog target={dry} onOpenChange={(o) => !o && setDry(null)} />
      <ConfirmDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)} variant="danger" title={`Delete rule ${toDelete?.name ?? ""}?`}
        description="The rule is removed from the chain when you save the algorithm." confirmLabel="Yes, delete" cancelLabel="No"
        onConfirm={() => { if (toDelete) deleteRule(toDelete); setToDelete(null); }} />
      {isEdit && detail.isSystem ? <span className="sr-only"><Badge>System algorithm</Badge></span> : null}
    </div>
  );
}
