'use client';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Hash, Plus, Tag, X } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import type { CellRenderContext, CellRenderer } from '../cell-context';
import { readTags } from '../lib/values';
import { EmptyGhost, EmptyListMessage } from '../parts/common';

const MAX_TAG = 64;
const MAX_TAGS = 100;

export function normalizeTag(input: string): string {
  return input.trim().replace(/^#+/, '').replace(/\s+/g, '-').slice(0, MAX_TAG);
}

function TagChip({ tag }: { readonly tag: string }) {
  return (
    <span className="inline-flex h-6 min-w-0 shrink items-center rounded-sm bg-primary-subtle px-1.5 text-sm font-medium text-primary-text">
      <span className="truncate">#{tag}</span>
    </span>
  );
}

function TagsDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const tags = readTags(ctx.value);
  if (tags.length === 0) return ctx.readOnly ? null : <EmptyGhost icon={<Tag aria-hidden />} label="Add tags" />;
  let budget = ctx.column.width - 24;
  let fit = 0;
  for (const tag of tags) {
    const width = Math.min(130, tag.length * 7 + 22);
    if (fit > 0 && width > budget - 34) break;
    budget -= width + 4;
    fit += 1;
  }
  const hidden = tags.slice(fit);
  return (
    <span className="flex min-w-0 flex-1 items-center justify-center gap-1 px-2">
      {tags.slice(0, fit).map((tag) => (
        <TagChip key={tag} tag={tag} />
      ))}
      {hidden.length ? (
        <Tooltip content={hidden.map((tag) => `#${tag}`).join(' ')} side="top">
          <span className="inline-flex h-6 shrink-0 items-center rounded-sm bg-muted px-1.5 text-xs font-semibold text-fg-secondary">+{hidden.length}</span>
        </Tooltip>
      ) : null}
    </span>
  );
}

function TagsEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const [tags, setTags] = useState(() => readTags(ctx.value));
  const [query, setQuery] = useState(ctx.seed ?? '');
  const [active, setActive] = useState(0);
  const listId = useId();
  const pool = useMemo(() => {
    const all = new Set<string>([
      ...((ctx.column.settings as { suggestions?: string[] }).suggestions ?? []),
      ...(ctx.services.tagSuggestions ?? []),
    ]);
    for (const entry of ctx.services.boardItems ?? []) readTags(entry.values[ctx.column.key]).forEach((tag) => all.add(tag));
    return [...all].sort((a, b) => a.localeCompare(b));
  }, [ctx.column.key, ctx.column.settings, ctx.services.boardItems, ctx.services.tagSuggestions]);

  const normalized = normalizeTag(query);
  const lower = tags.map((tag) => tag.toLowerCase());
  const options = useMemo(() => {
    const needle = normalized.toLowerCase();
    const matches = pool.filter((tag) => !lower.includes(tag.toLowerCase()) && (!needle || tag.toLowerCase().includes(needle))).slice(0, 30);
    const exists = pool.some((tag) => tag.toLowerCase() === needle) || lower.includes(needle);
    return normalized && !exists ? [{ tag: normalized, create: true }, ...matches.map((tag) => ({ tag, create: false }))] : matches.map((tag) => ({ tag, create: false }));
  }, [lower, normalized, pool]);

  const write = (next: string[]) => {
    setTags(next);
    ctx.commit(next.length ? { tags: next } : null);
  };
  const add = (tag: string) => {
    if (!tag || lower.includes(tag.toLowerCase()) || tags.length >= MAX_TAGS) return;
    write([...tags, tag]);
    setQuery('');
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % Math.max(1, options.length));
    } else if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      const option = options[Math.min(active, options.length - 1)];
      add(option?.tag ?? normalized);
    } else if (event.key === 'Backspace' && !query && tags.length) {
      write(tags.slice(0, -1));
    }
  };

  return (
    <div className="flex w-[280px] flex-col gap-2" data-testid="tags-editor">
      <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-sm border border-border-input bg-panel p-1 focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--focus-ring-soft)]">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex h-6 items-center gap-0.5 rounded-sm bg-primary-subtle pr-0.5 pl-1.5 text-sm font-medium text-primary-text">
            #{tag}
            <button type="button" aria-label={`Remove #${tag}`} onClick={() => write(tags.filter((entry) => entry !== tag))} className="inline-flex size-5 items-center justify-center rounded-xs hover:bg-primary-selected focus-visible:outline-2 focus-visible:outline-focus">
              <X aria-hidden className="size-3" />
            </button>
          </span>
        ))}
        <input
          autoFocus
          value={query}
          maxLength={MAX_TAG + 1}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={tags.length ? 'Add another' : 'Search or create a tag'}
          aria-label="Add tag"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          className="h-6 min-w-[96px] flex-1 bg-transparent px-1 text-base text-fg outline-none"
        />
      </div>
      <ul id={listId} role="listbox" aria-label="Tag suggestions" className="-mx-1 flex max-h-56 flex-col overflow-y-auto">
        {options.length === 0 ? <EmptyListMessage>{pool.length ? 'No more matching tags' : 'Type to create your first tag'}</EmptyListMessage> : null}
        {options.map((option, index) => (
          <li
            key={`${option.create}-${option.tag}`}
            role="option"
            aria-selected={false}
            data-active={index === Math.min(active, options.length - 1)}
            onPointerMove={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => add(option.tag)}
            className="ks-menu-item mx-1 not-data-[active=true]:bg-transparent data-[active=true]:bg-hover"
          >
            {option.create ? <Plus aria-hidden /> : <Hash aria-hidden />}
            <span className="truncate">{option.create ? <>Create <span className="font-semibold">#{option.tag}</span></> : option.tag}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const tagsRenderer: CellRenderer = {
  behavior: { mode: 'popover', clearable: true, typeToEdit: true, width: 280 },
  Display: TagsDisplay,
  Editor: TagsEditor,
};
