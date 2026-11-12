'use client';
/**
 * Source picker shown at the top of the Upload step: "Upload a file" or "Paste rows". A WAI-ARIA
 * radio group: arrow keys move focus and check the option (selection follows focus).
 */
import { useRef, type KeyboardEvent } from 'react';
import { ClipboardPaste, FileSpreadsheet, type LucideIcon } from 'lucide-react';
import { cn, labelColorStyle, type LabelColor } from '@/components/ui';
import type { SourceKind } from '../store';

interface SourceOption {
  readonly id: SourceKind;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly color: LabelColor;
}

const OPTIONS: readonly SourceOption[] = [
  { id: 'file', label: 'Upload a file', description: 'Excel, CSV or a Google Sheets download', icon: FileSpreadsheet, color: 'green' },
  { id: 'paste', label: 'Paste rows', description: 'Copy cells from any spreadsheet', icon: ClipboardPaste, color: 'purple' },
];

/** Arrow-key movement inside a radiogroup (roving tabindex). */
export function rovingIndex(key: string, index: number, count: number, columns: number): number | null {
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'ArrowDown') return Math.min(count - 1, index + columns);
  if (key === 'ArrowUp') return Math.max(0, index - columns);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

export interface SourcePickerProps {
  readonly value: SourceKind;
  readonly disabled?: boolean;
  readonly onSelect: (source: SourceKind) => void;
}

export function SourcePicker({ value, disabled, onSelect }: SourcePickerProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(0, OPTIONS.findIndex((option) => option.id === value));
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = rovingIndex(event.key, index, OPTIONS.length, 1);
    if (next === null) return;
    event.preventDefault();
    const option = OPTIONS[next];
    if (!option) return;
    onSelect(option.id);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Import source" className="grid grid-cols-2 gap-2 sm:max-w-[560px]">
      {OPTIONS.map((option, index) => {
        const Icon = option.icon;
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            tabIndex={index === selectedIndex ? 0 : -1}
            ref={(node) => {
              refs.current[index] = node;
            }}
            data-testid={`import-source-${option.id}`}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => onSelect(option.id)}
            style={labelColorStyle(option.color)}
            className={cn(
              'flex items-center gap-3 rounded-lg border bg-panel px-3 py-2.5 text-left',
              'transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)] ease-out',
              'hover:border-primary active:bg-pressed disabled:cursor-not-allowed disabled:opacity-60',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none',
              selected ? 'border-primary bg-primary-subtle ring-1 ring-primary' : 'border-border-subtle',
            )}
          >
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--lc-subtle)] text-[var(--lc-bg)]">
              <Icon aria-hidden className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold text-fg">{option.label}</span>
              <span className="hidden truncate text-xs text-fg-secondary sm:block">{option.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
