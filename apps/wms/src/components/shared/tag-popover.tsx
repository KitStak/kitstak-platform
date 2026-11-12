'use client';

/**
 * Tag popover (BUILD_PLAN F4.4): search, paged checklist ("1-10 of 21 · Selected: N"),
 * Apply, Manage link, and an empty state with Create Tag.
 * Apply → `POST /api/tags/apply { entityType, ids, tagIds, mode }` (mode "set" for one
 * record, "add" for a bulk selection so existing tags are kept).
 */
import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus, Search, Tag as TagIcon } from 'lucide-react';
import { useApiMutation, useApiQuery } from '@/lib/query-client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TextField } from '@/components/ui/text-field';
import { DisabledReason } from '@/components/ui/tooltip';
import { parseList, tagSchema, type Tag, type TagApplyMode } from './contracts';
import { CreateTagModal, TAGS_QUERY_KEY } from './create-tag-modal';

export const TAG_PAGE_SIZE = 10;
export const TAG_MANAGE_HREF = '/settings/data-setup/tags';

export function pageTags(
  tags: readonly Tag[],
  query: string,
  page: number,
): {
  readonly items: readonly Tag[];
  readonly total: number;
  readonly from: number;
  readonly to: number;
  readonly pageCount: number;
} {
  const q = query.trim().toLowerCase();
  const filtered = q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags;
  const pageCount = Math.max(1, Math.ceil(filtered.length / TAG_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * TAG_PAGE_SIZE;
  const items = filtered.slice(start, start + TAG_PAGE_SIZE);
  return {
    items,
    total: filtered.length,
    from: filtered.length ? start + 1 : 0,
    to: start + items.length,
    pageCount,
  };
}

export interface TagPopoverProps {
  readonly entityType: string;
  readonly ids: readonly string[];
  /** Tag scope (shipment_order, purchase_order, …). */
  readonly scope?: string;
  /** Tags currently on the record (single-record mode). */
  readonly appliedTagIds?: readonly string[];
  readonly onApplied?: () => void;
  readonly invalidate?: readonly (readonly unknown[])[];
  readonly trigger?: React.ReactElement;
  readonly disabledReason?: string | null;
}

export function TagPopover({
  entityType,
  ids,
  scope = 'any',
  appliedTagIds = [],
  onApplied,
  invalidate = [],
  trigger,
  disabledReason,
}: TagPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set(appliedTagIds));
  const list = useApiQuery<unknown>([...TAGS_QUERY_KEY, scope], open ? '/api/tags' : null, {
    query: { scope },
  });
  const tags = parseList(tagSchema, list.data?.data);
  const view = pageTags(tags, query, page);
  const mode: TagApplyMode = ids.length === 1 ? 'set' : 'add';
  const apply = useApiMutation<void, unknown>({
    path: '/api/tags/apply',
    method: 'POST',
    body: () => ({ entityType, ids, tagIds: [...selected], mode }),
    invalidate: [...invalidate],
    successMessage: () => `Tags updated on ${ids.length} record${ids.length === 1 ? '' : 's'}`,
    onSuccess: () => {
      setOpen(false);
      onApplied?.();
    },
  });

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const reason = disabledReason ?? (ids.length === 0 ? 'Select at least one record' : null);
  const applyReason = apply.isPending
    ? 'Saving…'
    : mode === 'add' && selected.size === 0
      ? 'Select at least one tag'
      : null;

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setSelected(new Set(appliedTagIds));
            setQuery('');
            setPage(1);
          }
          setOpen(next);
        }}
      >
        <DisabledReason reason={reason}>
          <PopoverTrigger asChild disabled={Boolean(reason)}>
            {trigger ?? (
              <Button variant="secondary" disabled={Boolean(reason)}>
                <TagIcon className="h-3.5 w-3.5" aria-hidden />
                Tags
              </Button>
            )}
          </PopoverTrigger>
        </DisabledReason>
        <PopoverContent align="start" className="flex w-[300px] flex-col gap-2 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Tags</p>
            <Link href={TAG_MANAGE_HREF} className="text-xs font-semibold text-primary hover:underline">
              Manage
            </Link>
          </div>
          {list.isPending ? (
            <p className="py-6 text-center text-xs text-faint">Loading tags…</p>
          ) : tags.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-5 text-center">
              <TagIcon className="h-5 w-5 text-faint" aria-hidden />
              <p className="text-sm font-semibold text-foreground">No tags yet</p>
              <p className="text-xs text-faint">Create a tag to group and filter records.</p>
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
                {view.items.length === 0 ? (
                  <li className="py-4 text-center text-xs text-faint">No tags match</li>
                ) : null}
                {view.items.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={selected.has(t.id)}
                      onCheckedChange={(c) => toggle(t.id, c === true)}
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: t.color }}
                            aria-hidden
                          />
                          {t.name}
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between text-2xs text-faint">
                <span>
                  {view.from}-{view.to} of {view.total} · Selected: {selected.size}
                </span>
                <span className="flex items-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Previous tags"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Next tags"
                    disabled={page >= view.pageCount}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2">
                <Button variant="ghost" size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Create Tag
                </Button>
                <DisabledReason reason={applyReason}>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={Boolean(applyReason)}
                    onClick={() => apply.mutate()}
                  >
                    Apply
                  </Button>
                </DisabledReason>
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
      {/* The popover closes while the modal has focus; reopen it with the new tag ticked so Apply is one click away. */}
      <CreateTagModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        scope={scope}
        onCreated={(tag) => {
          setSelected(new Set([...selected, tag.id]));
          if (ids.length > 0) setOpen(true);
        }}
      />
    </>
  );
}
