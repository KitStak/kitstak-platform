"use client";

/**
 * Shipment-order Tag popover (critic r5 major). The shared `TagPopover` sends `mode: "set"` for a
 * single record, which `/api/tags/apply` rejects (it accepts "add" | "remove"), so tagging one row
 * always failed with a raw Zod message. Until the shared fix lands (docs/requests/orders-outbound.md
 * REQ-R6-1) orders use this adapter: it sends add/remove *diffs* that the API accepts.
 *   - one order: add the newly ticked tags, remove the unticked ones (replace semantics);
 *   - several orders: add the ticked tags and keep each order's other tags.
 * Same UI as the shared popover: search, paged checklist, Selected: N, Create Tag, Manage.
 */
import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Search, Tag as TagIcon } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { CreateTagModal, parseList, TAGS_QUERY_KEY, tagSchema } from "@/components/shared";
import { pageTags } from "@/components/shared/tag-popover";
import { errorMessage } from "../orders-client";

export const ORDER_TAG_MANAGE_HREF = "/settings/data-setup/tags";

export interface TagDiff {
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

/**
 * The calls Apply makes. One record: replace (add new, remove unticked). Several records: add only.
 * An empty side is skipped, so the API never sees an empty `tagIds`.
 */
export function tagApplyDiff(selected: Iterable<string>, applied: Iterable<string>, recordCount: number): TagDiff {
  const sel = new Set(selected);
  const had = new Set(applied);
  if (recordCount !== 1) return { add: [...sel], remove: [] };
  return { add: [...sel].filter((id) => !had.has(id)), remove: [...had].filter((id) => !sel.has(id)) };
}

/** Business copy for a failed apply (never a raw schema message). */
export function tagApplyError(error: unknown): string {
  const raw = errorMessage(error, "");
  if (!raw || /invalid option|expected one of|invalid input|zod/i.test(raw)) return "The tags could not be applied. Refresh the page and try again.";
  return raw;
}

export interface OrderTagPopoverProps {
  readonly ids: readonly string[];
  readonly appliedTagIds?: readonly string[];
  readonly invalidate?: readonly (readonly unknown[])[];
  readonly onApplied?: () => void;
  readonly trigger: React.ReactElement;
  readonly disabledReason?: string | null;
}

export function OrderTagPopover({ ids, appliedTagIds = [], invalidate = [], onApplied, trigger, disabledReason }: OrderTagPopoverProps) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set(appliedTagIds));
  const [saving, setSaving] = React.useState(false);
  const list = useApiQuery<unknown>([...TAGS_QUERY_KEY, "shipment_order"], open ? "/api/tags" : null, { query: { scope: "shipment_order" } });
  const tags = parseList(tagSchema, list.data?.data);
  const view = pageTags(tags, query, page);
  const diff = tagApplyDiff(selected, appliedTagIds, ids.length);
  const nothing = diff.add.length === 0 && diff.remove.length === 0;

  const apply = async () => {
    setSaving(true);
    try {
      const body = { entityType: "shipment_order", ids };
      if (diff.add.length) await apiFetch("/api/tags/apply", { method: "POST", body: { ...body, tagIds: diff.add, mode: "add" } });
      if (diff.remove.length) await apiFetch("/api/tags/apply", { method: "POST", body: { ...body, tagIds: diff.remove, mode: "remove" } });
      await Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })));
      toast.success("Success", `Tags updated on ${ids.length} order${ids.length === 1 ? "" : "s"}`);
      setOpen(false);
      onApplied?.();
    } catch (error) {
      toast.error("Tags not applied", tagApplyError(error));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const reason = disabledReason ?? (ids.length === 0 ? "Select at least one order" : null);
  const applyReason = saving ? "Saving…" : nothing ? (ids.length === 1 ? "No tag changes" : "Select at least one tag") : null;

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setSelected(new Set(appliedTagIds));
            setQuery("");
            setPage(1);
          }
          setOpen(next);
        }}
      >
        <DisabledReason reason={reason}>
          <PopoverTrigger asChild disabled={Boolean(reason)}>{trigger}</PopoverTrigger>
        </DisabledReason>
        <PopoverContent align="start" className="flex w-[300px] flex-col gap-2 p-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-foreground">Tags</p>
            <Link href={ORDER_TAG_MANAGE_HREF} className="text-[12px] font-semibold text-primary hover:underline">Manage</Link>
          </div>
          {list.isPending ? (
            <p className="py-6 text-center text-[12px] text-faint">Loading tags…</p>
          ) : list.isError ? (
            <div className="flex flex-col items-center gap-2 py-5 text-center">
              <p className="text-[12px] text-danger">Tags could not be loaded.</p>
              <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>Retry</Button>
            </div>
          ) : tags.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-5 text-center">
              <TagIcon className="h-5 w-5 text-faint" aria-hidden />
              <p className="text-[13px] font-semibold text-foreground">No tags yet</p>
              <p className="text-[12px] text-faint">Create a tag to group and filter orders.</p>
              <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Create Tag
              </Button>
            </div>
          ) : (
            <>
              <TextField
                size="sm"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search tags"
                aria-label="Search tags"
                leading={<Search className="h-3.5 w-3.5" aria-hidden />}
              />
              <ul className="flex min-h-[120px] flex-col gap-1.5" aria-label="Tags">
                {view.items.length === 0 ? <li className="py-4 text-center text-[12px] text-faint">No tags match</li> : null}
                {view.items.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={selected.has(t.id)}
                      onCheckedChange={(c) => toggle(t.id, c === true)}
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} aria-hidden />
                          {t.name}
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between text-[11px] text-faint">
                <span>{view.from}-{view.to} of {view.total} · Selected: {selected.size}</span>
                <span className="flex items-center">
                  <Button variant="ghost" size="icon-sm" aria-label="Previous tags" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Next tags" disabled={page >= view.pageCount} onClick={() => setPage(page + 1)}>
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </span>
              </div>
              {ids.length > 1 ? <p className="text-[11px] text-faint">Ticked tags are added to {ids.length} orders; their other tags are kept.</p> : null}
              <div className="flex items-center justify-between border-t border-border pt-2">
                <Button variant="ghost" size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Create Tag
                </Button>
                <DisabledReason reason={applyReason}>
                  <Button variant="primary" size="sm" disabled={Boolean(applyReason)} aria-busy={saving} onClick={() => void apply()}>
                    {saving ? "Applying…" : "Apply"}
                  </Button>
                </DisabledReason>
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
      <CreateTagModal open={createOpen} onOpenChange={setCreateOpen} scope="shipment_order" onCreated={(tag) => setSelected(new Set([...selected, tag.id]))} />
    </>
  );
}
