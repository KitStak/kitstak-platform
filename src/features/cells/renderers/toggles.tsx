'use client';
import { useState } from 'react';
import { Check, Star } from 'lucide-react';
import { Spinner, Tooltip, cn, labelColorStyle, toLabelColor, toast } from '@/components/ui';
import type { CellRenderContext, CellRenderer } from '../cell-context';
import { readNumber } from '../lib/values';

// ---------------------------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------------------------

function CheckboxDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const checked = ctx.value === true;
  return (
    <span className="flex flex-1 items-center justify-center">
      <span
        aria-hidden
        data-checked={checked}
        className={cn(
          'ks-check inline-flex size-[18px] items-center justify-center rounded-xs border-[1.5px]',
          checked
            ? 'border-success bg-success text-white'
            : 'border-border-strong bg-panel group-hover/cell:border-success group-data-[force-hover=true]/cell:border-success',
          ctx.readOnly && 'opacity-60',
        )}
      >
        {checked ? <Check strokeWidth={3.5} className="size-3" /> : null}
      </span>
      <span className="sr-only">{checked ? 'Checked' : 'Not checked'}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------------------------

function RatingDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const max = Math.min(10, Math.max(1, (ctx.column.settings as { max?: number }).max ?? 5));
  const value = readNumber(ctx.value) ?? 0;
  const [hover, setHover] = useState<number | null>(null);
  const [popped, setPopped] = useState<number | null>(null);
  const shown = hover ?? value;
  const size = max > 5 ? 'size-3.5' : 'size-4';
  return (
    // The gridcell is the control: its accessible name is this text, and the digit keys (Cell)
    // set the rating. Stars are pointer affordances only, hidden from assistive tech.
    <span className="flex flex-1 items-center justify-center gap-0.5" onPointerLeave={() => setHover(null)}>
      <span className="sr-only">
        {value ? `${value} of ${max} stars` : 'Not rated'}
        {ctx.readOnly ? '' : `. Press 1 to ${Math.min(9, max)} to rate, 0 or Delete to clear.`}
      </span>
      {Array.from({ length: max }, (_, index) => {
        const rank = index + 1;
        const filled = rank <= shown;
        return (
          <span
            key={rank}
            aria-hidden
            data-testid="rating-star"
            data-disabled={ctx.readOnly || undefined}
            data-pop={popped === rank}
            onPointerEnter={() => !ctx.readOnly && setHover(rank)}
            onAnimationEnd={() => setPopped(null)}
            onClick={(event) => {
              event.stopPropagation();
              if (ctx.readOnly) return;
              const next = rank === value ? null : rank;
              ctx.commit(next);
              setPopped(next);
            }}
            className={cn(
              'ks-star inline-flex items-center justify-center rounded-xs p-px',
              ctx.readOnly ? 'cursor-default' : 'cursor-pointer hover:scale-110',
              filled ? 'text-[var(--warning-accent)]' : 'text-border-strong',
              hover !== null && filled && rank > value && 'opacity-70',
            )}
          >
            <Star aria-hidden className={cn(size, filled && 'fill-current')} strokeWidth={filled ? 1.5 : 1.75} />
          </span>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------------------------

function ButtonDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const settings = ctx.column.settings as { label?: string; color?: string; automationId?: string };
  const label = settings.label || 'Click me';
  const color = toLabelColor(settings.color, 'blue');
  const [running, setRunning] = useState(false);
  const run = ctx.services.runButton;
  const disabled = ctx.readOnly || !run || running;
  const reason = !run ? 'No action is connected to this button yet' : ctx.readOnly ? "You can't run actions on this board" : undefined;

  const onClick = async () => {
    if (!run) return;
    setRunning(true);
    try {
      const message = await run(ctx.column, ctx.item);
      toast.success(message || `“${label}” ran on ${ctx.item.name}`);
    } catch (error) {
      toast.error(`“${label}” didn't run`, error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setRunning(false);
    }
  };

  const button = (
    <button
      type="button"
      tabIndex={-1}
      data-cell-action=""
      aria-disabled={disabled || undefined}
      aria-busy={running || undefined}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) void onClick();
      }}
      style={labelColorStyle(color)}
      className={cn(
        'relative inline-flex h-6 max-w-full min-w-[72px] items-center justify-center gap-1.5 rounded-sm px-2.5 text-sm font-semibold',
        'bg-[var(--lc-bg)] text-[var(--lc-fg)] shadow-xs transition-[background-color,transform,opacity] duration-[var(--duration-instant)] ease-out',
        !disabled && 'hover:bg-[var(--lc-hover)] active:scale-[0.96]',
        disabled && !running && 'cursor-not-allowed opacity-[0.38]',
      )}
    >
      <span className={cn('truncate', running && 'invisible')}>{label}</span>
      {running ? <Spinner size="xs" label={null} className="absolute" /> : null}
    </button>
  );
  return (
    <span className="flex min-w-0 flex-1 items-center justify-center px-2">
      {reason ? (
        <Tooltip content={reason} side="top">
          {button}
        </Tooltip>
      ) : (
        button
      )}
    </span>
  );
}

export const checkboxRenderer: CellRenderer = {
  behavior: { mode: 'toggle', clearable: true },
  Display: CheckboxDisplay,
};

export const ratingRenderer: CellRenderer = {
  behavior: { mode: 'direct', clearable: true },
  Display: RatingDisplay,
};

export const buttonRenderer: CellRenderer = {
  behavior: { mode: 'direct' },
  Display: ButtonDisplay,
};
