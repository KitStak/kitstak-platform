"use client";

/**
 * Menu (BUILD_PLAN F4.2): portal-rendered, arrow-key navigable (Radix), with section
 * headers, item descriptions, submenus, and disabled items that explain why.
 */
import * as React from "react";
import Link from "next/link";
import { DropdownMenu as Menu } from "radix-ui";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { itemClass, panelClass } from "./control-styles";
import { Tooltip } from "./tooltip";

/**
 * Non-modal by default: a modal menu sets `pointer-events: none` on <body>, so the first
 * click on another trigger (or a row kebab) only dismissed the open menu and was swallowed.
 * Non-modal menus still close on outside click and Escape, and that click reaches its target.
 */
export function DropdownMenu({ modal = false, ...props }: React.ComponentProps<typeof Menu.Root>) {
  return <Menu.Root modal={modal} {...props} />;
}
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuSub = Menu.Sub;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof Menu.Content>, React.ComponentPropsWithoutRef<typeof Menu.Content>>(
  ({ className, sideOffset = 4, align = "end", collisionPadding = 8, ...props }, ref) => (
    <Menu.Portal>
      <Menu.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={collisionPadding}
        className={cn(panelClass, "min-w-[184px] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto p-1", className)}
        {...props}
      />
    </Menu.Portal>
  )
);
DropdownMenuContent.displayName = "DropdownMenuContent";

export interface DropdownMenuItemProps extends Omit<React.ComponentPropsWithoutRef<typeof Menu.Item>, "children"> {
  readonly icon?: React.ComponentType<{ className?: string }>;
  readonly description?: React.ReactNode;
  readonly destructive?: boolean;
  /** Disables the item and shows this text as a tooltip. */
  readonly disabledReason?: string | null;
  readonly shortcut?: React.ReactNode;
  /**
   * Render the item as a real link (`<a href>`), so middle-click / Ctrl+click open a new
   * tab and the URL shows on hover. Selecting it navigates client-side via next/link.
   */
  readonly href?: string;
  readonly children: React.ReactNode;
}

export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof Menu.Item>, DropdownMenuItemProps>(
  ({ className, icon: Icon, description, destructive, disabledReason, disabled, shortcut, href, children, ...props }, ref) => {
    const isDisabled = Boolean(disabled || disabledReason);
    // A disabled item reads as disabled: muted icon, no destructive colours, and the
    // reason as its sub-line when no description is given (the tooltip stays too).
    const danger = destructive && !isDisabled;
    const subline = description ?? (disabledReason ? disabledReason : null);
    const content = (
      <>
        {Icon ? <Icon className={cn("h-4 w-4 shrink-0", subline ? "mt-0.5" : null, isDisabled ? "text-faint" : danger ? "text-danger" : "text-secondary")} aria-hidden /> : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{children}</span>
          {subline ? <span className="mt-0.5 text-[11px] leading-4 text-faint">{subline}</span> : null}
        </span>
        {shortcut ? <span className="ml-auto pl-3 text-[11px] tracking-wide text-faint">{shortcut}</span> : null}
      </>
    );
    const item = (
      <Menu.Item
        ref={ref}
        disabled={isDisabled}
        asChild={href !== undefined && !isDisabled}
        className={cn(
          itemClass,
          subline ? "items-start py-2" : null,
          danger && "text-danger data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger",
          className
        )}
        {...props}
      >
        {href !== undefined && !isDisabled ? <Link href={href}>{content}</Link> : content}
      </Menu.Item>
    );
    if (!disabledReason) return item;
    return (
      <Tooltip content={disabledReason} side="left">
        <div>{item}</div>
      </Tooltip>
    );
  }
);
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuCheckboxItem = React.forwardRef<React.ElementRef<typeof Menu.CheckboxItem>, React.ComponentPropsWithoutRef<typeof Menu.CheckboxItem>>(
  ({ className, children, ...props }, ref) => (
    <Menu.CheckboxItem ref={ref} className={cn(itemClass, "pl-7", className)} {...props}>
      <Menu.ItemIndicator className="absolute left-2 inline-flex">
        <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
      </Menu.ItemIndicator>
      {children}
    </Menu.CheckboxItem>
  )
);
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export const DropdownMenuRadioItem = React.forwardRef<React.ElementRef<typeof Menu.RadioItem>, React.ComponentPropsWithoutRef<typeof Menu.RadioItem>>(
  ({ className, children, ...props }, ref) => (
    <Menu.RadioItem ref={ref} className={cn(itemClass, "pl-7", className)} {...props}>
      <Menu.ItemIndicator className="absolute left-2.5 inline-flex">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
      </Menu.ItemIndicator>
      {children}
    </Menu.RadioItem>
  )
);
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

/** Section header. */
export function DropdownMenuLabel({ className, children }: { readonly className?: string; readonly children: React.ReactNode }) {
  return <Menu.Label className={cn("px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint", className)}>{children}</Menu.Label>;
}

export function DropdownMenuSeparator({ className }: { readonly className?: string }) {
  return <Menu.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} />;
}

export const DropdownMenuSubTrigger = React.forwardRef<React.ElementRef<typeof Menu.SubTrigger>, React.ComponentPropsWithoutRef<typeof Menu.SubTrigger> & { readonly icon?: React.ComponentType<{ className?: string }> }>(
  ({ className, children, icon: Icon, ...props }, ref) => (
    <Menu.SubTrigger ref={ref} className={cn(itemClass, "data-[state=open]:bg-surface-sunken", className)} {...props}>
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-secondary" aria-hidden /> : null}
      <span className="flex-1 truncate">{children}</span>
      <ChevronRight className="ml-auto h-3.5 w-3.5 text-faint" aria-hidden />
    </Menu.SubTrigger>
  )
);
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";

export const DropdownMenuSubContent = React.forwardRef<React.ElementRef<typeof Menu.SubContent>, React.ComponentPropsWithoutRef<typeof Menu.SubContent>>(
  ({ className, sideOffset = 4, ...props }, ref) => (
    <Menu.Portal>
      <Menu.SubContent ref={ref} sideOffset={sideOffset} className={cn(panelClass, "min-w-[176px] p-1", className)} {...props} />
    </Menu.Portal>
  )
);
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";
