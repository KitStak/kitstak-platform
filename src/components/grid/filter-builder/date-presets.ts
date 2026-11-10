/**
 * The 18 date filter presets the field editor offers (Logiwa parity), mapped onto the
 * grid grammar's `DateSpec` (src/server/query/date-presets.ts). PURE.
 *   6 fixed ranges · 7 weekdays · 4 "X day" relatives (need a day count) · Custom
 */
import {
  serializeDateSpec,
  type DateSpec,
  type FixedDatePreset,
  type RelativeDatePreset,
  type WeekdayPreset,
} from "@/server/query/date-presets";

export type DatePresetKey = FixedDatePreset | WeekdayPreset | RelativeDatePreset | "custom";

export interface DatePresetOption {
  readonly key: DatePresetKey;
  readonly label: string;
  readonly group: "Range" | "Day" | "Relative" | "Custom";
  /** Relative presets need the "X day" input. */
  readonly needsDays: boolean;
}

const fixed = (key: FixedDatePreset, label: string): DatePresetOption => ({ key, label, group: "Range", needsDays: false });
const day = (key: WeekdayPreset, label: string): DatePresetOption => ({ key, label, group: "Day", needsDays: false });
const rel = (key: RelativeDatePreset, label: string): DatePresetOption => ({ key, label, group: "Relative", needsDays: true });

export const DATE_PRESET_OPTIONS: readonly DatePresetOption[] = [
  fixed("today", "Today"),
  fixed("last3d", "Last 3 Days"),
  fixed("last7d", "Last 7 Days"),
  fixed("last30d", "Last 30 Days"),
  fixed("last90d", "Last 90 Days"),
  fixed("last12m", "Last 12 Months"),
  day("sun", "Sunday"),
  day("mon", "Monday"),
  day("tue", "Tuesday"),
  day("wed", "Wednesday"),
  day("thu", "Thursday"),
  day("fri", "Friday"),
  day("sat", "Saturday"),
  rel("ahead", "X Day(s) Ahead and More"),
  rel("before", "X Day(s) Before and More"),
  rel("withinPast", "Within X Day(s) Past"),
  rel("withinNext", "Within X Next Day(s)"),
  { key: "custom", label: "Custom", group: "Custom", needsDays: false },
];

export const DEFAULT_RELATIVE_DAYS = 1;

export function findDatePreset(key: DatePresetKey): DatePresetOption | undefined {
  return DATE_PRESET_OPTIONS.find((o) => o.key === key);
}

export interface DateEditorValue {
  readonly preset: DatePresetKey | null;
  readonly days: number;
  /** Custom bounds in the picker format `YYYY/MM/DD HH:mm` (or ISO). */
  readonly from: string;
  readonly to: string;
}

export const EMPTY_DATE_EDITOR: DateEditorValue = { preset: null, days: DEFAULT_RELATIVE_DAYS, from: "", to: "" };

/** Editor value → grammar spec; null while incomplete. */
export function dateEditorToSpec(value: DateEditorValue): DateSpec | null {
  const option = value.preset ? findDatePreset(value.preset) : undefined;
  if (!option) return null;
  if (option.group === "Range") return { kind: "fixed", preset: option.key as FixedDatePreset };
  if (option.group === "Day") return { kind: "weekday", preset: option.key as WeekdayPreset };
  if (option.group === "Relative") {
    if (!Number.isInteger(value.days) || value.days < 0) return null;
    return { kind: "relative", preset: option.key as RelativeDatePreset, days: value.days };
  }
  const from = value.from.trim();
  const to = value.to.trim();
  if (!from && !to) return null;
  return { kind: "custom", ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

export function specToDateEditor(spec: DateSpec): DateEditorValue {
  switch (spec.kind) {
    case "fixed":
    case "weekday":
      return { ...EMPTY_DATE_EDITOR, preset: spec.preset };
    case "relative":
      return { ...EMPTY_DATE_EDITOR, preset: spec.preset, days: spec.days };
    case "custom":
      return { ...EMPTY_DATE_EDITOR, preset: "custom", from: spec.from ?? "", to: spec.to ?? "" };
  }
}

/** Human label for a chip, e.g. "Within 3 Day(s) Past" or "2026/01/01 → 2026/01/31". */
export function describeDateSpec(spec: DateSpec): string {
  switch (spec.kind) {
    case "fixed":
    case "weekday":
      return findDatePreset(spec.preset)?.label ?? serializeDateSpec(spec);
    case "relative": {
      const label = findDatePreset(spec.preset)?.label ?? spec.preset;
      return label.replace("X", String(spec.days));
    }
    case "custom":
      if (spec.from && spec.to) return `${spec.from} → ${spec.to}`;
      return spec.from ? `From ${spec.from}` : `Until ${spec.to ?? ""}`;
  }
}
