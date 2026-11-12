"use client";

/**
 * Combobox (BUILD_PLAN F4.2): single or multi select with type-ahead.
 *   - static `options` (filtered locally) or async `loadOptions` (debounced, abortable)
 *   - `minChars` hint: "You have to enter at least 3 characters to search."
 *   - creatable ("Create "abc""), clearable, chips for multi, virtualized lists > 100
 * ARIA 1.2 combobox pattern: the input owns focus; options use aria-activedescendant.
 */
import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { controlVariants, panelClass, type ControlSize } from "./control-styles";
import { Spinner } from "./spinner";
import { DEFAULT_ASYNC_MIN_CHARS, useLabelCache, useOptionSource, type ComboboxOption, type LoadOptions } from "./combobox-data";

export type { ComboboxOption, LoadOptions } from "./combobox-data";

const VIRTUALIZE_ABOVE = 100;
const ROW_HEIGHT = 32;
const LIST_MAX_HEIGHT = 288;

interface BaseProps {
  readonly options?: readonly ComboboxOption[];
  readonly loadOptions?: LoadOptions;
  /** Options for the current value(s) when they are not in `options` (async). */
  readonly selectedOptions?: readonly ComboboxOption[];
  readonly minChars?: number;
  readonly creatable?: boolean;
  readonly onCreate?: (input: string) => ComboboxOption | Promise<ComboboxOption>;
  readonly clearable?: boolean;
  readonly placeholder?: string;
  readonly emptyText?: string;
  /** Static options still loading (the caller's query is pending): spinner + "Loading options…". */
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly size?: ControlSize;
  readonly id?: string;
  readonly className?: string;
  readonly onBlur?: () => void;
  readonly "aria-label"?: string;
  readonly "aria-describedby"?: string;
}

export interface SingleComboboxProps extends BaseProps {
  readonly multiple?: false;
  readonly value: string | null;
  readonly onChange: (value: string | null, option: ComboboxOption | null) => void;
}

export interface MultiComboboxProps extends BaseProps {
  readonly multiple: true;
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[], options: readonly ComboboxOption[]) => void;
}

export type ComboboxProps = SingleComboboxProps | MultiComboboxProps;

type Row = { readonly kind: "option"; readonly option: ComboboxOption } | { readonly kind: "create"; readonly input: string };

function OptionRow({ row, id, active, selected, onPick, style }: { readonly row: Row; readonly id: string; readonly active: boolean; readonly selected: boolean; readonly onPick: () => void; readonly style?: React.CSSProperties }) {
  const disabled = row.kind === "option" && row.option.disabled;
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      data-active={active || undefined}
      style={style}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (!disabled) onPick();
      }}
      className={cn(
        "flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-body",
        active && "bg-surface-sunken text-foreground",
        disabled && "cursor-not-allowed text-faint"
      )}
    >
      {row.kind === "create" ? (
        <>
          <Plus className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span className="truncate">
            Create <span className="font-semibold">&ldquo;{row.input}&rdquo;</span>
          </span>
        </>
      ) : (
        <>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{row.option.label}</span>
            {row.option.description ? <span className="truncate text-2xs text-faint">{row.option.description}</span> : null}
          </span>
          {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /> : null}
        </>
      )}
    </div>
  );
}

