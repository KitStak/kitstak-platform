import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-md border border-border-input bg-panel px-2.5 text-sm text-fg placeholder:text-fg-placeholder",
        "transition-colors hover:border-border-input-hover focus:border-primary focus:outline-none focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]",
        "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-faint",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export function Field({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-fg-secondary">
        {label}
        {required ? <span className="text-danger">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="text-2xs text-danger-text">{error}</span>
      ) : hint ? (
        <span className="text-2xs text-fg-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-8 w-full appearance-none rounded-md border border-border-input bg-surface bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23667085%22%20stroke-width%3D%222.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[position:right_8px_center] bg-no-repeat pl-2.5 pr-7 text-sm text-body",
      "transition-colors hover:border-border-input-hover focus:border-primary focus:outline-none focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]",
      className
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      "h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border border-border-strong bg-surface align-middle",
      "checked:border-primary checked:bg-primary checked:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22white%22%20stroke-width%3D%223.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M20%206%209%2017l-5-5%22%2F%3E%3C%2Fsvg%3E')] checked:bg-center checked:bg-no-repeat",
      "indeterminate:border-primary indeterminate:bg-primary indeterminate:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22white%22%20stroke-width%3D%224%22%20stroke-linecap%3D%22round%22%3E%3Cpath%20d%3D%22M5%2012h14%22%2F%3E%3C%2Fsvg%3E')] indeterminate:bg-center indeterminate:bg-no-repeat",
      "transition-colors hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-focus/30",
      className
    )}
    {...props}
  />
));
Checkbox.displayName = "Checkbox";
