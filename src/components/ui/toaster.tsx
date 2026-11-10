"use client";

import * as React from "react";
import { Toast as ToastPrimitive } from "radix-ui";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { dismissToast, useToasts, type ToastItem, type ToastVariant } from "./toast";

const VARIANT_STYLES: Readonly<Record<ToastVariant, { readonly bar: string; readonly icon: string; readonly Icon: React.ComponentType<{ className?: string }> }>> = {
  success: { bar: "bg-success", icon: "text-success", Icon: CheckCircle2 },
  error: { bar: "bg-danger", icon: "text-danger", Icon: XCircle },
  warning: { bar: "bg-warning", icon: "text-warning", Icon: AlertTriangle },
  info: { bar: "bg-primary", icon: "text-primary", Icon: Info },
};

function ToastCard({ item }: { readonly item: ToastItem }) {
  const style = VARIANT_STYLES[item.variant];
  const Icon = style.Icon;
  return (
    <ToastPrimitive.Root
      duration={Number.isFinite(item.duration) ? item.duration : 2_147_483_647}
      type={item.variant === "error" ? "foreground" : "background"}
      onOpenChange={(open) => {
        if (!open) dismissToast(item.id);
      }}
      className={cn(
        "group relative flex w-[360px] max-w-[calc(100vw-32px)] items-start gap-2.5 overflow-hidden rounded-lg border border-border bg-surface py-3 pl-4 pr-9 shadow-lg",
        "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=end]:translate-x-full transition-transform"
      )}
      data-variant={item.variant}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", style.bar)} aria-hidden />
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.icon)} aria-hidden />
      <div className="min-w-0 flex-1">
        <ToastPrimitive.Title className="text-[13px] font-semibold text-foreground">{item.title}</ToastPrimitive.Title>
        {item.message ? (
          <ToastPrimitive.Description className="mt-0.5 text-[12px] leading-4 text-secondary break-words">
            {item.message}
          </ToastPrimitive.Description>
        ) : null}
        {item.action ? (
          <ToastPrimitive.Action asChild altText={item.action.label}>
            <button
              type="button"
              onClick={item.action.onClick}
              className="mt-1.5 text-[12px] font-semibold text-primary hover:text-primary-hover hover:underline focus-visible:underline"
            >
              {item.action.label}
            </button>
          </ToastPrimitive.Action>
        ) : null}
      </div>
      <ToastPrimitive.Close
        aria-label="Dismiss notification"
        className="absolute right-2 top-2 rounded p-1 text-faint transition-colors hover:bg-neutral-soft hover:text-body"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

/** Mount once in the root layout. Radix pauses the timer on hover/focus. */
export function Toaster() {
  const items = useToasts();
  return (
    <ToastPrimitive.Provider swipeDirection="right" label="Notifications">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex max-h-screen flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}
