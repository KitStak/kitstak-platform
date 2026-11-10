/**
 * Shared class recipes for form controls so every input-like primitive has the same
 * density (13px type, 32px default height), hover, focus, invalid and disabled states.
 */
import { cva, type VariantProps } from "class-variance-authority";

export const controlVariants = cva(
  [
    "w-full rounded-md border bg-surface text-[13px] text-body placeholder:text-faint",
    "transition-[border-color,box-shadow,background-color] duration-150",
    "border-border-strong/70 hover:border-border-strong",
    "focus-visible:outline-none focus-visible:border-info focus-visible:ring-2 focus-visible:ring-info/25",
    "focus-within:border-info focus-within:ring-2 focus-within:ring-info/25",
    "aria-[invalid=true]:border-danger aria-[invalid=true]:hover:border-danger aria-[invalid=true]:focus-visible:ring-danger/20",
    "data-[invalid=true]:border-danger data-[invalid=true]:focus-within:ring-danger/20",
    "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-faint disabled:hover:border-border-strong/70",
    "data-[disabled=true]:cursor-not-allowed data-[disabled=true]:bg-surface-sunken data-[disabled=true]:text-faint",
  ].join(" "),
  {
    variants: {
      size: {
        sm: "h-7 px-2 text-[12px]",
        md: "h-8 px-2.5",
        lg: "h-10 px-3",
      },
    },
    defaultVariants: { size: "md" },
  }
);

export type ControlSize = NonNullable<VariantProps<typeof controlVariants>["size"]>;

/** Floating panels (popover, menu, select content). */
export const panelClass =
  "z-50 rounded-lg border border-border bg-surface text-body shadow-lg outline-none";

/** Menu / listbox rows. */
export const itemClass =
  "relative flex w-full cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-body outline-none " +
  "transition-colors data-[highlighted]:bg-surface-sunken data-[highlighted]:text-foreground " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:text-faint data-[disabled]:opacity-70 data-[disabled]:hover:bg-transparent";

export const labelClass = "text-[12px] font-semibold text-body";
export const helpTextClass = "text-[11px] leading-4 text-faint";
export const errorTextClass = "text-[11px] leading-4 font-medium text-danger";
