"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const overlayClass = "fixed inset-0 z-50 bg-[rgba(16,24,40,0.45)] backdrop-blur-[1px]";

const dialogContentVariants = cva(
  "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg outline-none",
  {
    variants: {
      size: {
        sm: "max-w-[400px]",
        md: "max-w-[560px]",
        lg: "max-w-[720px]",
        xl: "max-w-[960px]",
        full: "h-[calc(100vh-48px)] max-w-[calc(100vw-48px)]",
      },
    },
    defaultVariants: { size: "md" },
  }
);

export type DialogSize = NonNullable<VariantProps<typeof dialogContentVariants>["size"]>;

export interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  readonly size?: DialogSize;
  readonly hideClose?: boolean;
}

export const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  ({ className, size, hideClose, children, ...props }, ref) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content ref={ref} className={cn(dialogContentVariants({ size }), className)} {...props}>
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-3 top-3 rounded-md p-1.5 text-faint transition-colors hover:bg-neutral-soft hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30"
          >
            <X className="h-4 w-4" aria-hidden />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
);
DialogContent.displayName = "DialogContent";

export function DialogHeader({ title, description, className, children }: { readonly title: React.ReactNode; readonly description?: React.ReactNode; readonly className?: string; readonly children?: React.ReactNode }) {
  return (
    <div className={cn("shrink-0 border-b border-border px-5 py-4 pr-12", className)}>
      <DialogPrimitive.Title className="text-base font-semibold leading-5 text-foreground">{title}</DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="mt-1 text-xs leading-4 text-secondary">{description}</DialogPrimitive.Description>
      ) : (
        <DialogPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogPrimitive.Description>
      )}
      {children}
    </div>
  );
}

export function DialogBody({ className, children }: { readonly className?: string; readonly children: React.ReactNode }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm ks-scroll", className)}>{children}</div>;
}

export function DialogFooter({ className, children }: { readonly className?: string; readonly children: React.ReactNode }) {
  return <div className={cn("flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface-sunken px-5 py-3", className)}>{children}</div>;
}

export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
