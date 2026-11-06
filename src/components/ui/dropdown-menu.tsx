'use client';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from './cn';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuSub = Menu.Sub;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

const contentClass =
  'ks-popover-surface z-[var(--z-popover)] min-w-[200px] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto p-1.5 outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out';

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof Menu.Content>,
  ComponentPropsWithoutRef<typeof Menu.Content>
>(function DropdownMenuContent({ className, sideOffset = 6, align = 'start', ...props }, ref) {
  return (
    <Menu.Portal>
      <Menu.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        className={cn(contentClass, className)}
        {...props}
      />
    </Menu.Portal>
  );
});

export interface MenuItemExtras {
  readonly icon?: ReactNode;
  /** Keyboard shortcut hint shown at the right edge. */
  readonly shortcut?: string;
  /** Secondary line under the label. */
  readonly description?: ReactNode;
  readonly variant?: 'default' | 'danger';
}

export function MenuItemBody({
  icon,
  children,
  shortcut,
  description,
}: Omit<MenuItemExtras, 'variant'> & { readonly children: ReactNode }) {
  return (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        {/* Native tooltip carries the full text whenever a long label is truncated. */}
        <span className="truncate" title={typeof children === 'string' ? children : undefined}>
          {children}
        </span>
        {description ? (
          <span className="truncate text-xs text-fg-muted" title={typeof description === 'string' ? description : undefined}>
            {description}
          </span>
        ) : null}
      </span>
      {shortcut ? <span className="ml-4 shrink-0 text-xs tracking-wide text-fg-muted">{shortcut}</span> : null}
    </>
  );
}

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof Menu.Item>,
  ComponentPropsWithoutRef<typeof Menu.Item> & MenuItemExtras
>(function DropdownMenuItem({ className, icon, shortcut, description, variant = 'default', children, ...props }, ref) {
  return (
    <Menu.Item ref={ref} data-variant={variant} className={cn('ks-menu-item', className)} {...props}>
      <MenuItemBody icon={icon} shortcut={shortcut} description={description}>
        {children}
      </MenuItemBody>
    </Menu.Item>
  );
});

export const DropdownMenuCheckboxItem = forwardRef<
  ElementRef<typeof Menu.CheckboxItem>,
  ComponentPropsWithoutRef<typeof Menu.CheckboxItem> & Omit<MenuItemExtras, 'variant'>
>(function DropdownMenuCheckboxItem({ className, icon, shortcut, children, ...props }, ref) {
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

export const DropdownMenuRadioItem = forwardRef<
  ElementRef<typeof Menu.RadioItem>,
  ComponentPropsWithoutRef<typeof Menu.RadioItem> & Omit<MenuItemExtras, 'variant'>
>(function DropdownMenuRadioItem({ className, icon, children, ...props }, ref) {
  return (
    <Menu.RadioItem ref={ref} className={cn('ks-menu-item pr-8', className)} {...props}>
      <MenuItemBody icon={icon}>{children}</MenuItemBody>
      <Menu.ItemIndicator className="absolute right-2.5 inline-flex text-primary-text">
        <Check aria-hidden className="size-4" />
      </Menu.ItemIndicator>
    </Menu.RadioItem>
  );
});

export const DropdownMenuSubTrigger = forwardRef<
  ElementRef<typeof Menu.SubTrigger>,
  ComponentPropsWithoutRef<typeof Menu.SubTrigger> & Omit<MenuItemExtras, 'variant' | 'shortcut'>
>(function DropdownMenuSubTrigger({ className, icon, children, ...props }, ref) {
  return (
    <Menu.SubTrigger ref={ref} className={cn('ks-menu-item', className)} {...props}>
      <MenuItemBody icon={icon}>{children}</MenuItemBody>
      <ChevronRight aria-hidden className="ml-2 !size-3.5" />
    </Menu.SubTrigger>
  );
});

export const DropdownMenuSubContent = forwardRef<
  ElementRef<typeof Menu.SubContent>,
  ComponentPropsWithoutRef<typeof Menu.SubContent>
>(function DropdownMenuSubContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <Menu.Portal>
      <Menu.SubContent
        ref={ref}
        sideOffset={sideOffset}
        alignOffset={-6}
        collisionPadding={8}
        className={cn(contentClass, className)}
        {...props}
      />
    </Menu.Portal>
  );
});

export function DropdownMenuSeparator({ className }: { readonly className?: string }) {
  return <Menu.Separator className={cn('-mx-1.5 my-1.5 h-px bg-border-subtle', className)} />;
}

export function DropdownMenuLabel({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <Menu.Label className={cn('px-2.5 pt-1.5 pb-1 text-xs font-semibold text-fg-muted', className)}>{children}</Menu.Label>
  );
}
