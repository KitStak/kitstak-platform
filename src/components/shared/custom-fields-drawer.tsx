"use client";

/**
 * "Create Custom Field" drawer (BUILD_PLAN F4.4): rows of type / name / Is Active (and
 * options for dropdowns), "+ Add More", "Add To Form". Slot limits are enforced inline:
 * 3 text boxes, 2 dropdowns, 3 dates, 2 toggles. Each row → `POST /api/custom-fields`.
 */
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { ChipInput } from "@/components/ui/chip-input";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import type { CustomFieldDef } from "./contracts";
import {
  CUSTOM_FIELD_NAME_MAX,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
  assignSlots,
  draftErrors,
  emptyCustomFieldDraft,
  remainingSlots,
  type CustomFieldDraft,
  type CustomFieldType,
} from "./custom-fields-model";

export const customFieldsQueryKey = (entityType: string) => ["custom-fields", entityType] as const;

export interface CustomFieldsDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly entityType: string;
  readonly existing: readonly CustomFieldDef[];
  readonly onCreated?: () => void;
}

function firstFreeType(defs: readonly CustomFieldDef[], drafts: readonly CustomFieldDraft[]): CustomFieldType | null {
  const left = remainingSlots(defs, drafts);
  return CUSTOM_FIELD_TYPES.find((t) => left[t] > 0) ?? null;
}

export function CustomFieldsDrawer({ open, onOpenChange, entityType, existing, onCreated }: CustomFieldsDrawerProps) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = React.useState<readonly CustomFieldDraft[]>([emptyCustomFieldDraft()]);
  const [submitted, setSubmitted] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const errors = draftErrors(drafts, existing);
  const hasErrors = errors.some((e) => Object.keys(e).length > 0);
  const nextType = firstFreeType(existing, drafts);
  const dirty = drafts.some((d) => d.name.trim() !== "" || (d.options?.length ?? 0) > 0);

  const update = (index: number, patch: Partial<CustomFieldDraft>) => setDrafts(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const reset = () => {
    setDrafts([emptyCustomFieldDraft(firstFreeType(existing, []) ?? "textBox")]);
    setSubmitted(false);
  };

  const save = async () => {
    setSubmitted(true);
    if (hasErrors) return;
    setSaving(true);
    const slots = assignSlots(existing, drafts);
    try {
      for (const [i, d] of drafts.entries()) {
        await apiRequest("/api/custom-fields", { method: "POST", body: { entityType, slot: slots[i], name: d.name.trim(), isActive: d.isActive, options: d.type === "dropDown" ? d.options : null } });
      }
      toast.success("Success", `${drafts.length} custom field${drafts.length === 1 ? "" : "s"} added to the form`);
      await queryClient.invalidateQueries({ queryKey: customFieldsQueryKey(entityType) });
      onCreated?.();
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error("Error", isApiError(error) ? error.message : "Could not save the custom fields.");
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex w-full justify-end gap-2">
      <Button variant="secondary" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <DisabledReason reason={saving ? "Saving…" : submitted && hasErrors ? "Fix the highlighted fields" : null}>
        <Button variant="primary" disabled={saving || (submitted && hasErrors)} onClick={() => void save()}>
          Add To Form
        </Button>
      </DisabledReason>
    </div>
  );

  return (
    <Drawer open={open} onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }} title="Create custom field" description="Text boxes (3), dropdowns (2), dates (3) and toggles (2) per record type." width={45} dirty={dirty && !saving} footer={footer}>
      <ol className="flex flex-col gap-3">
        {drafts.map((d, i) => {
          const e = submitted ? (errors[i] ?? {}) : {};
          const left = remainingSlots(existing, drafts.filter((_, j) => j !== i));
          return (
            <li key={i} className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-secondary">Field {i + 1}</span>
                {drafts.length > 1 ? (
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove field ${i + 1}`} onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-[12px] font-semibold text-secondary">
                  <span>
                    Type <span className="text-danger">*</span>
                  </span>
                  <Select<CustomFieldType>
                    aria-label={`Field ${i + 1} type`}
                    value={d.type}
                    invalid={Boolean(e.type)}
                    onChange={(type) => type && update(i, { type, options: [] })}
                    options={CUSTOM_FIELD_TYPES.map((t) => ({ value: t, label: CUSTOM_FIELD_TYPE_LABELS[t], description: `${Math.max(0, left[t])} left`, disabled: left[t] <= 0 && t !== d.type }))}
                  />
                  {e.type ? <span className="text-[11px] font-medium text-danger">{e.type}</span> : null}
                </label>
                <label className="flex flex-col gap-1 text-[12px] font-semibold text-secondary">
                  <span>
                    Name <span className="text-danger">*</span>
                  </span>
                  <TextField value={d.name} maxLength={CUSTOM_FIELD_NAME_MAX} invalid={Boolean(e.name)} onChange={(ev) => update(i, { name: ev.target.value })} aria-label={`Field ${i + 1} name`} />
                  {e.name ? <span className="text-[11px] font-medium text-danger">{e.name}</span> : null}
                </label>
              </div>
              {d.type === "dropDown" ? (
                <div className="flex flex-col gap-1 text-[12px] font-semibold text-secondary">
                  <span>
                    Options <span className="text-danger">*</span>
                  </span>
                  <ChipInput value={d.options ?? []} onChange={(options) => update(i, { options: [...options] })} placeholder="Type an option and press Enter" aria-label={`Field ${i + 1} options`} />
                  {e.options ? <span className="text-[11px] font-medium text-danger">{e.options}</span> : null}
                </div>
              ) : null}
              <Switch label="Is active" checked={d.isActive} onCheckedChange={(isActive) => update(i, { isActive })} />
            </li>
          );
        })}
      </ol>
      <DisabledReason reason={nextType ? null : "Every custom field slot is in use"}>
        <Button variant="ghost" className="mt-3" disabled={!nextType} onClick={() => nextType && setDrafts([...drafts, emptyCustomFieldDraft(nextType)])}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add More
        </Button>
      </DisabledReason>
    </Drawer>
  );
}
