import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 outline-none focus-visible:ring-2 focus-visible:ring-info/40 select-none",
  {
    variants: {
      variant: {
        // Filled variants switch to a neutral fill when disabled; a faded red fill read as live.
        primary: "bg-primary text-white hover:bg-primary-hover shadow-xs disabled:bg-neutral-soft disabled:text-faint disabled:border disabled:border-border disabled:shadow-none disabled:opacity-100",
        secondary:
          "bg-surface text-body border border-border-strong/70 hover:bg-surface-sunken hover:border-border-strong shadow-xs",
        ghost: "text-secondary hover:bg-neutral-soft hover:text-body",
        danger: "bg-danger text-white hover:opacity-90 shadow-xs disabled:bg-neutral-soft disabled:text-faint disabled:border disabled:border-border disabled:shadow-none disabled:opacity-100",
        "success-outline":
          "bg-surface text-success border border-success/40 hover:bg-success-soft shadow-xs",
        nav: "text-fg-secondary hover:bg-hover hover:text-fg",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3",
        lg: "h-9 px-4",
        icon: "h-8 w-8 p-0",
        "icon-sm": "h-7 w-7 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { buttonVariants };
