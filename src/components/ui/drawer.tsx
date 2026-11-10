"use client";

/**
 * Right sheet (BUILD_PLAN F4.2) at 35 / 45 / 60 % width with a sticky footer.
 * When `dirty`, every close path — X, Esc, overlay click, in-app navigation and
 * reload — asks "You have unsaved changes!… No / Leave" first.
 * On open, focus lands on the first form field in the body (`[data-autofocus]` wins) so
 * the user can type immediately; with no field it falls back to Radix's default.
 */
import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBeforeUnload, useNavigationGuard } from "@/lib/use-unsaved-changes";
import { overlayClass } from "./dialog";
import { UnsavedChangesDialog } from "./unsaved-changes";

export type DrawerWidth = 35 | 45 | 60;

const WIDTH_CLASS: Readonly<Record<DrawerWidth, string>> = {
  35: "w-full sm:w-[35vw] sm:min-w-[440px]",
  45: "w-full sm:w-[45vw] sm:min-w-[520px]",
  60: "w-full sm:w-[60vw] sm:min-w-[640px]",
};

export interface DrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  /** Extra header content (e.g. wizard pills) under the title. */
  readonly headerExtra?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly width?: DrawerWidth;
  /** Guard closing while there are unsaved changes. */
  readonly dirty?: boolean;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
}

const AUTOFOCUS_SELECTOR = "[data-autofocus]";
const FIELD_SELECTOR = [
  "input:not([type=hidden]):not([disabled]):not([readonly])",
  "select:not([disabled])",
  "textarea:not([disabled]):not([readonly])",
  "[role=combobox]:not([disabled])",
].join(",");

/** First field a user would type into, or null. Exported for tests. */
export function firstFormField(root: ParentNode | null): HTMLElement | null {
  if (!root) return null;
  return root.querySelector<HTMLElement>(AUTOFOCUS_SELECTOR) ?? root.querySelector<HTMLElement>(FIELD_SELECTOR);
}

export function Drawer({ open, onOpenChange, title, description, headerExtra, footer, width = 45, dirty = false, children, className, bodyClassName }: DrawerProps) {
  const [confirmClose, setConfirmClose] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const guarded = open && dirty;
  useBeforeUnload(guarded);
  const nav = useNavigationGuard(guarded);

  const requestOpenChange = (next: boolean) => {
    if (!next && dirty) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(next);
  };

  const leave = () => {
    if (nav.pendingHref) {
      onOpenChange(false);
      nav.proceed();
    } else {
      setConfirmClose(false);
      onOpenChange(false);
    }
  };

  const stay = () => {
    setConfirmClose(false);
    nav.cancel();
  };

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={requestOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className={overlayClass} />
          <DialogPrimitive.Content
            className={cn(
              "fixed inset-y-0 right-0 z-50 flex max-w-full flex-col border-l border-border bg-surface shadow-lg outline-none",
              "transition-transform duration-200 ease-out data-[state=closed]:translate-x-full",
              WIDTH_CLASS[width],
              className
            )}
            {...(description ? {} : { "aria-describedby": undefined })}
            onOpenAutoFocus={(event) => {
              const field = firstFormField(bodyRef.current);
              if (!field) return;
              event.preventDefault();
              field.focus();
            }}
          >
            <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="text-[16px] font-semibold leading-6 text-foreground">{title}</DialogPrimitive.Title>
                {description ? <DialogPrimitive.Description className="mt-0.5 text-[12px] leading-4 text-secondary">{description}</DialogPrimitive.Description> : null}
                {headerExtra ? <div className="mt-3">{headerExtra}</div> : null}
              </div>
              <DialogPrimitive.Close
                aria-label="Close"
                className="-mr-1 rounded-md p-1.5 text-faint transition-colors hover:bg-neutral-soft hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <X className="h-4 w-4" aria-hidden />
              </DialogPrimitive.Close>
            </div>
            <div ref={bodyRef} className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4 ks-scroll", bodyClassName)}>{children}</div>
            {footer ? (
              <div className="sticky bottom-0 flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3 shadow-[0_-1px_2px_rgba(16,24,40,0.04)]">
                {footer}
              </div>
            ) : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <UnsavedChangesDialog open={confirmClose || nav.pendingHref !== null} onStay={stay} onLeave={leave} />
    </>
  );
}
