"use client";

/**
 * Select (BUILD_PLAN F4.2): Radix listbox styled as a 32px control. For long or
 * searchable lists use `Combobox`; for the legacy native element see `input.tsx`.
 */
import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { controlVariants, itemClass, panelClass, type ControlSize } from "./control-styles";

export interface SelectOption<V extends string = string> {
  readonly value: V;
  readonly label: React.ReactNode;
  /** Plain text for the trigger when `label` is rich. */
  readonly textValue?: string;
  readonly description?: React.ReactNode;
  readonly disabled?: boolean;
  readonly group?: string;
}

export interface SelectProps<V extends string = string> {
  readonly options: readonly SelectOption<V>[];
  readonly value: V | null;
  readonly onChange: (value: V | null) => void;
  readonly placeholder?: string;
  readonly clearable?: boolean;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly size?: ControlSize;
  readonly id?: string;
  readonly name?: string;
  readonly className?: string;
  readonly contentClassName?: string;
  readonly onBlur?: () => void;
  readonly "aria-label"?: string;
  readonly "aria-describedby"?: string;
}

function groupOptions<V extends string>(options: readonly SelectOption<V>[]): readonly { readonly label: string | null; readonly items: readonly SelectOption<V>[] }[] {
  const groups: { label: string | null; items: SelectOption<V>[] }[] = [];
  for (const option of options) {
    const label = option.group ?? null;
    const existing = groups.find((g) => g.label === label);
    if (existing) existing.items.push(option);
    else groups.push({ label, items: [option] });
  }
  return groups;
}

function SelectInner<V extends string>(
  { options, value, onChange, placeholder = "Select…", clearable, disabled, invalid, size = "md", id, name, className, contentClassName, onBlur, ...aria }: SelectProps<V>,
  ref: React.ForwardedRef<HTMLButtonElement>
) {
  const groups = groupOptions(options);
  const showClear = clearable && value !== null && !disabled;
  return (
    <div className="relative w-full">
      <SelectPrimitive.Root
        value={value ?? ""}
        onValueChange={(next) => onChange(next === "" ? null : (next as V))}
        disabled={disabled}
        name={name}
        onOpenChange={(open) => {
          if (!open) onBlur?.();
        }}
      >
        <SelectPrimitive.Trigger
          ref={ref}
          id={id}
          aria-invalid={invalid || undefined}
          aria-label={aria["aria-label"]}
          aria-describedby={aria["aria-describedby"]}
          className={cn(
            controlVariants({ size }),
            "flex items-center justify-between gap-2 text-left data-[placeholder]:text-faint",
            "data-[state=open]:border-primary data-[state=open]:ring-2 data-[state=open]:ring-primary/25",
            showClear && "pr-12",
            className
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            <SelectPrimitive.Value placeholder={placeholder} />
          </span>
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            collisionPadding={8}
            className={cn(panelClass, "min-w-[var(--radix-select-trigger-width)] max-h-[min(320px,var(--radix-select-content-available-height))] overflow-hidden", contentClassName)}
          >
            <SelectPrimitive.Viewport className="p-1">
              {groups.map((group, gi) => (
                <SelectPrimitive.Group key={group.label ?? `g${gi}`}>
                  {group.label ? (
                    <SelectPrimitive.Label className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{group.label}</SelectPrimitive.Label>
                  ) : null}
                  {group.items.map((option) => (
                    <SelectPrimitive.Item
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                      textValue={option.textValue}
                      className={cn(itemClass, "pr-7", option.description ? "items-start" : null)}
                    >
                      <span className="flex min-w-0 flex-col">
                        <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                        {option.description ? <span className="text-[11px] leading-4 text-faint">{option.description}</span> : null}
                      </span>
                      <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex">
                        <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                      </SelectPrimitive.ItemIndicator>
                    </SelectPrimitive.Item>
                  ))}
                </SelectPrimitive.Group>
              ))}
              {options.length === 0 ? <p className="px-2 py-1.5 text-[12px] text-faint">No options</p> : null}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {showClear ? (
        <button
          type="button"
          aria-label="Clear selection"
          onClick={() => onChange(null)}
          className="absolute right-7 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint transition-colors hover:bg-neutral-soft hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export const Select = React.forwardRef(SelectInner) as <V extends string = string>(
  props: SelectProps<V> & { readonly ref?: React.ForwardedRef<HTMLButtonElement> }
) => React.ReactElement;
