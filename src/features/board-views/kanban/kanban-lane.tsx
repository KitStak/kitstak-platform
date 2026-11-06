'use client';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ArrowLeft, ArrowRight, ChevronsLeftRight, Gauge, MoreHorizontal, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
  Tooltip,
  cn,
  labelColorStyle,
} from '@/components/ui';
import type { Lane, LaneTotals } from '../lib/kanban';
import { formatCompact, formatFull, pluralNoun } from '../lib/values';

export interface KanbanLaneProps {
  readonly lane: Lane;
  readonly itemIds: readonly string[];
  readonly totals: LaneTotals;
  readonly currency: string | null;
  readonly wipLimit: number | undefined;
  readonly collapsed: boolean;
  readonly isOver: boolean;
  readonly noun: string;
  readonly canEdit: boolean;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly addOpen: boolean;
  readonly onAddOpenChange: (open: boolean) => void;
  readonly onAdd: (name: string) => void;
  readonly onToggleCollapse: () => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onWipLimit: (limit: number | null) => void;
  readonly children: ReactNode;
}

const WIP_OPTIONS = [0, 3, 5, 8, 10, 15, 20];

function AddCard({ noun, onAdd, onClose }: { readonly noun: string; readonly onAdd: (name: string) => void; readonly onClose: () => void }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && value.trim()) {
      event.preventDefault();
      onAdd(value.trim());
      setValue('');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };
  return (
    <div className="rounded-lg border border-primary bg-panel p-2 shadow-sm">
      <Input
        ref={ref}
        size="sm"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!value.trim()) onClose();
        }}
        placeholder={`${noun} name`}
        aria-label={`New ${noun.toLowerCase()} name`}
        data-testid="kanban-add-input"
      />
      <p className="mt-1.5 text-xs text-fg-muted">
        <kbd className="font-sans font-semibold">Enter</kbd> to add · <kbd className="font-sans font-semibold">Esc</kbd> to close
      </p>
    </div>
  );
}

