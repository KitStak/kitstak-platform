"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const DEFAULT_DELAY_MS = 300;

export function TooltipProvider({ children, delayDuration = DEFAULT_DELAY_MS }: { readonly children: React.ReactNode; readonly delayDuration?: number }) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration}>{children}</TooltipPrimitive.Provider>;
}

export interface TooltipProps {
  readonly content: React.ReactNode;
  readonly children: React.ReactElement;
  readonly side?: "top" | "right" | "bottom" | "left";
  readonly align?: "start" | "center" | "end";
  /** No tooltip when false/empty — callers can pass a conditional reason. */
  readonly disabled?: boolean;
  readonly delayDuration?: number;
  readonly className?: string;
}

/**
 * Hover/focus hint. Self-contained provider, so it works outside the app shell too.
 * For a disabled button, wrap it — disabled elements do not fire pointer events,
 * so the trigger is a focusable span (see `DisabledReason`).
 */
/**
 * Opens only on pointer hover or keyboard focus (:focus-visible). Focus restored
 * programmatically — e.g. when a popover closes after a click — must not re-show the
 * tooltip; preventDefault makes Radix skip its own focus handler.
 */
const TOOLTIP_SUPPRESS_KEY = "tooltipSuppress";

/**
 * Call right before focus is returned to a tooltip trigger programmatically (e.g. a
 * dialog's `onCloseAutoFocus`): that one focus will not open the tooltip, even when the
 * dialog was closed from the keyboard (where `:focus-visible` would otherwise match).
 */
export function suppressNextTooltipFocus(trigger: HTMLElement | null): void {
  if (!trigger) return;
  trigger.dataset[TOOLTIP_SUPPRESS_KEY] = "1";
  // If focus goes elsewhere, drop the flag so a later real keyboard focus still shows it.
  setTimeout(() => {
    if (trigger.ownerDocument.activeElement !== trigger) delete trigger.dataset[TOOLTIP_SUPPRESS_KEY];
  }, 0);
}

export function suppressProgrammaticFocus(event: React.FocusEvent<HTMLElement>): void {
  const target = event.currentTarget;
  if (target.dataset[TOOLTIP_SUPPRESS_KEY] !== undefined) {
    delete target.dataset[TOOLTIP_SUPPRESS_KEY];
    event.preventDefault();
    return;
  }
  let keyboard = true;
  try {
    keyboard = target.matches(":focus-visible");
  } catch {
    keyboard = true; // engines without :focus-visible keep the default behaviour
  }
  if (!keyboard) event.preventDefault();
}

export function Tooltip({ content, children, side = "top", align = "center", disabled, delayDuration, className }: TooltipProps) {
  if (disabled || content === null || content === undefined || content === "") return children;
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration ?? DEFAULT_DELAY_MS} disableHoverableContent>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild onFocus={suppressProgrammaticFocus}>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "z-[60] max-w-[280px] rounded-md bg-foreground px-2.5 py-1.5 text-[12px] leading-4 font-medium text-surface shadow-md",
              className
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-foreground" width={10} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/**
 * Wraps a (possibly disabled) control so its "why" reason is reachable by hover and
 * keyboard: "Select at least one order". When `reason` is empty the child is returned as-is.
 */
export function DisabledReason({ reason, children, side }: { readonly reason?: string | null; readonly children: React.ReactElement; readonly side?: TooltipProps["side"] }) {
  if (!reason) return children;
  return (
    <Tooltip content={reason} side={side}>
      <span tabIndex={0} className="inline-flex cursor-not-allowed rounded-md [&>*]:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30" aria-label={reason}>
        {children}
      </span>
    </Tooltip>
  );
}