function VirtualList({ rows, render }: { readonly rows: readonly Row[]; readonly render: (row: Row, index: number, style?: React.CSSProperties) => React.ReactNode }) {
  const parentRef = React.useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW_HEIGHT, overscan: 8 });
  return (
    <div ref={parentRef} className="overflow-y-auto ks-scroll" style={{ maxHeight: LIST_MAX_HEIGHT }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          return row ? render(row, item.index, { position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)` }) : null;
        })}
      </div>
    </div>
  );
}

export function Combobox(props: ComboboxProps) {
  const { options, loadOptions, selectedOptions, creatable, onCreate, clearable, placeholder = "Search…", emptyText = "No results", disabled, invalid, size = "md", id, className, onBlur } = props;
  const minChars = props.minChars ?? (loadOptions ? DEFAULT_ASYNC_MIN_CHARS : 0);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();
  const source = useOptionSource({ options, loadOptions, query, minChars, open });
  const { lookup, remember } = useLabelCache(options, selectedOptions, source.items);

  const values: readonly string[] = props.multiple ? props.value : props.value === null ? [] : [props.value];
  const selectedSet = new Set(values);
  const trimmed = query.trim();
  const exact = source.items.some((o) => o.label.toLowerCase() === trimmed.toLowerCase());
  const rows: readonly Row[] = [
    ...source.items.map((option) => ({ kind: "option" as const, option })),
    ...(creatable && trimmed && !exact && !source.hint ? [{ kind: "create" as const, input: trimmed }] : []),
  ];
  const safeActive = Math.min(activeIndex, Math.max(rows.length - 1, 0));

  const emit = (next: readonly string[]) => {
    if (props.multiple) props.onChange(next, next.map(lookup));
    else {
      const v = next[0] ?? null;
      props.onChange(v, v === null ? null : lookup(v));
    }
  };

  const pick = async (row: Row) => {
    let option: ComboboxOption;
    if (row.kind === "create") {
      option = onCreate ? await onCreate(row.input) : { value: row.input, label: row.input };
      remember(option);
    } else option = row.option;
    if (props.multiple) {
      emit(selectedSet.has(option.value) ? values.filter((v) => v !== option.value) : [...values, option.value]);
      setQuery("");
      inputRef.current?.focus();
    } else {
      emit([option.value]);
      setQuery("");
      setOpen(false);
    }
  };

  const remove = (value: string) => emit(values.filter((v) => v !== value));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (rows.length ? (Math.min(i, rows.length - 1) + delta + rows.length) % rows.length : 0));
    } else if (e.key === "Enter") {
      const row = rows[safeActive];
      if (open && row) {
        e.preventDefault();
        void pick(row);
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Backspace" && !query && props.multiple && values.length) {
      remove(values[values.length - 1] as string);
    }
  };

  const singleLabel = !props.multiple && props.value !== null ? lookup(props.value).label : "";
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const renderRow = (row: Row, index: number, style?: React.CSSProperties) => (
    <OptionRow
      key={row.kind === "create" ? "__create" : row.option.value}
      row={row}
      id={optionId(index)}
      active={index === safeActive}
      selected={row.kind === "option" && selectedSet.has(row.option.value)}
      onPick={() => void pick(row)}
      style={style}
    />
  );

  return (
    <PopoverPrimitive.Root open={open && !disabled} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div
          data-invalid={invalid || undefined}
          data-disabled={disabled || undefined}
          onClick={() => {
            if (disabled) return;
            setOpen(true);
            inputRef.current?.focus();
          }}
          className={cn(controlVariants({ size }), "flex h-auto items-center gap-1 py-0.5", size === "sm" ? "min-h-7" : size === "lg" ? "min-h-10" : "min-h-8", className)}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {props.multiple
              ? values.map((v) => (
                  <span key={v} className="inline-flex max-w-full items-center gap-1 rounded bg-primary-soft py-0.5 pl-1.5 pr-0.5 text-xs font-medium text-primary">
                    <span className="truncate">{lookup(v).label}</span>
                    <button type="button" aria-label={`Remove ${lookup(v).label}`} disabled={disabled} onClick={(e) => { e.stopPropagation(); remove(v); }} className="rounded p-px hover:bg-primary/15">
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))
              : null}
            <input
              ref={inputRef}
              id={id}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && rows.length ? optionId(safeActive) : undefined}
              aria-invalid={invalid || undefined}
              aria-label={props["aria-label"]}
              aria-describedby={props["aria-describedby"]}
              disabled={disabled}
              value={open || props.multiple ? query : singleLabel}
              placeholder={props.multiple && values.length ? "" : singleLabel || placeholder}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
                setOpen(true);
              }}
              onFocus={() => setQuery("")}
              onBlur={() => onBlur?.()}
              onKeyDown={onKeyDown}
              className="h-6 min-w-[60px] flex-1 bg-transparent text-inherit outline-none placeholder:text-faint disabled:cursor-not-allowed"
              autoComplete="off"
            />
          </div>
          {clearable && values.length && !disabled ? (
            <button type="button" aria-label="Clear" onClick={(e) => { e.stopPropagation(); emit([]); }} className="rounded p-0.5 text-faint hover:bg-neutral-soft hover:text-body">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          {(source.loading || props.loading) && open ? <Spinner className="h-3.5 w-3.5 text-faint" label="Searching" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden />}
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (e.target instanceof Node && inputRef.current?.parentElement?.parentElement?.contains(e.target)) e.preventDefault();
          }}
          className={cn(panelClass, "w-[var(--radix-popover-trigger-width)] min-w-[200px] p-1")}
        >
          <div id={listId} role="listbox" aria-multiselectable={props.multiple || undefined}>
            {source.hint ? (
              <p className="px-2 py-2 text-xs text-secondary">{source.hint}</p>
            ) : source.error ? (
              <p role="alert" className="px-2 py-2 text-xs text-danger">{source.error}</p>
            ) : rows.length === 0 ? (
              source.loading || props.loading ? (
                <p role="status" className="flex items-center gap-2 px-2 py-2 text-xs text-faint">
                  <Spinner className="h-3.5 w-3.5" label="Loading" />
                  {props.loading || trimmed === "" ? "Loading options…" : "Searching…"}
                </p>
              ) : (
                <p className="px-2 py-2 text-xs text-faint">{emptyText}</p>
              )
            ) : rows.length > VIRTUALIZE_ABOVE ? (
              <VirtualList rows={rows} render={renderRow} />
            ) : (
              <div className="overflow-y-auto ks-scroll" style={{ maxHeight: LIST_MAX_HEIGHT }}>
                {rows.map((row, i) => renderRow(row, i))}
              </div>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
