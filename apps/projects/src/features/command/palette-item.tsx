'use client';
/** Shared palette row, group heading style and filter (the palette and its program commands use them). */
import type { ReactNode } from 'react';
import { Command, defaultFilter } from 'cmdk';
import { ArrowUpRight, CornerDownLeft } from 'lucide-react';
import { cn } from '@/components/ui';

export const groupClass =
  '[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted';

/** Server results always match (they were searched on the server); everything else uses cmdk's fuzzy score. */
export const REMOTE = 'remote:';
export function paletteFilter(value: string, search: string, keywords?: string[]): number {
  if (value.startsWith(REMOTE)) return 0.5;
  const score = defaultFilter(value, search, keywords);
  // cmdk keeps anything above 0; drop the loose fuzzy hits ("pallets" → "Templates") so only real
  // matches sit above the task results.
  return score < (search.trim().length >= 3 ? 0.3 : 0.05) ? 0 : score;
}

export function Item({
  value,
  keywords,
  onSelect,
  icon,
  children,
  meta,
  hint,
  external,
  forceMount,
  testId = 'palette-item',
}: {
  readonly value: string;
  readonly keywords?: readonly string[];
  readonly onSelect: () => void;
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly meta?: ReactNode;
  readonly hint?: ReactNode;
  readonly external?: boolean;
  readonly forceMount?: boolean;
  readonly testId?: string;
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords ? [...keywords] : undefined}
      onSelect={onSelect}
      forceMount={forceMount}
      data-testid={testId}
      className={cn(
        'group/item mx-2 flex cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-fg select-none',
        meta ? 'min-h-12 py-1.5' : 'h-10',
        'data-[selected=true]:bg-hover',
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-sm text-icon">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {meta ? <span className="truncate text-xs text-fg-muted">{meta}</span> : null}
      </span>
      {hint ? <span className="flex shrink-0 items-center gap-1 text-xs text-fg-muted pointer-coarse:has-[kbd]:hidden">{hint}</span> : null}
      <span aria-hidden className="hidden shrink-0 items-center gap-1 text-fg-muted group-data-[selected=true]/item:flex">
        {external ? <ArrowUpRight className="size-3.5" /> : null}
        <CornerDownLeft className="size-3.5" />
      </span>
    </Command.Item>
  );
}

