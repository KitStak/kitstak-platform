"use client";

/**
 * Rule builder modals shared by algorithms and workflows (spec 06 §3–§4):
 * - Add/Edit Condition: Apply To All or Specify; field list per catalog, comparators by field
 *   type, and a typed value editor (lookup multi-select, number, text, date, yes/no).
 * - Add/Edit Action (putaway): the 38 actions; parameterised ones show a value field.
 * - Add/Edit Order By: method + Ascending/Descending ("Add Order By" — fixes Logiwa's copy bug).
 * Every modal validates inline and keeps Add disabled with a reason until complete.
 */
import * as React from "react";
import type { ConditionValue, OrderByClause, RuleCondition } from "@/lib/domain-types";
import type { RuleComparator } from "@/lib/enums";
import {
  CONDITION_CATALOGS, DATE_PRESETS, DATE_SPEC_COMPARATOR, PUTAWAY_ACTION_DEFS, RELATIVE_DATES_SUPPORTED, VALUELESS, comparatorLabel, comparatorsFor, datePresetValue, fieldDef, parseDatePresetValue, putawayActionDef,
  type ConditionCatalog, type OrderByMethod, type RuleFieldDef,
} from "@/lib/grid-defs/integrations/rule-fields";
import { splitCamel } from "@/lib/grid-defs/integrations/common";
import { LocationPicker } from "@/components/shared/entity-pickers";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { DisabledReason } from "@/components/ui/tooltip";
import { useClientOptions, useEntityOptions, useLookups, useWarehouseOptions } from "@/components/integrations/shared/shared";
import type { AlgorithmAction } from "@/server/db/schema";

