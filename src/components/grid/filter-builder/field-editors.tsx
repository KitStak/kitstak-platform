"use client";

/**
 * Typed filter field editors (BUILD_PLAN F4.3): enum checklist (+ "Empty"), text with
 * six operators, numeric Min–Max, boolean, and date with 18 presets plus Custom
 * From/To and an "X day" input. Controlled: `draft` in, `onChange(draft)` out.
 */
import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInputDateTime, parseInputDateTime } from "@/lib/format";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { DateField } from "@/components/ui/date-picker";
import { TEXT_FILTER_OPS, TEXT_FILTER_OP_LABELS, type FilterFieldDef, type TextFilterOp } from "../grid-types";
import { DATE_PRESET_OPTIONS, findDatePreset, type DateEditorValue, type DatePresetKey } from "./date-presets";
import { EMPTY_OPTION_VALUE, type FilterDraft } from "./filter-model";

const ENUM_SEARCH_ABOVE = 8;

interface EditorProps<D extends FilterDraft> {
  readonly def: FilterFieldDef;
  readonly draft: D;
  readonly onChange: (draft: D) => void;
}

function EnumEditor({ def, draft, onChange }: EditorProps<Extract<FilterDraft, { type: "enum" }>>) {
  const [query, setQuery] = React.useState("");
  const options = React.useMemo(() => {
    const base = def.options ?? [];
    const withEmpty = def.allowEmpty ? [...base, { value: EMPTY_OPTION_VALUE, label: "Empty" }] : base;
    const q = query.trim().toLowerCase();
    return q ? withEmpty.filter((o) => o.label.toLowerCase().includes(q)) : withEmpty;
  }, [def.options, def.allowEmpty, query]);
  const selected = new Set(draft.values);
  const toggle = (value: string, on: boolean) =>
    onChange({ ...draft, type: "enum", values: on ? [...draft.values, value] : draft.values.filter((v) => v !== value) });
  const allValues = (def.options ?? []).map((o) => o.value);
  const allOn = allValues.length > 0 && allValues.every((v) => selected.has(v));

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={`${def.label} match`} className="inline-flex w-fit rounded-md border border-border p-0.5 text-[12px]">
        {([[false, "Is any of"], [true, "Is none of"]] as const).map(([ex, label]) => (
          <button key={label} type="button" role="radio" aria-checked={Boolean(draft.exclude) === ex} onClick={() => onChange({ ...draft, exclude: ex })}
            className={cn("rounded px-2 py-0.5 font-medium", Boolean(draft.exclude) === ex ? "bg-info-soft text-info" : "text-secondary hover:bg-muted")}>
            {label}
          </button>
        ))}
      </div>
      {(def.options?.length ?? 0) > ENUM_SEARCH_ABOVE ? (
        <TextField size="sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search values" aria-label={`Search ${def.label} values`} leading={<Search className="h-3.5 w-3.5" aria-hidden />} />
      ) : null}
      <div className="flex items-center justify-between text-[11px] text-faint">
        <span>Selected: {draft.values.length}</span>
        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onChange({ ...draft, type: "enum", values: allOn ? [] : allValues })}>
          {allOn ? "Clear all" : "Select all"}
        </button>
      </div>
      <ul className="ks-scroll flex max-h-56 flex-col gap-1.5 overflow-auto pr-1" aria-label={`${def.label} values`}>
        {options.length === 0 ? <li className="py-3 text-center text-[12px] text-faint">No matching values</li> : null}
        {options.map((o) => (
          <li key={o.value}>
            <Checkbox label={o.label} checked={selected.has(o.value)} onCheckedChange={(c) => toggle(o.value, c === true)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const TEXT_OP_OPTIONS = TEXT_FILTER_OPS.map((op) => ({ value: op, label: TEXT_FILTER_OP_LABELS[op] }));

function TextEditor({ def, draft, onChange }: EditorProps<Extract<FilterDraft, { type: "text" }>>) {
  const needsValue = draft.op !== "ex" && draft.op !== "empty";
  return (
    <div className="flex flex-col gap-2">
      <Select<TextFilterOp> size="sm" options={TEXT_OP_OPTIONS} value={draft.op} onChange={(op) => onChange({ ...draft, op: op ?? "ct" })} aria-label={`${def.label} operator`} />
      {needsValue ? (
        <TextField size="sm" autoFocus value={draft.value} maxLength={500} onChange={(e) => onChange({ ...draft, value: e.target.value })} placeholder={draft.op === "nin" ? "Values to exclude, comma separated" : `Enter ${def.label.toLowerCase()}`} aria-label={`${def.label} value`} />
      ) : null}
    </div>
  );
}

function NumberEditor({ def, draft, onChange }: EditorProps<Extract<FilterDraft, { type: "number" }>>) {
  const decimals = def.decimals ?? 0;
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-secondary">
        Min
        <NumberInput size="sm" decimals={decimals} value={draft.min} onChange={(min) => onChange({ ...draft, min })} aria-label={`${def.label} minimum`} />
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-secondary">
        Max
        <NumberInput size="sm" decimals={decimals} value={draft.max} onChange={(max) => onChange({ ...draft, max })} aria-label={`${def.label} maximum`} />
      </label>
    </div>
  );
}

const YES_NO = [
  { value: true, label: "Yes", on: "border-success bg-success-soft text-success" },
  { value: false, label: "No", on: "border-danger bg-danger-soft text-danger" },
] as const;

function BooleanEditor({ def, draft, onChange }: EditorProps<Extract<FilterDraft, { type: "boolean" }>>) {
  return (
    <div role="group" aria-label={def.label} className="grid grid-cols-2 gap-2">
      {YES_NO.map((o) => (
        <button
          key={o.label}
          type="button"
          aria-pressed={draft.value === o.value}
          onClick={() => onChange({ type: "boolean", value: draft.value === o.value ? null : o.value })}
          className={cn(
            "h-8 rounded-md border text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30",
            draft.value === o.value ? o.on : "border-border text-secondary hover:bg-surface-sunken"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function toPickerDate(text: string): Date | null {
  return text ? parseInputDateTime(text) : null;
}

function DateEditor({ def, draft, onChange }: EditorProps<Extract<FilterDraft, { type: "date" }>>) {
  const value = draft.date;
  const set = (patch: Partial<DateEditorValue>) => onChange({ type: "date", date: { ...value, ...patch } });
  const option = value.preset ? findDatePreset(value.preset) : undefined;
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={`${def.label} date range`} className="ks-scroll grid max-h-56 grid-cols-2 gap-1 overflow-auto pr-1">
        {DATE_PRESET_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={value.preset === o.key}
            onClick={() => set({ preset: o.key as DatePresetKey })}
            className={cn(
              "rounded-md border px-2 py-1.5 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30",
              value.preset === o.key ? "border-primary bg-primary-soft font-semibold text-primary" : "border-border text-body hover:bg-surface-sunken"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {option?.needsDays ? (
        <label className="flex items-center gap-2 text-[12px] text-secondary">
          X day
          <NumberInput size="sm" className="w-24" min={0} max={3650} value={value.days} onChange={(days) => set({ days: days ?? 0 })} aria-label="Number of days" />
        </label>
      ) : null}
      {option?.key === "custom" ? (
        <div className="grid grid-cols-1 gap-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-secondary">
            From
            <DateField includeTime size="sm" value={toPickerDate(value.from)} onChange={(d) => set({ from: d ? formatInputDateTime(d) : "" })} clearable />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-secondary">
            To
            <DateField includeTime size="sm" value={toPickerDate(value.to)} onChange={(d) => set({ to: d ? formatInputDateTime(d) : "" })} clearable />
          </label>
        </div>
      ) : null}
    </div>
  );
}

export function FieldEditor({ def, draft, onChange }: { readonly def: FilterFieldDef; readonly draft: FilterDraft; readonly onChange: (draft: FilterDraft) => void }) {
  switch (draft.type) {
    case "enum":
      return <EnumEditor def={def} draft={draft} onChange={onChange} />;
    case "text":
      return <TextEditor def={def} draft={draft} onChange={onChange} />;
    case "number":
      return <NumberEditor def={def} draft={draft} onChange={onChange} />;
    case "boolean":
      return <BooleanEditor def={def} draft={draft} onChange={onChange} />;
    case "date":
      return <DateEditor def={def} draft={draft} onChange={onChange} />;
  }
}
