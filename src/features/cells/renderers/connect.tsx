'use client';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cable, Check, X } from 'lucide-react';
import { SearchInput, Skeleton, Tooltip, cn } from '@/components/ui';
import type { CellRenderContext, CellRenderer } from '../cell-context';
import { readIds } from '../lib/values';
import { EmptyGhost, EmptyListMessage } from '../parts/common';
import { useDebounced } from '../parts/use-debounced';
import type { ConnectCandidate } from '../types';

const UNAVAILABLE = 'Item unavailable';

type Resolved = { readonly state: 'ready'; readonly name: string } | { readonly state: 'loading' } | { readonly state: 'missing' };

function resolve(ctx: CellRenderContext, id: string, local?: ReadonlyMap<string, ConnectCandidate>): Resolved {
  const found = local?.get(id) ?? ctx.services.linkedItems?.get(id);
  if (found) return { state: 'ready', name: found.name };
  if (ctx.services.linkedItemsLoading) return { state: 'loading' };
  return { state: 'missing' };
}

function resolvedName(entry: Resolved): string {
  return entry.state === 'ready' ? entry.name : entry.state === 'loading' ? 'Loading…' : UNAVAILABLE;
}

function ChipSkeleton() {
  return (
    <span className="inline-flex h-6 w-20 shrink-0 items-center rounded-sm bg-muted px-2" aria-hidden>
      <Skeleton height={8} width="100%" rounded="full" />
    </span>
  );
}

