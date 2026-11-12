"use client";

/**
 * Custom Fields manager (`/settings/custom-fields?entity=lp_type`): every entity's "Other Info"
 * fields in one place (Logiwa's Other Info sub-drawer). Per entity: Text / Dropdown / Date /
 * Toggle slots with capacity, rename, dropdown options, an Active switch, and "Add custom field"
 * (the shared create drawer). Changing a definition needs that entity's Custom Field Management
 * permission (the API enforces it; the page disables what the viewer can't change).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Pencil, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { usePermissionSet } from "@/lib/permissions-client";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChipInput } from "@/components/ui/chip-input";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { CustomFieldsDrawer, customFieldsQueryKey } from "@/components/shared/custom-fields-drawer";
import { CUSTOM_FIELD_TYPE_LABELS, CUSTOM_FIELD_TYPES, SLOT_LIMITS, slotType } from "@/components/shared/custom-fields-model";
import type { CustomFieldDef } from "@/components/shared/contracts";
import { CUSTOM_FIELD_ENTITY_LIST, customFieldEntityOf, type CustomFieldEntityInfo } from "@/lib/grid-defs/admin/custom-fields";
import { NO_PERMISSION } from "../admin-shared";

interface DefRow extends CustomFieldDef { readonly version?: number; readonly updatedAt?: string }

function EditDrawer({ row, onClose }: { readonly row: DefRow | null; readonly onClose: () => void }) {
  const qc = useQueryClient();
  // Keyed by row id (see CustomFieldsPage), so the state starts from the row being edited.
  const [name, setName] = React.useState(row?.name ?? "");
  const [options, setOptions] = React.useState<string[]>([...(row?.options ?? [])]);
  const [saving, setSaving] = React.useState(false);
  const isDrop = row ? slotType(row.slot) === "dropDown" : false;
  const error = !name.trim() ? "Name is required" : isDrop && options.length === 0 ? "Add at least one option" : null;
  const dirty = row ? name.trim() !== row.name || (isDrop && options.join("|") !== (row.options ?? []).join("|")) : false;
  const save = async () => {
    if (!row || error) return;
    setSaving(true);
    try {
      await apiRequest(`/api/custom-fields/${row.id}`, { method: "PATCH", body: { name: name.trim(), ...(isDrop ? { options } : {}), version: row.version } });
      await qc.invalidateQueries({ queryKey: ["custom-fields"] });
      toast.success("Custom field saved", `${name.trim()} is updated on every ${customFieldEntityOf(row.entityType)?.noun.toLowerCase() ?? "record"} form.`);
      onClose();
    } catch (e) {
      toast.error("Couldn't save the custom field", isApiError(e) ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer open={row !== null} onOpenChange={(o) => !o && onClose()} dirty={dirty} width={35} title={`Edit ${row?.name ?? "custom field"}`}
      description={row ? `${customFieldEntityOf(row.entityType)?.label ?? row.entityType} · ${CUSTOM_FIELD_TYPE_LABELS[slotType(row.slot) ?? "textBox"]}` : undefined}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <DisabledReason reason={saving ? null : error ?? (dirty ? null : "No changes to save")}><Button variant="primary" disabled={saving || Boolean(error) || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button></DisabledReason>
        </div>
      }>
      {row ? (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-body">Field name<TextField value={name} maxLength={50} onChange={(e) => setName(e.target.value)} invalid={!name.trim()} /></label>
          {isDrop ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-body">Options</span>
              <ChipInput value={options} onChange={(v) => setOptions([...v])} placeholder="Type an option and press Enter" maxItems={50} maxLength={100} invalid={options.length === 0} />
              <span className="text-xs text-secondary">Records keep a value that you remove here; it just can&apos;t be chosen again.</span>
            </div>
          ) : null}
          <p className="text-xs text-secondary">The field type can&apos;t change once records may hold values. Deactivate it and add a new one instead.</p>
        </div>
      ) : null}
    </Drawer>
  );
}

function Capacity({ defs }: { readonly defs: readonly DefRow[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Slots used">
      {CUSTOM_FIELD_TYPES.map((t) => {
        const used = defs.filter((d) => slotType(d.slot) === t).length;
        return <Badge key={t} tone={used >= SLOT_LIMITS[t] ? "warning" : "neutral"} size="sm" shape="pill">{CUSTOM_FIELD_TYPE_LABELS[t]} {used}/{SLOT_LIMITS[t]}</Badge>;
      })}
    </div>
  );
}

export function CustomFieldsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const entity: CustomFieldEntityInfo = customFieldEntityOf(params.get("entity")) ?? CUSTOM_FIELD_ENTITY_LIST[0]!;
  const { permissions } = usePermissionSet();
  const canManage = permissions.has(entity.permission);
  const all = useApiQuery<readonly DefRow[]>(["custom-fields", "all"], "/api/custom-fields", { query: { includeInactive: "true" } });
  const rows = React.useMemo(() => (all.data?.data ?? []).filter((d) => d.entityType === entity.key), [all.data, entity.key]);
  const counts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const d of all.data?.data ?? []) if (d.isActive) m.set(d.entityType, (m.get(d.entityType) ?? 0) + 1);
    return m;
  }, [all.data]);
  const qc = useQueryClient();
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<DefRow | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const select = (key: string) => router.replace(`/settings/custom-fields?entity=${key}`, { scroll: false });
  const toggle = async (row: DefRow) => {
    setBusy(row.id);
    try {
      await apiRequest(`/api/custom-fields/${row.id}`, { method: "PATCH", body: { isActive: !row.isActive, version: row.version } });
      await Promise.all([qc.invalidateQueries({ queryKey: ["custom-fields"] }), qc.invalidateQueries({ queryKey: customFieldsQueryKey(row.entityType) })]);
      toast.success(row.isActive ? "Custom field deactivated" : "Custom field activated", row.isActive ? `${row.name} is hidden from forms; saved values are kept.` : `${row.name} shows on forms again.`);
    } catch (e) {
      toast.error("Couldn't change the custom field", isApiError(e) ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };
  const activeDefs = rows.filter((r) => r.isActive);
  const full = CUSTOM_FIELD_TYPES.every((t) => rows.filter((d) => slotType(d.slot) === t).length >= SLOT_LIMITS[t]);
  const addButton = (
    <DisabledReason reason={!canManage ? NO_PERMISSION : full ? "Every slot of this entity is used. Deactivated fields keep their slot." : null}>
      <Button variant="primary" disabled={!canManage || full} onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden />Add custom field</Button>
    </DisabledReason>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Custom Fields" crumbLabel="Custom Fields"
        helper="Extra &quot;Other Info&quot; fields on records: up to 3 text, 2 dropdown, 3 date and 2 toggle fields per entity. Active fields show on the entity's create and edit forms, grids and printouts."
        actions={addButton} />
      <div className="flex min-h-0 flex-1 gap-5 px-6 pb-6 pt-4 max-lg:flex-col">
        <nav aria-label="Entities" className="w-56 shrink-0 max-lg:w-full">
          <ul className="flex flex-col gap-0.5 max-lg:flex-row max-lg:flex-wrap">
            {CUSTOM_FIELD_ENTITY_LIST.map((e) => (
              <li key={e.key}>
                <button type="button" onClick={() => select(e.key)} aria-current={e.key === entity.key ? "page" : undefined}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${e.key === entity.key ? "bg-primary-soft font-semibold text-primary" : "text-body hover:bg-surface-sunken"}`}>
                  {e.label}
                  {counts.get(e.key) ? <span className="text-2xs tabular-nums text-secondary">{counts.get(e.key)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <section className="min-w-0 flex-1 rounded-xl border border-border bg-surface shadow-xs" aria-labelledby="cf-entity">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <div className="min-w-0">
              <h2 id="cf-entity" className="text-base font-semibold text-foreground">{entity.label}</h2>
              <p className="text-xs text-secondary">{activeDefs.length} active · shown under Other Info on {entity.noun.toLowerCase()} forms</p>
            </div>
            <div className="flex items-center gap-3">
              <Capacity defs={rows} />
              {entity.href ? <Link href={entity.href} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Open {entity.label}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden /></Link> : null}
            </div>
          </header>
          {all.isPending ? <div className="p-5"><Skeleton className="h-40 w-full" /></div> : all.isError ? (
            <EmptyState title="Couldn't load custom fields" description={all.error.message} action={<Button onClick={() => void all.refetch()}>Retry</Button>} />
          ) : rows.length === 0 ? (
            <EmptyState title={`No custom fields on ${entity.label.toLowerCase()} yet`} description="Add a field to capture information KitStak doesn't track out of the box." action={canManage ? <Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add custom field</Button> : undefined} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-2xs text-secondary">
                  <th className="px-5 py-2 font-medium">Field name</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Options</th><th className="px-3 py-2 font-medium">Active</th><th className="w-20 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = slotType(r.slot) ?? "textBox";
                  return (
                    <tr key={r.id} className="border-b border-border/60 last:border-0">
                      <td className="px-5 py-2.5 font-medium text-foreground">{r.name}</td>
                      <td className="px-3 py-2.5 text-body">{CUSTOM_FIELD_TYPE_LABELS[t]}</td>
                      <td className="max-w-[280px] truncate px-3 py-2.5 text-secondary" title={(r.options ?? []).join(", ")}>{t === "dropDown" ? (r.options ?? []).join(", ") : "—"}</td>
                      <td className="px-3 py-2.5">
                        <DisabledReason reason={canManage ? null : NO_PERMISSION}>
                          <Switch size="sm" checked={r.isActive} disabled={!canManage || busy === r.id} onCheckedChange={() => void toggle(r)} aria-label={`${r.isActive ? "Deactivate" : "Activate"} ${r.name}`} />
                        </DisabledReason>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <DisabledReason reason={canManage ? null : NO_PERMISSION}>
                          <Button variant="ghost" size="sm" disabled={!canManage} onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" aria-hidden />Edit</Button>
                        </DisabledReason>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <CustomFieldsDrawer open={adding} onOpenChange={setAdding} entityType={entity.key} existing={rows} onCreated={() => void qc.invalidateQueries({ queryKey: ["custom-fields"] })} />
      <EditDrawer key={editing?.id ?? "none"} row={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
