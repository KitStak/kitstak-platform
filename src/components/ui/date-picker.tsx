"use client";

/**
 * DatePicker (`YYYY/MM/DD`) and the shared typed-input + calendar field used by
 * DateTimePicker (`YYYY/MM/DD HH:mm`). Users can type or pick; invalid text is
 * reverted on blur and flagged via `aria-invalid` while editing.
 */
import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { INPUT_DATE_FORMAT, INPUT_DATETIME_FORMAT, formatPattern, parseInputDateTime } from "@/lib/format";
import { Calendar } from "./calendar";
import { controlVariants, panelClass, type ControlSize } from "./control-styles";

export interface DateFieldBaseProps {
  readonly value: Date | null;
  readonly onChange: (value: Date | null) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly clearable?: boolean;
  readonly size?: ControlSize;
  readonly minDate?: Date;
  readonly maxDate?: Date;
  readonly id?: string;
  readonly className?: string;
  readonly onBlur?: () => void;
  readonly "aria-label"?: string;
  readonly "aria-describedby"?: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** "Today" in the footer: midnight for a date, the current minute for a date-time. */
export function todayValue(includeTime: boolean, now: Date = new Date()): Date {
  return includeTime
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

const footerButton = "h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30";

function withTime(day: Date, source: Date | null, includeTime: boolean): Date {
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  if (includeTime && source) next.setHours(source.getHours(), source.getMinutes());
  return next;
}

export function DateField({ includeTime, ...props }: DateFieldBaseProps & { readonly includeTime: boolean }) {
  const { value, onChange, disabled, invalid, clearable = true, size = "md", minDate, maxDate, id, className, onBlur } = props;
  const pattern = includeTime ? INPUT_DATETIME_FORMAT : INPUT_DATE_FORMAT;
  const display = value ? formatPattern(value, pattern) : "";
  const [text, setText] = React.useState(display);
  const [editing, setEditing] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const shown = editing ? text : display;
  const parsed = editing && text.trim() ? parseInputDateTime(text) : null;
  const badText = editing && text.trim() !== "" && parsed === null;

  const commitText = () => {
    if (!text.trim()) {
      setEditing(false);
      if (value !== null) onChange(null);
      return;
    }
    const next = parseInputDateTime(text);
    // Unparseable text stays visible (and flagged invalid) instead of silently vanishing.
    if (!next) return;
    setEditing(false);
    if (!value || next.getTime() !== value.getTime()) onChange(next);
  };

  const anchorRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const openCalendar = () => {
    if (!disabled) setOpen(true);
  };
  const pick = (next: Date | null) => {
    onChange(next);
    setEditing(false);
    setOpen(false);
  };

  const disabledMatchers = [...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])];

  return (
    <PopoverPrimitive.Root open={open && !disabled} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div ref={anchorRef} data-invalid={invalid || badText || undefined} data-disabled={disabled || undefined} className={cn(controlVariants({ size }), "flex items-center gap-1.5 pr-1", className)}>
          <input
            ref={inputRef}
            id={id}
            value={shown}
            disabled={disabled}
            placeholder={props.placeholder ?? pattern}
            aria-invalid={invalid || badText || undefined}
            aria-label={props["aria-label"]}
            aria-describedby={props["aria-describedby"]}
            inputMode="numeric"
            autoComplete="off"
            onFocus={() => {
              setText(display);
              setEditing(true);
            }}
            onClick={openCalendar}
            onChange={(e) => {
              // Typing after an Enter commit (focus never left) must show the new text.
              setText(e.target.value);
              setEditing(true);
            }}
            onBlur={() => {
              commitText();
              onBlur?.();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Enter commits typed text; on an untouched field it opens the calendar instead.
                const typed = text.trim() !== display;
                commitText();
                if (!typed && !open) {
                  e.preventDefault();
                  openCalendar();
                } else {
                  setOpen(false);
                }
              }
              if (e.key === "ArrowDown" && e.altKey) openCalendar();
            }}
            className="h-full min-w-0 flex-1 bg-transparent tabular-nums outline-none placeholder:text-faint disabled:cursor-not-allowed"
          />
          {clearable && value && !disabled ? (
            <button type="button" aria-label="Clear date" onClick={() => onChange(null)} className="rounded p-0.5 text-faint hover:bg-neutral-soft hover:text-body">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          <PopoverPrimitive.Trigger asChild>
            <button type="button" aria-label="Open calendar" disabled={disabled} className="rounded p-1 text-secondary transition-colors hover:bg-neutral-soft hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30 disabled:cursor-not-allowed">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            </button>
          </PopoverPrimitive.Trigger>
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className={cn(panelClass, "p-3")}
          // Keep focus in the text field so the user can keep typing while the calendar is open.
          onOpenAutoFocus={(event) => event.preventDefault()}
          // Closing (Escape, a pick, Today/Clear) returns focus to the text field, not the calendar icon.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus({ preventScroll: true });
          }}
          onInteractOutside={(event) => {
            if (event.target instanceof Node && anchorRef.current?.contains(event.target)) event.preventDefault();
          }}
        >
          <Calendar
            mode="single"
            selected={value ?? undefined}
            defaultMonth={value ?? undefined}
            disabled={disabledMatchers}
            onSelect={(day: Date | undefined) => {
              if (!day) return;
              onChange(withTime(day, value, includeTime));
              if (!includeTime) setOpen(false);
            }}
          />
          {includeTime ? (
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
              <label className="text-[12px] font-medium text-secondary" htmlFor={`${id ?? "dt"}-time`}>
                Time
              </label>
              <input
                id={`${id ?? "dt"}-time`}
                type="time"
                value={value ? `${pad(value.getHours())}:${pad(value.getMinutes())}` : ""}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return;
                  const base = value ?? new Date();
                  onChange(new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0));
                }}
                className="h-7 rounded-md border border-border-strong/70 bg-surface px-2 text-[12px] tabular-nums focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25"
              />
            </div>
          ) : null}
          <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
            <button type="button" onClick={() => pick(todayValue(includeTime))} className={cn(footerButton, "text-primary hover:bg-primary-soft")}>
              Today
            </button>
            <button type="button" onClick={() => pick(null)} className={cn(footerButton, "text-secondary hover:bg-neutral-soft hover:text-body")}>
              Clear
            </button>
            {includeTime ? (
              <button type="button" onClick={() => setOpen(false)} className={cn(footerButton, "ml-auto bg-primary px-3 text-white hover:bg-primary-hover")}>
                Done
              </button>
            ) : null}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function DatePicker(props: DateFieldBaseProps) {
  return <DateField {...props} includeTime={false} />;
}
