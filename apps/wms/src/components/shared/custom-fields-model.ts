/**
 * Custom field slots (BUILD_PLAN F4.4): 3 text boxes, 2 dropdowns, 3 dates, 2 toggles
 * per entity (`CUSTOM_FIELD_SLOTS` in enums). PURE.
 */
import { z } from "zod";
import { CUSTOM_FIELD_SLOTS, type CustomFieldSlot } from "@/lib/enums";
import type { CustomFieldDef } from "./contracts";

export const CUSTOM_FIELD_TYPES = ["textBox", "dropDown", "date", "toggle"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_TYPE_LABELS: Readonly<Record<CustomFieldType, string>> = {
  textBox: "Text box",
  dropDown: "Dropdown",
  date: "Date",
  toggle: "Toggle",
};

export const SLOT_LIMITS: Readonly<Record<CustomFieldType, number>> = { textBox: 3, dropDown: 2, date: 3, toggle: 2 };

export const CUSTOM_FIELD_NAME_MAX = 50;
export const DROPDOWN_OPTION_MAX = 50;

export function slotType(slot: string): CustomFieldType | null {
  const match = /^(textBox|dropDown|date|toggle)\d$/.exec(slot);
  return match ? (match[1] as CustomFieldType) : null;
}

export function slotsOfType(type: CustomFieldType): readonly CustomFieldSlot[] {
  return CUSTOM_FIELD_SLOTS.filter((s) => slotType(s) === type);
}

/** Free slots per type after accounting for existing definitions and pending drafts. */
export function remainingSlots(defs: readonly CustomFieldDef[], drafts: readonly { readonly type: CustomFieldType }[]): Readonly<Record<CustomFieldType, number>> {
  const out: Record<CustomFieldType, number> = { ...SLOT_LIMITS };
  for (const def of defs) {
    const type = slotType(def.slot);
    if (type) out[type] -= 1;
  }
  for (const d of drafts) out[d.type] -= 1;
  return out;
}

/** Assigns concrete slots to drafts in order; null when a type is over its limit. */
export function assignSlots(defs: readonly CustomFieldDef[], drafts: readonly { readonly type: CustomFieldType }[]): readonly (CustomFieldSlot | null)[] {
  const used = new Set(defs.map((d) => d.slot));
  return drafts.map((d) => {
    const slot = slotsOfType(d.type).find((s) => !used.has(s)) ?? null;
    if (slot) used.add(slot);
    return slot;
  });
}

export const customFieldDraftSchema = z
  .object({
    type: z.enum(CUSTOM_FIELD_TYPES),
    name: z.string().trim().min(1, "Enter a field name").max(CUSTOM_FIELD_NAME_MAX, `At most ${CUSTOM_FIELD_NAME_MAX} characters`),
    isActive: z.boolean(),
    options: z.array(z.string().trim().min(1).max(DROPDOWN_OPTION_MAX)).max(100),
  })
  .refine((d) => d.type !== "dropDown" || d.options.length > 0, { message: "Add at least one option", path: ["options"] });

export type CustomFieldDraft = z.input<typeof customFieldDraftSchema>;

export function emptyCustomFieldDraft(type: CustomFieldType = "textBox"): CustomFieldDraft {
  return { type, name: "", isActive: true, options: [] };
}

/** Per-row first error message (path → message) for inline display. */
export function draftErrors(drafts: readonly CustomFieldDraft[], defs: readonly CustomFieldDef[]): readonly Readonly<Record<string, string>>[] {
  const names = new Set(defs.map((d) => d.name.trim().toLowerCase()));
  const slots = assignSlots(defs, drafts);
  return drafts.map((draft, i) => {
    const errors: Record<string, string> = {};
    const parsed = customFieldDraftSchema.safeParse(draft);
    if (!parsed.success) for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? "name")] ??= issue.message;
    const key = draft.name.trim().toLowerCase();
    if (key && (names.has(key) || drafts.some((d, j) => j < i && d.name.trim().toLowerCase() === key))) errors.name ??= "A field with this name already exists";
    if (slots[i] === null) errors.type ??= `Only ${SLOT_LIMITS[draft.type]} ${CUSTOM_FIELD_TYPE_LABELS[draft.type]} fields are allowed`;
    return errors;
  });
}