function ConnectChip({ name, missing, onRemove }: { readonly name: string; readonly missing?: boolean; readonly onRemove?: () => void }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 min-w-0 shrink items-center gap-1 rounded-sm bg-muted px-2 text-sm',
        missing ? 'text-fg-muted italic' : 'text-fg',
      )}
      title={missing ? 'This item was deleted or you no longer have access to it' : undefined}
    >
      <span className="truncate">{name}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Unlink ${name}`}
          onClick={onRemove}
          className="-mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-xs text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
        >
          <X aria-hidden className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

function ConnectDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const ids = readIds(ctx.value, 'itemIds');
  if (ids.length === 0) return ctx.readOnly ? null : <EmptyGhost icon={<Cable aria-hidden />} label="Link items" />;
  const entries = ids.map((id) => resolve(ctx, id));
  const names = entries.map(resolvedName);
  const shown = entries.slice(0, 2);
  const hidden = names.slice(2);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 px-2">
      {shown.map((entry, index) =>
        entry.state === 'loading' ? (
          <ChipSkeleton key={ids[index]} />
        ) : (
          <ConnectChip key={ids[index]} name={resolvedName(entry)} missing={entry.state === 'missing'} />
        ),
      )}
      {entries.some((entry) => entry.state === 'loading') ? <span className="sr-only">Loading linked items</span> : null}
      {hidden.length ? (
        <Tooltip content={hidden.join(', ')} side="top">
          <span className="inline-flex h-6 shrink-0 items-center rounded-sm bg-muted px-1.5 text-xs font-semibold text-fg-secondary">+{hidden.length}</span>
        </Tooltip>
      ) : null}
    </span>
  );
}

function groupResults(results: readonly ConnectCandidate[]): { key: string; title: string | null; items: ConnectCandidate[] }[] {
  const groups = new Map<string, { key: string; title: string | null; items: ConnectCandidate[] }>();
  for (const result of results) {
    const title = [result.boardName, result.groupTitle].filter(Boolean).join(' · ') || null;
    const key = title ?? '__all__';
    const group = groups.get(key) ?? { key, title, items: [] };
    group.items.push(result);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function ConnectEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const settings = ctx.column.settings as { boardIds?: string[]; allowMultiple?: boolean };
  const boardIds = useMemo(() => settings.boardIds ?? [], [settings.boardIds]);
  const allowMultiple = settings.allowMultiple !== false;
  const [selected, setSelected] = useState(() => readIds(ctx.value, 'itemIds'));
  const [picked, setPicked] = useState<ReadonlyMap<string, ConnectCandidate>>(() => new Map());
  const [query, setQuery] = useState(ctx.seed ?? '');
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query.trim(), 200);
  const listId = useId();
  const search = ctx.services.searchItems;

  const results = useQuery({
    queryKey: ['cells', 'connect-search', ctx.board?.id ?? '', boardIds, debounced],
    queryFn: ({ signal }) => (search ? search(debounced, boardIds, signal) : Promise.resolve([])),
    enabled: Boolean(search),
    staleTime: 15_000,
  });
  const candidates = useMemo(() => (results.data ?? []).filter((entry) => entry.id !== ctx.item.id), [ctx.item.id, results.data]);
  const flat = candidates;
  const activeIndex = Math.min(active, Math.max(0, flat.length - 1));

  const write = (next: string[]) => {
    setSelected(next);
    ctx.commit(next.length ? { itemIds: next } : null);
  };
  const toggle = (candidate: ConnectCandidate) => {
    setPicked((current) => new Map(current).set(candidate.id, candidate));
    ctx.services.rememberLinkedItems?.([candidate]);
    if (!allowMultiple) {
      write(selected.includes(candidate.id) ? [] : [candidate.id]);
      ctx.endEdit();
      return;
    }
    write(selected.includes(candidate.id) ? selected.filter((id) => id !== candidate.id) : [...selected, candidate.id]);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + flat.length) % Math.max(1, flat.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const candidate = flat[activeIndex];
      if (candidate) toggle(candidate);
    }
  };

  const noun = ctx.board?.itemTerminology?.toLowerCase() ?? 'item';
  return (
    <div className="flex w-[320px] flex-col gap-2" onKeyDown={onKeyDown} data-testid="connect-picker">
      {selected.length ? (
        <div className="flex flex-wrap gap-1" aria-label="Linked">
          {selected.map((id) => (
            <ConnectChip
              key={id}
              name={resolvedName(resolve(ctx, id, picked))}
              missing={resolve(ctx, id, picked).state === 'missing'}
              onRemove={() => write(selected.filter((entry) => entry !== id))}
            />
          ))}
        </div>
      ) : null}
      <SearchInput
        autoFocus
        size="sm"
        value={query}
        onValueChange={(next) => {
          setQuery(next);
          setActive(0);
        }}
        placeholder={`Search ${noun}s to link`}
        aria-controls={listId}
        loading={results.isFetching && !results.isLoading}
      />
      <ul id={listId} role="listbox" aria-multiselectable={allowMultiple} aria-label="Items" aria-busy={results.isLoading || undefined} className="-mx-1 flex max-h-64 flex-col overflow-y-auto">
        {!search ? <EmptyListMessage>Linking isn&apos;t available here.</EmptyListMessage> : null}
        {results.isLoading ? (
          <li className="flex flex-col gap-1 px-2 py-1" aria-hidden>
            {[70, 55, 80].map((width) => (
              <span key={width} className="flex h-8 items-center gap-2">
                <Skeleton width={16} height={16} />
                <Skeleton height={10} width={`${width}%`} rounded="full" />
              </span>
            ))}
          </li>
        ) : null}
        {results.isError ? (
          <li className="px-2 py-4 text-center text-sm text-danger-text">
            Couldn&apos;t load {noun}s.{' '}
            <button type="button" className="font-semibold underline" onClick={() => void results.refetch()}>
              Retry
            </button>
          </li>
        ) : null}
        {search && results.isSuccess && flat.length === 0 ? (
          <EmptyListMessage>{debounced ? `No ${noun}s match “${debounced}”` : `No ${noun}s to link yet`}</EmptyListMessage>
        ) : null}
        {groupResults(flat).map((group) => (
          <li key={group.key} role="presentation">
            {group.title ? <div className="px-2.5 pt-2 pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">{group.title}</div> : null}
            <ul role="group" aria-label={group.title ?? 'Results'}>
              {group.items.map((candidate) => {
                const index = flat.indexOf(candidate);
                const isOn = selected.includes(candidate.id);
                return (
                  <li
                    key={candidate.id}
                    role="option"
                    aria-selected={isOn}
                    data-active={index === activeIndex}
                    onPointerMove={() => setActive(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => toggle(candidate)}
                    className="ks-menu-item mx-1 not-data-[active=true]:bg-transparent data-[active=true]:bg-hover"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'inline-flex size-4 shrink-0 items-center justify-center rounded-xs border-[1.5px]',
                        isOn ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong bg-panel',
                      )}
                    >
                      {isOn ? <Check strokeWidth={3} className="size-3" /> : null}
                    </span>
                    <span className="truncate">{candidate.name}</span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const connectRenderer: CellRenderer = {
  behavior: { mode: 'popover', clearable: true, typeToEdit: true, width: 320 },
  Display: ConnectDisplay,
  Editor: ConnectEditor,
};
