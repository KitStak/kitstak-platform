'use client';
/**
 * Click-don't-type wizard inputs: big radio tiles and segmented pills, both proper
 * radiogroups with roving tabindex + arrow-key selection.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Badge, cn } from '@/components/ui';

export interface TileOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly caption: string;
  readonly icon: ReactNode;
  readonly recommended?: boolean;
}

interface TileGroupProps<T extends string> {
  readonly label: string;
  readonly options: readonly TileOption<T>[];
  readonly value: T | null;
  readonly onChange: (value: T) => void;
  readonly columns?: 2 | 3;
}

function nextIndex(current: number, delta: number, length: number): number {
  return (current + delta + length) % length;
}

export function TileGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  columns = 3,
}: TileGroupProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const target = nextIndex(index, delta, options.length);
    onChange(options[target].value);
    refs.current[target]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('grid gap-3', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (selectedIndex === -1 && index === 0) ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'group relative flex flex-col items-start gap-3 rounded-xl border p-4 text-left',
              'transition-[border-color,box-shadow,transform,background-color] duration-[var(--duration-fast)] ease-out',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              selected
                ? 'border-primary bg-primary-subtle/40 shadow-sm'
                : 'border-border-default bg-panel shadow-xs hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
            )}
          >
            <span className="flex w-full items-start justify-between">
              <span
                className={cn(
                  'flex size-9 items-center justify-center rounded-lg transition-colors duration-[var(--duration-fast)]',
                  selected ? 'bg-primary text-primary-fg' : 'bg-sunken text-icon',
                  '[&_svg]:size-4.5',
                )}
              >
                {option.icon}
              </span>
              <span
                aria-hidden
                className={cn(
                  'flex size-5 items-center justify-center rounded-full border transition-all duration-[var(--duration-fast)]',
                  selected
                    ? 'border-primary bg-primary text-primary-fg'
                    : 'border-border-strong bg-panel text-transparent',
                )}
              >
                <Check className="size-3" strokeWidth={3} />
              </span>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                {option.label}
                {option.recommended ? <Badge tone="info">Popular</Badge> : null}
              </span>
              <span className="text-xs leading-4 text-fg-muted">{option.caption}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface PillGroupProps<T extends string> {
  readonly label: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}

export function PillGroup<T extends string>({ label, options, value, onChange }: PillGroupProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              const delta =
                event.key === 'ArrowRight' || event.key === 'ArrowDown'
                  ? 1
                  : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                    ? -1
                    : 0;
              if (delta === 0) return;
              event.preventDefault();
              const target = nextIndex(index, delta, options.length);
              onChange(options[target].value);
              refs.current[target]?.focus();
            }}
            className={cn(
              'inline-flex h-9 items-center rounded-lg border px-3.5 text-sm font-medium',
              'transition-colors duration-[var(--duration-instant)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              selected
                ? 'border-primary bg-primary text-primary-fg'
                : 'border-border-input bg-panel text-fg-secondary hover:border-border-input-hover hover:text-fg',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