function Field({ id, label, required, error, children }: { readonly id: string; readonly label: string; readonly required?: boolean; readonly error?: string | null; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-body">{label}{required ? <span className="text-danger"> *</span> : null}</label>
      {children}
      {error ? <p id={`${id}-error`} role="alert" className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

/* ---------------- value editor ---------------- */

function useKindOptions(def: RuleFieldDef | undefined): readonly ComboboxOption[] {
  const clients = useClientOptions();
  const warehouses = useWarehouseOptions();
  const lookup = useLookups(def?.kind === "lookup" ? (def.lookup ?? "product_group") : "product_group");
  const entities = useEntityOptions(def?.kind === "retailer" || def?.kind === "package" ? def.kind : null);
  if (!def) return [];
  if (def.kind === "retailer" || def.kind === "package") return entities;
  if (def.kind === "client") return clients;
  if (def.kind === "warehouse") return warehouses.short;
  if (def.kind === "lookup") return lookup.options;
  if (def.kind === "enum") return (def.options ?? []).map((o) => ({ value: o, label: splitCamel(o) }));
  return [];
}

const EMPTY_OPTION: ComboboxOption = { value: "Empty", label: "Empty (no value)" };

export function ConditionValueEditor({ id, def, comparator, value, onChange, invalid, presetInComparator = false }: {
  readonly id: string; readonly def: RuleFieldDef; readonly comparator: RuleComparator; readonly value: ConditionValue;
  readonly onChange: (v: ConditionValue) => void; readonly invalid?: boolean;
  /** The relative-date preset was already picked in the comparator list. */
  readonly presetInComparator?: boolean;
}) {
  const options = useKindOptions(def);
  if (VALUELESS.has(comparator)) return <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-secondary">No value needed.</p>;
  if (def.kind === "enum" || def.kind === "lookup" || def.kind === "client" || def.kind === "warehouse" || def.kind === "retailer" || def.kind === "package") {
    const list = Array.isArray(value) ? value.map(String) : value === null || value === "" ? [] : [String(value)];
    return <Combobox id={id} multiple aria-label={def.label} options={[...options, EMPTY_OPTION]} value={list} onChange={(v) => onChange([...v])} placeholder={`Select ${def.label.toLowerCase()}`} invalid={invalid} />;
  }
  if (def.kind === "boolean") {
    const v = value === true || value === "true" ? "true" : "false";
    return <SegmentedControl ariaLabel={def.label} value={v} onChange={(x) => onChange(x === "true")} options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]} />;
  }
  const pair = Array.isArray(value) ? value : [value ?? "", ""];
  if (def.kind === "number") {
    const num = (x: unknown) => (typeof x === "number" ? x : x === "" || x === null || x === undefined ? null : Number(x));
    if (comparator === "between") {
      return (
        <div className="flex items-center gap-2">
          <NumberInput id={id} aria-label="From" value={num(pair[0])} onChange={(n) => onChange([n ?? "", pair[1] ?? ""] as ConditionValue)} decimals={2} invalid={invalid} />
          <span className="text-xs text-faint">and</span>
          <NumberInput aria-label="To" value={num(pair[1])} onChange={(n) => onChange([pair[0] ?? "", n ?? ""] as ConditionValue)} decimals={2} invalid={invalid} />
        </div>
      );
    }
    return <NumberInput id={id} aria-label={def.label} value={num(Array.isArray(value) ? value[0] : value)} onChange={(n) => onChange(n)} decimals={2} invalid={invalid} />;
  }
  if (def.kind === "date" && comparator === DATE_SPEC_COMPARATOR) {
    const parsed = parseDatePresetValue(value);
    const presetKey = parsed?.preset.key ?? null;
    const days = parsed?.days ?? null;
    // The condition modal lists the presets as comparators, so only the day count is left here.
    if (presetInComparator) {
      if (!parsed?.preset.needsDays) return <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-secondary">No value needed. Resolved each time the rule runs, so it never goes stale.</p>;
      return (
        <div className="flex items-center gap-2">
          <div className="w-28 shrink-0"><NumberInput id={id} aria-label="Number of days" value={days} min={0} max={3650} onChange={(n) => onChange(datePresetValue(parsed.preset.key, n ?? 0))} invalid={invalid} /></div>
          <span className="text-xs text-secondary">{(days ?? 0) === 1 ? "day" : "days"}</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Select id={id} aria-label="Date range" value={presetKey} placeholder="Select a date range"
            onChange={(k) => { if (k) onChange(datePresetValue(k, DATE_PRESETS.find((p) => p.key === k)?.needsDays ? (days ?? 7) : null)); }}
            options={DATE_PRESETS.map((p) => ({ value: p.key, label: p.label }))} />
        </div>
        {parsed?.preset.needsDays ? (
          <div className="w-28 shrink-0">
            <NumberInput aria-label="Number of days" value={days} min={0} max={3650} onChange={(n) => onChange(datePresetValue(parsed.preset.key, n ?? 0))} invalid={invalid} />
          </div>
        ) : null}
      </div>
    );
  }
  if (def.kind === "date") {
    const d = (x: unknown) => (typeof x === "string" ? x.slice(0, 10) : "");
    if (comparator === "between") {
      return (
        <div className="flex items-center gap-2">
          <TextField id={id} type="date" aria-label="From" value={d(pair[0])} onChange={(e) => onChange([e.target.value, String(pair[1] ?? "")])} invalid={invalid} />
          <span className="text-xs text-faint">and</span>
          <TextField type="date" aria-label="To" value={d(pair[1])} onChange={(e) => onChange([String(pair[0] ?? ""), e.target.value])} invalid={invalid} />
        </div>
      );
    }
    return <TextField id={id} type="date" aria-label={def.label} value={d(Array.isArray(value) ? value[0] : value)} onChange={(e) => onChange(e.target.value)} invalid={invalid} />;
  }
  return <TextField id={id} aria-label={def.label} value={typeof value === "string" ? value : ""} maxLength={200} onChange={(e) => onChange(e.target.value)} placeholder={`Enter ${def.label.toLowerCase()}`} invalid={invalid} />;
}

/** Returns an error message when the value is incomplete for the comparator. */
export function conditionValueError(def: RuleFieldDef | undefined, comparator: RuleComparator | null, value: ConditionValue): string | null {
  if (!def) return "Choose a field";
  if (!comparator) return "Choose a comparator";
  if (VALUELESS.has(comparator) || def.kind === "boolean") return null;
  if (comparator === DATE_SPEC_COMPARATOR) return parseDatePresetValue(value) ? null : "Choose a date range";
  if (Array.isArray(value)) {
    if (comparator === "between") return value.length === 2 && value.every((v) => v !== "" && v !== null) ? null : "Enter both values";
    return value.length > 0 ? null : "Choose at least one value";
  }
  return value === null || value === "" || value === undefined ? "Enter a value" : null;
}

function defaultValue(def: RuleFieldDef, comparator: RuleComparator): ConditionValue {
  if (VALUELESS.has(comparator)) return null;
  if (def.kind === "boolean") return true;
  if (comparator === DATE_SPEC_COMPARATOR) return "today";
  if (comparator === "between") return ["", ""];
  if (comparator === "in" || comparator === "notIn") return [];
  return def.kind === "number" ? null : "";
}

/* ---------------- condition modal ---------------- */

const PRESET_PREFIX = "preset:";
const WEEKDAY_KEYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const EXACT_DATE_COMPARATORS: readonly RuleComparator[] = ["between", "gt", "lt", "isEmpty", "isNotEmpty"];

/**
 * Comparator choices. Date fields list Logiwa's relative presets (Today, Last 3/7/30/90 Days,
 * Last 12 Months, X Days Ahead/Before, Within Next/Past X Days, weekdays) as first-class
 * comparators, then the exact-date ones (between / after / before / empty).
 */
export function comparatorChoices(def: RuleFieldDef): { value: string; label: string; group?: string }[] {
  if (def.kind === "date" && RELATIVE_DATES_SUPPORTED) {
    return [
      ...DATE_PRESETS.map((p) => ({ value: `${PRESET_PREFIX}${p.key}`, label: p.needsDays ? p.label.replace("X Days", "X days") : p.label, group: p.needsDays ? "Relative to today" : WEEKDAY_KEYS.has(p.key) ? "Weekday" : "Date range" })),
      ...EXACT_DATE_COMPARATORS.map((c) => ({ value: c, label: comparatorLabel(def.kind, c), group: "Exact date" })),
    ];
  }
  return comparatorsFor(def.kind).map((c) => ({ value: c, label: comparatorLabel(def.kind, c) }));
}

/** Select value for a comparator (+ value): relative dates read as `preset:<key>`. */
function comparatorChoiceValue(comparator: RuleComparator | null, value: ConditionValue): string | null {
  if (comparator !== DATE_SPEC_COMPARATOR) return comparator;
  return `${PRESET_PREFIX}${parseDatePresetValue(value)?.preset.key ?? "today"}`;
}

export interface ConditionModalState {
  readonly title: string;
  readonly catalog: ConditionCatalog;
  readonly initial: RuleCondition | null;
  /** Show the Apply To All option (rule order conditions). */
  readonly allowApplyAll: boolean;
}

export function ConditionModal({ state, onClose, onSubmit }: { readonly state: ConditionModalState | null; readonly onClose: () => void; readonly onSubmit: (c: RuleCondition | "all") => void }) {
  const [mode, setMode] = React.useState<"all" | "specify">("specify");
  const [field, setField] = React.useState<string | null>(null);
  const [comparator, setComparator] = React.useState<RuleComparator | null>(null);
  const [value, setValue] = React.useState<ConditionValue>(null);
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (!state) return;
    setMode(state.initial || !state.allowApplyAll ? "specify" : "specify");
    setField(state.initial?.field ?? null);
    setComparator(state.initial?.comparator ?? null);
    setValue(state.initial?.value ?? null);
    setTouched(false);
  }, [state]);
  const catalog = state?.catalog ?? "order";
  const def = field ? fieldDef(catalog, field) : undefined;
  const fieldOptions = CONDITION_CATALOGS[catalog].map((f) => ({ value: f.key, label: f.label, description: f.group }));
  const error = mode === "all" ? null : conditionValueError(def, comparator, value);
  const submit = () => {
    setTouched(true);
    if (mode === "all") { onSubmit("all"); return; }
    if (error || !def || !comparator) {
      document.getElementById(!def ? "cond-field" : !comparator ? "cond-cmp" : "cond-value")?.focus();
      return;
    }
    onSubmit({ field: def.key, comparator, value: VALUELESS.has(comparator) ? null : value });
  };
  return (
    <Dialog open={state !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md" onKeyDown={(e) => { if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && (e.target as HTMLElement).getAttribute("role") !== "combobox") { e.preventDefault(); submit(); } }}>
        <DialogHeader title={state?.title ?? "Add condition"} description="Conditions decide when this rule applies." />
        <DialogBody className="flex flex-col gap-4">
          {state?.allowApplyAll ? (
            <SegmentedControl ariaLabel="Condition mode" value={mode} onChange={setMode} options={[{ value: "all", label: "Apply To All" }, { value: "specify", label: "Specify Condition" }]} />
          ) : null}
          {mode === "all" ? (
            <p className="rounded-lg border border-border bg-surface-sunken/60 px-3 py-3 text-sm text-body">The rule applies to everything. Any specific conditions on this rule are replaced by <span className="font-semibold">Applied to all</span>.</p>
          ) : (
            <>
              <Field id="cond-field" label="If" required error={touched && !def ? "Choose a field" : null}>
                <Combobox id="cond-field" aria-label="Field" options={fieldOptions} value={field} onChange={(v) => {
                  setField(v);
                  const d = v ? fieldDef(catalog, v) : undefined;
                  const c = d ? comparatorsFor(d.kind)[0] ?? null : null;
                  setComparator(c);
                  setValue(d && c ? defaultValue(d, c) : null);
                }} placeholder="Select a field" invalid={touched && !def} />
              </Field>
              {def ? (
                <Field id="cond-cmp" label="Comparator" required error={touched && !comparator ? "Choose a comparator" : null}>
                  <Select id="cond-cmp" value={comparatorChoiceValue(comparator, value)} onChange={(c) => {
                    if (!c) return;
                    if (c.startsWith(PRESET_PREFIX)) {
                      const key = c.slice(PRESET_PREFIX.length);
                      setComparator(DATE_SPEC_COMPARATOR);
                      setValue(datePresetValue(key, DATE_PRESETS.find((p) => p.key === key)?.needsDays ? 7 : null));
                      return;
                    }
                    const next = c as RuleComparator;
                    setComparator(next);
                    setValue(defaultValue(def, next));
                  }}
                    options={comparatorChoices(def)} />
                </Field>
              ) : null}
              {def && comparator ? (
                <Field id="cond-value" label={comparator === DATE_SPEC_COMPARATOR && parseDatePresetValue(value)?.preset.needsDays ? "Number of days" : "Value"} required={!VALUELESS.has(comparator)} error={touched ? error : null}>
                  <ConditionValueEditor id="cond-value" def={def} comparator={comparator} value={value} onChange={setValue} invalid={touched && Boolean(error)} presetInComparator={def.kind === "date"} />
                </Field>
              ) : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {/* Guarded like Next/Save elsewhere: disabled, with the reason, until field, comparator and value are complete. */}
          <DisabledReason reason={error}><Button variant="primary" onClick={submit} disabled={Boolean(error)}>{state?.initial ? "Save condition" : "Add"}</Button></DisabledReason>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- action modal ---------------- */

export function ActionModal({ open, initial, warehouseId, onClose, onSubmit }: { readonly open: boolean; readonly initial: AlgorithmAction | null; readonly warehouseId: string | null; readonly onClose: () => void; readonly onSubmit: (a: AlgorithmAction) => void }) {
  const [key, setKey] = React.useState<string | null>(null);
  const [value, setValue] = React.useState<unknown>(null);
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => { if (open) { setKey(initial?.action ?? null); setValue(initial?.value ?? null); setTouched(false); } }, [open, initial]);
  const def = key ? putawayActionDef(key) : undefined;
  const lookup = useLookups(def?.param === "lookup" ? (def.lookup ?? "product_group") : "product_group");
  const needsValue = def && def.param !== "none";
  const missing = !def ? "Choose an action" : needsValue && (value === null || value === "" || (Array.isArray(value) && value.length === 0)) ? `Enter ${def.paramLabel?.toLowerCase() ?? "a value"}` : null;
  const submit = () => {
    setTouched(true);
    if (missing || !def) { document.getElementById(!def ? "act-key" : "act-value")?.focus(); return; }
    onSubmit(needsValue ? { action: def.key, value } : { action: def.key });
  };
  const options = [
    ...PUTAWAY_ACTION_DEFS.filter((a) => a.kind === "check").map((a) => ({ value: a.key, label: a.label, description: "Check" })),
    ...PUTAWAY_ACTION_DEFS.filter((a) => a.kind === "suggest").map((a) => ({ value: a.key, label: a.label, description: "Suggest" })),
  ];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader title={initial ? "Edit action" : "Add action"} description="Actions narrow and choose the candidate locations. Every action must hold (AND)." />
        <DialogBody className="flex flex-col gap-4">
          <Field id="act-key" label="Action" required error={touched && !def ? "Choose an action" : null}>
            <Combobox id="act-key" aria-label="Action" options={options} value={key} onChange={(v) => { setKey(v); setValue(null); }} placeholder="Search 38 actions" invalid={touched && !def} />
          </Field>
          {def && needsValue ? (
            <Field id="act-value" label={def.paramLabel ?? "Value"} required error={touched ? missing : null}>
              {def.param === "number" ? <NumberInput id="act-value" value={typeof value === "number" ? value : null} onChange={setValue} min={0} decimals={2} invalid={touched && Boolean(missing)} />
                : def.param === "text" ? <TextField id="act-value" value={typeof value === "string" ? value : ""} maxLength={100} onChange={(e) => setValue(e.target.value)} invalid={touched && Boolean(missing)} />
                : def.param === "location" ? <LocationPicker id="act-value" warehouseId={warehouseId} value={typeof value === "string" ? value : null} onChange={(v) => setValue(v)} invalid={touched && Boolean(missing)} />
                : <Combobox id="act-value" multiple aria-label={def.paramLabel ?? "Value"} value={Array.isArray(value) ? value.map(String) : typeof value === "string" && value ? [value] : []}
                    options={def.param === "lookup" ? lookup.options : (def.options ?? []).map((o) => ({ value: o, label: splitCamel(o) }))} onChange={(v) => setValue([...v])} invalid={touched && Boolean(missing)} />}
            </Field>
          ) : def ? <p className="text-xs text-secondary">This action has no settings.</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={touched && Boolean(missing)}>{initial ? "Save action" : "Add action"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- order-by modal ---------------- */

export function OrderByModal({ open, initial, methods, used, onClose, onSubmit }: {
  readonly open: boolean; readonly initial: OrderByClause | null; readonly methods: readonly OrderByMethod[]; readonly used: readonly string[];
  readonly onClose: () => void; readonly onSubmit: (o: OrderByClause) => void;
}) {
  const [field, setField] = React.useState<string | null>(null);
  const [dir, setDir] = React.useState<"asc" | "desc">("asc");
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => { if (open) { setField(initial?.field ?? null); setDir(initial?.dir ?? "asc"); setTouched(false); } }, [open, initial]);
  const submit = () => {
    setTouched(true);
    if (!field) { document.getElementById("ob-field")?.focus(); return; }
    onSubmit({ field, dir });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader title={initial ? "Edit order by" : "Add order by"} description="Candidates are sorted by each method in turn (THEN)." />
        <DialogBody className="flex flex-col gap-4">
          <Field id="ob-field" label="Order by method" required error={touched && !field ? "Choose a method" : null}>
            <Select id="ob-field" value={field} onChange={setField} invalid={touched && !field} placeholder="Select a method"
              options={methods.map((m) => ({ value: m.key, label: m.label, disabled: m.key !== initial?.field && used.includes(m.key) }))} />
          </Field>
          <Field id="ob-dir" label="Sort method" required>
            <SegmentedControl ariaLabel="Sort method" value={dir} onChange={setDir} options={[{ value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>{initial ? "Save order by" : "Add Order By"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
