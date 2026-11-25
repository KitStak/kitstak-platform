'use client';
/** Modal dialog on Radix Dialog, styled to the KitStak tokens. Traps focus and returns it on close. */
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { cn } from './cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Hide the corner close button (for steps that must end with a clear choice). */
  readonly hideClose?: boolean;
  readonly size?: 'sm' | 'md' | 'lg';
}

const SIZE: Readonly<Record<NonNullable<DialogContentProps['size']>, string>> = {
  sm: 'sm:max-w-[420px]',
  md: 'sm:max-w-[520px]',
  lg: 'sm:max-w-[640px]',
};

export const DialogContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  function DialogContent({ className, children, hideClose = false, size = 'md', ...props }, ref) {
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in motion-reduce:animate-none" />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            // A bottom sheet on phones, a centered card from 640 px up.
            'fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-border-default bg-raised p-5 shadow-modal',
            'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6',
            'data-[state=open]:animate-fade-in motion-reduce:animate-none focus:outline-none',
            SIZE[size],
            className,
          )}
          {...props}
        >
          {children}
          {hideClose ? null : (
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute top-3 right-3 inline-flex size-9 items-center justify-center rounded-md text-icon hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <X aria-hidden className="size-4" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('pr-8 text-lg font-semibold tracking-[-0.01em] text-fg focus:outline-none', className)}
      {...props}
    />
  );
});

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn('mt-1 text-sm text-fg-secondary', className)} {...props} />;
});

export function DialogFooter({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <div className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}>{children}</div>
  );
}
