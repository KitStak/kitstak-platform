'use client';
import { forwardRef, useRef, useState, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
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

/** What a dialog remembers about the control that opened it, to find it again on close. */
export interface Opener {
  readonly element: HTMLElement;
  readonly id: string;
  readonly testId: string | null;
  /** The first word of its name ("Delete"), to find a control of the same kind nearby. */
  readonly verb: string | null;
  /** The button of the menu the opener sat in: a menu row is gone once the menu closes. */
  readonly menuButton: HTMLElement | null;
  /** The opener's parents, nearest first, for when the opener itself is gone (its row was deleted). */
  readonly parents: readonly HTMLElement[];
}

const TABBABLE =
  'a[href], button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** On screen, enabled and not inside something hidden from the keyboard. */
function usable(element: HTMLElement | null | undefined): element is HTMLElement {
  if (!element || !element.isConnected) return false;
  if (element.matches(':disabled') || element.closest('[inert], [aria-hidden="true"]')) return false;
  return element.getClientRects().length > 0;
}

export function rememberOpener(active: Element | null): Opener | null {
  if (!(active instanceof HTMLElement) || active === document.body || active.id === 'main-content') return null;
  const menu = active.closest('[role="menu"]');
  const menuButtonId = menu?.getAttribute('aria-labelledby');
  const parents: HTMLElement[] = [];
  for (let node = active.parentElement; node && node !== document.body; node = node.parentElement) parents.push(node);
  return {
    element: active,
    id: active.id,
    testId: active.getAttribute('data-testid'),
    verb: (active.getAttribute('aria-label') ?? active.textContent ?? '').trim().split(/\s+/)[0]?.toLowerCase() || null,
    menuButton: menuButtonId ? document.getElementById(menuButtonId) : null,
    parents,
  };
}

/**
 * Where keyboard focus goes when a dialog closes: the control that opened it, or the same control
 * drawn again (same id or test id), or the menu button it came from. When it is gone for good (the
 * row it sat on was deleted), the first control left in its nearest parent that is still on the
 * page, and at the end the page content itself.
 */
export function returnFocusTarget(opener: Opener | null): HTMLElement | null {
  if (!opener) return null;
  if (usable(opener.element)) return opener.element;
  const byId = opener.id ? document.getElementById(opener.id) : null;
  if (usable(byId)) return byId;
  if (opener.testId) {
    const same = [...document.querySelectorAll<HTMLElement>(`[data-testid="${CSS.escape(opener.testId)}"]`)].find(usable);
    if (same) return same;
  }
  if (usable(opener.menuButton)) return opener.menuButton;
  // The same kind of control on the next row: "work-delete-2026-11-12" finds "work-delete-2026-11-11".
  const family = opener.testId?.replace(/-(\d{4}-\d{2}-\d{2}|[0-9a-f-]{8,}|\d+)$/i, '') ?? null;
  const sameKind = (element: HTMLElement): boolean =>
    family !== null && family !== opener.testId
      ? (element.getAttribute('data-testid') ?? '').startsWith(`${family}-`)
      : opener.verb !== null && (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().toLowerCase().startsWith(opener.verb);
  for (const parent of opener.parents) {
    if (!parent.isConnected) continue;
    if (parent.id === 'main-content') return parent;
    const inside = [...parent.querySelectorAll<HTMLElement>(TABBABLE)].filter(usable);
    const near = inside.find(sameKind) ?? inside[0];
    if (near) return near;
  }
  return document.getElementById('main-content');
}

/** Renders nothing. Its first render runs before React moves focus to an `autoFocus` field inside. */
function OpenerProbe({ onFirstRender }: { readonly onFirstRender: () => void }) {
  useState(onFirstRender);
  return null;
}

/**
 * Keyboard focus goes back to the control that opened a dialog or panel when it closes, by Escape,
 * Cancel, the Close button or a save. Radix only does this for a `DialogTrigger`, and only when
 * nothing inside took focus first: most dialogs here open from state and have an `autoFocus`
 * field, and focus fell to the top of the page. The opener is read while the dialog first renders,
 * before any field inside is focused. Spread `onOpenAutoFocus` and `onCloseAutoFocus` onto the
 * Radix content and render `probe` inside it.
 */
export function useReturnFocus(handlers: { onOpenAutoFocus?: (event: Event) => void; onCloseAutoFocus?: (event: Event) => void } = {}) {
  const opener = useRef<Opener | null>(null);
  return {
    probe: (
      <OpenerProbe
        onFirstRender={() => {
          if (typeof document !== 'undefined') opener.current = rememberOpener(document.activeElement);
        }}
      />
    ),
    onOpenAutoFocus: (event: Event) => {
      handlers.onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      handlers.onCloseAutoFocus?.(event);
      const remembered = opener.current;
      opener.current = null;
      if (event.defaultPrevented) return;
      const target = returnFocusTarget(remembered);
      if (!target) return;
      event.preventDefault();
      target.focus({ preventScroll: target.id === 'main-content' });
    },
  };
}

export interface DialogContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  readonly size?: DialogSize;
  /** Hide the top-right close button (e.g. a blocking confirmation). */
  readonly hideClose?: boolean;
}

export const DialogContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  function DialogContent({ className, size = 'md', hideClose, children, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) {
    const { probe, ...focus } = useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus });
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
          {...focus}
        >
          {probe}
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
        <DialogPrimitive.Title className="text-xl font-semibold text-fg">{title}</DialogPrimitive.Title>
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
