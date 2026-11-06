'use client';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, X } from 'lucide-react';
import { cn } from './cn';
import { Button } from './button';
import { IconButton } from './icon-button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Readonly<Record<DialogSize, string>> = {
  sm: 'w-[min(420px,calc(100vw-32px))]',
  md: 'w-[min(560px,calc(100vw-32px))]',
  lg: 'w-[min(760px,calc(100vw-32px))]',
  xl: 'w-[min(1040px,calc(100vw-32px))]',
};

export const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-[var(--z-overlay)] bg-overlay backdrop-blur-[2px]',
        'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
        className,
      )}
      {...props}
    />
  );
});

export interface DialogContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  readonly size?: DialogSize;
  /** Hide the top-right close button (e.g. a blocking confirmation). */
  readonly hideClose?: boolean;
}

export const DialogContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  function DialogContent({ className, size = 'md', hideClose, children, ...props }, ref) {
    return (
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            'fixed top-1/2 left-1/2 z-[var(--z-modal)] flex max-h-[calc(100dvh-48px)] -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-2xl border border-border-subtle bg-raised text-fg shadow-modal outline-none',
            'data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
            SIZE_CLASS[size],
            className,
          )}
          {...props}
        >
          {children}
          {hideClose ? null : (
            <DialogPrimitive.Close asChild>
              <IconButton label="Close" icon={<X aria-hidden />} size="sm" className="absolute top-4 right-4" hideTooltip />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);

export function DialogHeader({
  title,
  description,
  icon,
  className,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn('flex gap-3 px-6 pt-6 pr-14 pb-4', className)}>
      {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
      <div className="min-w-0">
        <DialogPrimitive.Title className="font-heading text-xl font-semibold text-fg">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-base text-fg-secondary">{description}</DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</DialogPrimitive.Description>
        )}
      </div>
    </div>
  );
}

export function DialogBody({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 pb-2', className)}>{children}</div>;
}

export function DialogFooter({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <div className={cn('flex items-center justify-end gap-2 border-t border-border-subtle px-6 py-4', className)}>
      {children}
    </div>
  );
}

export interface WizardStep {
  readonly id: string;
  readonly title: string;
}

export interface WizardStepsProps {
  readonly steps: readonly WizardStep[];
  readonly current: number;
  readonly className?: string;
}

/** Horizontal stepper used at the top of wizard dialogs. */
export function WizardSteps({ steps, current, className }: WizardStepsProps) {
  return (
    <ol className={cn('flex items-center gap-2 px-6 pb-4', className)} aria-label="Progress">
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'upcoming';
        return (
          <li key={step.id} className="flex min-w-0 flex-1 items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span
              className={cn(
                'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-[var(--duration-normal)]',
                state === 'done' && 'bg-primary text-primary-fg',
                state === 'current' && 'bg-primary-selected text-primary-text ring-2 ring-primary',
                state === 'upcoming' && 'bg-muted text-fg-muted',
              )}
            >
              {state === 'done' ? <Check aria-hidden className="size-3.5" /> : index + 1}
            </span>
            <span
              className={cn('truncate text-sm', state === 'upcoming' ? 'text-fg-muted' : 'font-semibold text-fg')}
            >
              {step.title}
            </span>
            {index < steps.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  'h-0.5 min-w-4 flex-1 rounded-full transition-colors duration-[var(--duration-slow)]',
                  index < current ? 'bg-primary' : 'bg-border-subtle',
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export interface WizardFooterProps {
  readonly step: number;
  readonly totalSteps: number;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly onCancel?: () => void;
  readonly nextLabel?: string;
  readonly finishLabel?: string;
  readonly canProceed?: boolean;
  readonly loading?: boolean;
  /** Optional content on the left (e.g. "Skip setup"). */
  readonly aside?: ReactNode;
  /** Hide the step dots (when the dialog already shows a numbered stepper). */
  readonly hideDots?: boolean;
}

/** Footer for multi-step dialogs: step dots, Back / Next / Finish. */
export function WizardFooter({
  step,
  totalSteps,
  onBack,
  onNext,
  onCancel,
  nextLabel = 'Next',
  finishLabel = 'Finish',
  canProceed = true,
  loading,
  aside,
  hideDots,
}: WizardFooterProps) {
  const isLast = step >= totalSteps - 1;
  return (
    <DialogFooter className="justify-between">
      <div className="flex items-center gap-3">
        <span className={cn('flex gap-1.5', hideDots && 'hidden')} aria-label={`Step ${step + 1} of ${totalSteps}`} role="img">
          {Array.from({ length: totalSteps }, (_, index) => (
            <span
              key={index}
              className={cn(
                'h-1.5 rounded-full transition-all duration-[var(--duration-normal)]',
                index === step ? 'w-5 bg-primary' : index < step ? 'w-1.5 bg-primary/60' : 'w-1.5 bg-border-default',
              )}
            />
          ))}
        </span>
        {aside}
      </div>
      <div className="flex items-center gap-2">
        {step === 0 ? (
          onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null
        ) : (
          <Button variant="ghost" onClick={onBack} disabled={loading}>
            Back
          </Button>
        )}
        <Button onClick={onNext} disabled={!canProceed} loading={loading}>
          {isLast ? finishLabel : nextLabel}
        </Button>
      </div>
    </DialogFooter>
  );
}

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly loading?: boolean;
  readonly onConfirm: () => void;
}

/** Small confirmation modal. Destructive confirms are red and focus Cancel by default. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  loading,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" hideClose role="alertdialog">
        <DialogHeader title={title} description={description} />
        <DialogFooter className="border-t-0 pt-2">
          <DialogClose asChild>
            <Button variant="ghost" autoFocus={destructive}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
