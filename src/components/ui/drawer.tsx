'use client';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from './cn';
import { IconButton } from './icon-button';

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export interface DrawerContentProps extends Omit<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'title'> {
  /** Width in px (clamped to the viewport). */
  readonly width?: number;
  /** Render a dimmed backdrop. Side panels that keep the page usable pass false. */
  readonly modal?: boolean;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Header actions rendered left of the close button. */
  readonly actions?: ReactNode;
}

/** Right-side panel (item card, notifications, activity). */
export const DrawerContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, DrawerContentProps>(
  function DrawerContent({ className, width = 560, modal = true, title, description, actions, children, style, ...props }, ref) {
    return (
      <DialogPrimitive.Portal>
        {modal ? (
          <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-overlay/60 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        ) : null}
        <DialogPrimitive.Content
          ref={ref}
          style={{ width: `min(${width}px, 100vw)`, ...style }}
          className={cn(
            'fixed top-0 right-0 bottom-0 z-[var(--z-modal)] flex flex-col border-l border-border-subtle bg-raised text-fg shadow-modal outline-none',
            'data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right',
            className,
          )}
          {...props}
        >
          <header className="flex items-start gap-3 border-b border-border-subtle px-6 py-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate font-heading text-xl font-semibold">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-sm text-fg-secondary">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : 'Panel'}</DialogPrimitive.Description>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {actions}
              <DialogPrimitive.Close asChild>
                <IconButton label="Close panel" icon={<X aria-hidden />} size="md" shortcut={['Esc']} />
              </DialogPrimitive.Close>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);

/** Alias matching the contract name. */
export const SidePanel = Drawer;
export const SidePanelContent = DrawerContent;