export function KanbanLane({
  lane,
  itemIds,
  totals,
  currency,
  wipLimit,
  collapsed,
  isOver,
  noun,
  canEdit,
  isFirst,
  isLast,
  addOpen,
  onAddOpenChange,
  onAdd,
  onToggleCollapse,
  onMove,
  onWipLimit,
  children,
}: KanbanLaneProps) {
  const { setNodeRef } = useDroppable({ id: `lane:${lane.id}`, data: { type: 'lane', laneId: lane.id } });
  const overLimit = wipLimit !== undefined && totals.count > wipLimit;
  const countLabel = wipLimit ? `${totals.count}/${wipLimit}` : String(totals.count);
  const style = labelColorStyle(lane.color);

  if (collapsed) {
    return (
      <div ref={setNodeRef} style={style} className="flex h-full shrink-0" data-testid="kanban-lane" data-lane-id={lane.id} data-collapsed="true">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={`Expand ${lane.title} (${totals.count})`}
          aria-expanded={false}
          className={cn(
            'flex w-10 flex-col items-center gap-2 rounded-lg bg-[var(--lc-bg)] py-3 text-[var(--lc-fg)]',
            'transition-[filter,box-shadow] duration-[var(--duration-fast)] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            isOver && 'shadow-[0_0_0_2px_var(--focus-ring)]',
          )}
        >
          <ChevronsLeftRight aria-hidden className="size-4" />
          <span className="text-sm font-semibold tabular-nums">{totals.count}</span>
          <span className="text-sm font-semibold whitespace-nowrap [writing-mode:vertical-rl]">{lane.title}</span>
        </button>
      </div>
    );
  }

  return (
    <section
      style={style}
      aria-label={`${lane.title}, ${totals.count} ${pluralNoun(noun, totals.count)}`}
      data-testid="kanban-lane"
      data-lane-id={lane.id}
      className="flex h-full w-[272px] shrink-0 flex-col max-[480px]:w-[min(272px,calc(100vw-56px))]"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 rounded-t-lg bg-[var(--lc-bg)] pr-1.5 pl-3 text-[var(--lc-fg)]">
        <h3 className="min-w-0 truncate text-base font-semibold" title={lane.title}>
          {lane.title}
        </h3>
        <Tooltip content={overLimit ? `Over the WIP limit of ${wipLimit}` : wipLimit ? `WIP limit ${wipLimit}` : `${totals.count} ${pluralNoun(noun, totals.count)}`}>
          <span
            data-testid="kanban-lane-count"
            className={cn(
              'inline-flex h-5 min-w-5 items-center justify-center rounded-pill px-1.5 text-xs font-semibold tabular-nums',
              overLimit ? 'bg-warning-accent text-[var(--text-primary)]' : 'bg-[color-mix(in_srgb,var(--lc-fg)_18%,transparent)]',
            )}
          >
            {countLabel}
          </span>
        </Tooltip>
        <span className="flex-1" />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${lane.title} lane options`}
              className="inline-flex size-7 items-center justify-center rounded-sm hover:bg-[color-mix(in_srgb,var(--lc-fg)_16%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current data-[state=open]:bg-[color-mix(in_srgb,var(--lc-fg)_16%,transparent)]"
            >
              <MoreHorizontal aria-hidden className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={<ChevronsLeftRight aria-hidden />} onSelect={onToggleCollapse}>
              Collapse lane
            </DropdownMenuItem>
            <DropdownMenuItem icon={<ArrowLeft aria-hidden />} disabled={isFirst} onSelect={() => onMove(-1)}>
              Move left
            </DropdownMenuItem>
            <DropdownMenuItem icon={<ArrowRight aria-hidden />} disabled={isLast} onSelect={() => onMove(1)}>
              Move right
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={<Gauge aria-hidden />}>WIP limit</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={String(wipLimit ?? 0)} onValueChange={(value) => onWipLimit(Number(value) || null)}>
                  {WIP_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem key={option} value={String(option)}>
                      {option === 0 ? 'No limit' : `${option} ${pluralNoun(noun, option)}`}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col rounded-b-lg bg-[var(--lc-subtle)] transition-[background-color,box-shadow] duration-[var(--duration-fast)] ease-out',
          isOver && 'bg-[color-mix(in_srgb,var(--lc-bg)_24%,var(--lc-subtle))] shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--lc-bg)_55%,transparent)]',
        )}
      >
        {totals.sum !== null ? (
          <div className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-xs text-fg-secondary tabular-nums" data-testid="kanban-lane-totals">
            <Tooltip content={`Total: ${formatFull(totals.sum, currency)}`}>
              <span className="font-semibold text-fg">{formatCompact(totals.sum, currency)}</span>
            </Tooltip>
            {totals.weighted !== null ? (
              <>
                <span aria-hidden>·</span>
                <Tooltip content={`Weighted by probability: ${formatFull(totals.weighted, currency)}`}>
                  <span>wtd {formatCompact(totals.weighted, currency)}</span>
                </Tooltip>
              </>
            ) : null}
          </div>
        ) : null}
        <SortableContext items={[...itemIds]} strategy={verticalListSortingStrategy}>
          <div role="list" aria-label={`${lane.title} ${pluralNoun(noun, 2)}`} className="flex min-h-12 flex-1 flex-col gap-2 overflow-y-auto px-2 pt-2 pb-1 [scrollbar-gutter:stable]">
            {children}
            {itemIds.length === 0 && !addOpen ? (
              <p className="flex h-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-[color-mix(in_srgb,var(--lc-bg)_45%,transparent)] text-sm text-fg-muted">
                {isOver ? 'Drop here' : `No ${pluralNoun(noun, 2)}`}
              </p>
            ) : null}
            {addOpen ? <AddCard noun={noun} onAdd={onAdd} onClose={() => onAddOpenChange(false)} /> : null}
          </div>
        </SortableContext>
        {canEdit && !addOpen ? (
          <div className="shrink-0 px-2 pb-2">
            <button
              type="button"
              onClick={() => onAddOpenChange(true)}
              data-testid="kanban-add"
              className={cn(
                'flex h-8 w-full items-center gap-1.5 rounded-sm px-2 text-sm text-fg-secondary',
                'transition-colors duration-[var(--duration-fast)] hover:bg-panel hover:text-primary-text active:bg-pressed',
                'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus',
              )}
            >
              <Plus aria-hidden className="size-4" />
              Add {noun.toLowerCase()}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
