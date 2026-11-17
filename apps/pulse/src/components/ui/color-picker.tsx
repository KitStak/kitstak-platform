'use client';
import { useRef, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { cn } from './cn';
import { LABEL_COLORS, LABEL_COLOR_NAMES, labelColorStyle, type LabelColor } from './label-color';

export interface ColorPickerProps {
  readonly value: LabelColor | null;
  readonly onChange: (color: LabelColor) => void;
  readonly colors?: readonly LabelColor[];
  readonly columns?: number;
  readonly size?: 'sm' | 'md';
  readonly label?: string;
  readonly className?: string;
}

/**
 * Label palette grid (radiogroup). Arrow keys move in 2D, Enter/Space select. Swatches show the
 * label's foreground check so the selection is legible on every color.
 */
export function ColorPicker({
  value,
  onChange,
  colors = LABEL_COLORS,
  columns = 8,
  size = 'md',
  label = 'Color',
  className,
}: ColorPickerProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(0, value ? colors.indexOf(value) : 0);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const deltas: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    let next: number | null = null;
    if (event.key in deltas) next = index + (deltas[event.key] ?? 0);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = colors.length - 1;
    if (next === null) return;
    event.preventDefault();
    const clamped = (next + colors.length) % colors.length;
    refs.current[clamped]?.focus();
  };

  const swatch = size === 'sm' ? 'size-5' : 'size-6';
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('grid gap-1.5', className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, max-content))` }}
    >
      {colors.map((color, index) => {
        const selected = value === color;
        return (
          <button
            key={color}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={LABEL_COLOR_NAMES[color]}
            title={LABEL_COLOR_NAMES[color]}
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => onChange(color)}
            onKeyDown={(event) => onKeyDown(event, index)}
            style={labelColorStyle(color)}
            className={cn(
              'inline-flex items-center justify-center rounded-sm bg-[var(--lc-bg)] text-[var(--lc-fg)]',
              'transition-[transform,box-shadow] duration-[var(--duration-fast)] ease-out hover:scale-110 hover:bg-[var(--lc-hover)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              selected && 'ring-2 ring-[var(--lc-bg)] ring-offset-2 ring-offset-[var(--surface-raised)]',
              swatch,
            )}
          >
            {selected ? <Check aria-hidden strokeWidth={3} className="size-3.5" /> : null}
          </button>
        );
      })}
    </div>
  );
}
