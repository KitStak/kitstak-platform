'use client';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as Menu from '@radix-ui/react-context-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from './cn';
import { MenuItemBody, type MenuItemExtras } from './dropdown-menu';

export const ContextMenu = Menu.Root;
export const ContextMenuTrigger = Menu.Trigger;
export const ContextMenuGroup = Menu.Group;
export const ContextMenuSub = Menu.Sub;

const contentClass =
  'ks-popover-surface z-[var(--z-popover)] min-w-[200px] max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto p-1.5 outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out';

export const ContextMenuContent = forwardRef<
  ElementRef<typeof Menu.Content>,
  ComponentPropsWithoutRef<typeof Menu.Content>
>(function ContextMenuContent({ className, ...props }, ref) {
  return (
    <Menu.Portal>
      <Menu.Content ref={ref} collisionPadding={8} className={cn(contentClass, className)} {...props} />
    </Menu.Portal>
  );
});

export const ContextMenuItem = forwardRef<
  ElementRef<typeof Menu.Item>,
  ComponentPropsWithoutRef<typeof Menu.Item> & MenuItemExtras
>(function ContextMenuItem({ className, icon, shortcut, description, variant = 'default', children, ...props }, ref) {
  return (
    <Menu.Item ref={ref} data-variant={variant} className={cn('ks-menu-item', className)} {...props}>
      <MenuItemBody icon={icon} shortcut={shortcut} description={description}>
        {children}
      </MenuItemBody>
    </Menu.Item>
  );
});

export const ContextMenuCheckboxItem = forwardRef<
  ElementRef<typeof Menu.CheckboxItem>,
  ComponentPropsWithoutRef<typeof Menu.CheckboxItem> & Omit<MenuItemExtras, 'variant'>
>(function ContextMenuCheckboxItem({ className, icon, shortcut, children, ...props }, ref) {
  return (
    <Menu.CheckboxItem ref={ref} className={cn('ks-menu-item pr-8', className)} {...props}>
      <MenuItemBody icon={icon} shortcut={shortcut}>
        {children}
      </MenuItemBody>
      <Menu.ItemIndicator className="absolute right-2.5 inline-flex text-primary-text">
        <Check aria-hidden className="size-4" />
      </Menu.ItemIndicator>
    </Menu.CheckboxItem>
  );
});

export const ContextMenuSubTrigger = forwardRef<
  ElementRef<typeof Menu.SubTrigger>,
  ComponentPropsWithoutRef<typeof Menu.SubTrigger> & Omit<MenuItemExtras, 'variant' | 'shortcut'>
>(function ContextMenuSubTrigger({ className, icon, children, ...props }, ref) {
  return (
    <Menu.SubTrigger ref={ref} className={cn('ks-menu-item', className)} {...props}>
      <MenuItemBody icon={icon}>{children}</MenuItemBody>
      <ChevronRight aria-hidden className="ml-2 !size-3.5" />
    </Menu.SubTrigger>
  );
});

export const ContextMenuSubContent = forwardRef<
  ElementRef<typeof Menu.SubContent>,
  ComponentPropsWithoutRef<typeof Menu.SubContent>
>(function ContextMenuSubContent({ className, ...props }, ref) {
  return (
    <Menu.Portal>
      <Menu.SubContent ref={ref} collisionPadding={8} className={cn(contentClass, className)} {...props} />
    </Menu.Portal>
  );
});

export function ContextMenuSeparator({ className }: { readonly className?: string }) {
  return <Menu.Separator className={cn('-mx-1.5 my-1.5 h-px bg-border-subtle', className)} />;
}

export function ContextMenuLabel({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <Menu.Label className={cn('px-2.5 pt-1.5 pb-1 text-xs font-semibold text-fg-muted', className)}>{children}</Menu.Label>
  );
}
