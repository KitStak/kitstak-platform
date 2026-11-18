'use client';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from './cn';

/** The tabs root may shrink inside a flex row, so a long tab list scrolls sideways instead of pushing the page wide. */
export const Tabs = forwardRef<ElementRef<typeof TabsPrimitive.Root>, ComponentPropsWithoutRef<typeof TabsPrimitive.Root>>(function Tabs({ className, ...props }, ref) {
  return <TabsPrimitive.Root ref={ref} className={cn('max-w-full min-w-0', className)} {...props} />;
});

export type TabsVariant = 'underline' | 'view' | 'pill';

export interface TabsListProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  /**
   * - `underline`: page-level tabs with a sliding 2px primary underline on a hairline baseline.
   * - `view`: board view tabs (Main table / Kanban / …): compact, icon + label, selected chip.
   * - `pill`: segmented filter tabs on a sunken track.
   */
  readonly variant?: TabsVariant;
}

const LIST: Readonly<Record<TabsVariant, string>> = {
  underline: 'flex items-end gap-6 border-b border-border-subtle',
  view: 'flex items-center gap-0.5',
  pill: 'inline-flex items-center gap-0.5 rounded-md bg-sunken p-0.5',
};

const TRIGGER: Readonly<Record<TabsVariant, string>> = {
  underline: [
    'relative -mb-px inline-flex h-9 items-center gap-1.5 rounded-t-sm border-b-2 border-transparent px-0.5 text-sm font-medium text-fg-secondary',
    'transition-[color,border-color] duration-[var(--duration-fast)] ease-out hover:text-fg',
    'data-[state=active]:border-primary data-[state=active]:text-fg',
  ].join(' '),
  view: [
    'relative inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-fg-secondary',
    'transition-[background-color,color] duration-[var(--duration-instant)] ease-out hover:bg-hover hover:text-fg',
    'after:absolute after:inset-x-2 after:-bottom-[5px] after:h-0.5 after:rounded-full after:bg-transparent after:transition-colors',
    'data-[state=active]:font-medium data-[state=active]:text-fg data-[state=active]:after:bg-primary',
  ].join(' '),
  pill: [
    'inline-flex h-7 items-center gap-1.5 rounded-sm px-3 text-sm text-fg-secondary',
    'transition-[background-color,color,box-shadow] duration-[var(--duration-fast)] ease-out hover:text-fg',
    'data-[state=active]:bg-raised data-[state=active]:font-medium data-[state=active]:text-fg data-[state=active]:shadow-xs data-[state=active]:ring-1 data-[state=active]:ring-[color:var(--segment-ring)]',
  ].join(' '),
};

export const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, TabsListProps>(function TabsList(
  { className, variant = 'underline', ...props },
  ref,
) {
  return <TabsPrimitive.List ref={ref} data-variant={variant} className={cn(LIST[variant], className)} {...props} />;
});

export interface TabsTriggerProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  readonly variant?: TabsVariant;
  readonly icon?: ReactNode;
  /** Count shown after the label. */
  readonly count?: number;
}

export const TabsTrigger = forwardRef<ElementRef<typeof TabsPrimitive.Trigger>, TabsTriggerProps>(function TabsTrigger(
  { className, variant = 'underline', icon, count, children, onPointerDown, onKeyDown, onBlur, ...props },
  ref,
) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      // A pointer activation never shows the keyboard ring, even if the tab is re-focused
      // programmatically while the URL/state syncs; any key press restores it.
      onPointerDown={(event) => {
        event.currentTarget.dataset.pointerFocus = 'true';
        onPointerDown?.(event);
      }}
      onKeyDown={(event) => {
        delete event.currentTarget.dataset.pointerFocus;
        onKeyDown?.(event);
      }}
      onBlur={(event) => {
        delete event.currentTarget.dataset.pointerFocus;
        onBlur?.(event);
      }}
      className={cn(
        TRIGGER[variant],
        'outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus data-[pointer-focus=true]:focus-visible:outline-none disabled:pointer-events-none disabled:opacity-[0.38]',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {count !== undefined ? (
        <span className="min-w-5 rounded-full bg-muted px-1.5 text-center text-xs font-semibold text-fg-secondary">
          {count}
        </span>
      ) : null}
    </TabsPrimitive.Trigger>
  );
});

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn('outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus data-[state=active]:animate-fade-in', className)}
      {...props}
    />
  );
});
