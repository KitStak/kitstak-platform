import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-[0.38] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus select-none",
  {
    variants: {
      variant: {
        // Filled variants switch to a neutral fill when disabled; a faded red fill read as live.
        primary: "bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-active disabled:border-border-subtle disabled:bg-sunken disabled:text-fg-muted disabled:opacity-100",
        secondary:
          "bg-panel text-fg border-border-input hover:bg-muted hover:border-border-input-hover active:bg-pressed",
        ghost: "text-fg-secondary hover:bg-hover hover:text-fg active:bg-pressed",
        // Destructive actions are outlined, not filled, so they never read as the crimson primary.
        danger: "bg-panel text-danger-text border-danger/45 hover:bg-danger-subtle hover:border-danger active:bg-danger-subtle",
        "success-outline":
          "bg-panel text-success-text border-success/40 hover:bg-success-subtle",
        nav: "text-fg-secondary hover:bg-hover hover:text-fg",
      },
      size: {
        xs: "h-6 px-2 text-xs",
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3",
        lg: "h-10 px-4 text-base",
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
