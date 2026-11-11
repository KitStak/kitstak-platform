'use client';
import { Check, CircleAlert, Copy, Minus } from 'lucide-react';
import { Avatar, Tooltip, cn, toast } from '@/components/ui';
import type { CellRenderContext, CellRenderer } from '../cell-context';
import { formatNumberValue, formatRelativeTime, formatTimestamp } from '../lib/format';
import { computeProgress, readFormula, readLog, readMirror, readNumber, readText, shortItemId } from '../lib/values';
import { TruncText } from '../parts/common';

function ProgressDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const columns = ctx.board?.columns;
  const value = columns?.length ? computeProgress(ctx.column, ctx.item, columns) : (readNumber(ctx.value) ?? 0);
  const pct = Math.min(100, Math.max(0, value));
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
      <span
        role="progressbar"
        aria-label={`${ctx.column.title}: ${pct}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--border-default)]"
      >
        <span
          className={cn('ks-bar-fill absolute inset-0', pct === 100 ? 'bg-[var(--label-green)]' : 'bg-[var(--label-green)] opacity-90')}
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </span>
      <span className={cn('w-9 shrink-0 text-right text-sm tabular-nums', pct === 100 ? 'font-semibold text-success-text' : 'text-fg-secondary')}>
        {pct}%
      </span>
    </span>
  );
}

function FormulaDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const { result, error } = readFormula(ctx.value);
  if (error) {
    return (
      <Tooltip content={error} side="top">
        <span className="flex min-w-0 flex-1 items-center justify-center gap-1 px-2 text-sm font-medium text-danger-text">
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          <span className="truncate">Formula error</span>
        </span>
      </Tooltip>
    );
  }
  if (result === null || result === '') return null;
  if (typeof result === 'boolean') {
    return (
      <span className="flex flex-1 items-center justify-center" role="img" aria-label={result ? 'True' : 'False'}>
        {result ? <Check aria-hidden className="size-4 text-success-text" strokeWidth={3} /> : <Minus aria-hidden className="size-4 text-fg-muted" />}
      </span>
    );
  }
  if (typeof result === 'number') {
    const text = formatNumberValue(result, { decimals: Number.isInteger(result) ? 0 : 2 });
    return (
      <span className="flex min-w-0 flex-1 justify-end px-2.5 tabular-nums">
        <TruncText>{text}</TruncText>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-1 px-2.5">
      <TruncText>{result}</TruncText>
    </span>
  );
}

function MirrorDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const { display, values } = readMirror(ctx.value);
  const present = values.filter((value) => value !== null && value !== '');
  if (!display && present.length === 0) return null;
  const numeric = present.length > 0 && present.every((value) => typeof value === 'number');
  if (numeric || /^-?\d+(\.\d+)?$/.test(display)) {
    const total = Number(display);
    return (
      <span className="flex min-w-0 flex-1 justify-end px-2.5 tabular-nums text-fg-secondary">
        <TruncText tooltip={present.join(', ')}>{Number.isFinite(total) ? formatNumberValue(total, { decimals: Number.isInteger(total) ? 0 : 2 }) : display}</TruncText>
      </span>
    );
  }
  const parts = present.length ? present.map(String) : display.split(', ');
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden px-2">
      <Tooltip content={parts.join(', ')} side="top">
        <span className="flex min-w-0 items-center gap-1">
          {parts.slice(0, 3).map((part, index) => (
            <span key={`${part}-${index}`} className="inline-flex h-6 min-w-0 shrink items-center rounded-sm bg-muted px-2 text-sm text-fg-secondary">
              <span className="truncate">{part}</span>
            </span>
          ))}
          {parts.length > 3 ? <span className="shrink-0 text-xs font-semibold text-fg-muted">+{parts.length - 3}</span> : null}
        </span>
      </Tooltip>
    </span>
  );
}

function LogDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const fallback =
    ctx.column.type === 'last_updated'
      ? { at: ctx.item.updatedAt, userId: ctx.item.updatedBy }
      : { at: ctx.item.createdAt, userId: ctx.item.createdBy };
  const log = readLog(ctx.value) ?? fallback;
  const user = log.userId ? ctx.usersById.get(log.userId) : undefined;
  const verb = ctx.column.type === 'last_updated' ? 'Updated' : 'Created';
  return (
    <Tooltip content={`${verb} ${formatTimestamp(log.at)}${user ? ` by ${user.name}` : ''}`} side="top">
      <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5 text-fg-secondary">
        {user ? (
          <Avatar name={user.name} src={user.image} colorKey={user.id} size="xs" />
        ) : (
          <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-bold text-fg-muted">
            KS
          </span>
        )}
        <span className="truncate text-sm">{formatRelativeTime(log.at, ctx.now)}</span>
      </span>
    </Tooltip>
  );
}

function ItemIdDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const id = readText(ctx.value) || ctx.item.id;
  const short = shortItemId(id);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 pr-1 pl-2.5">
      <Tooltip content={id} side="top">
        <span className="min-w-0 truncate font-mono text-sm text-fg-secondary tabular-nums">
          <span aria-hidden className="text-fg-muted">#</span>
          {short}
          <span className="sr-only">, full ID {id}</span>
        </span>
      </Tooltip>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Copy item ID"
        onClick={(event) => {
          event.stopPropagation();
          void navigator.clipboard
            .writeText(id)
            .then(() => toast.success('Item ID copied'))
            .catch(() => toast.error("Couldn't copy the ID"));
        }}
        className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-icon opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100 group-data-[force-hover=true]/cell:opacity-100 hover:bg-hover hover:text-icon-strong"
      >
        <Copy aria-hidden className="size-3.5" />
      </button>
    </span>
  );
}

const readonly = { mode: 'readonly' } as const;

export const progressRenderer: CellRenderer = { behavior: readonly, Display: ProgressDisplay };
export const formulaRenderer: CellRenderer = { behavior: readonly, Display: FormulaDisplay };
export const mirrorRenderer: CellRenderer = { behavior: readonly, Display: MirrorDisplay };
export const lastUpdatedRenderer: CellRenderer = { behavior: readonly, Display: LogDisplay };
export const creationLogRenderer: CellRenderer = { behavior: readonly, Display: LogDisplay };
export const itemIdRenderer: CellRenderer = { behavior: readonly, Display: ItemIdDisplay };
