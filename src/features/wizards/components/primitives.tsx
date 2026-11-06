'use client';
/**
 * Small building blocks shared by every wizard: a dialog that asks before discarding edits,
 * an arrow-key radio group of option cards, and a choice chip group.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, TriangleAlert } from 'lucide-react';
import { Button, Dialog, cn } from '@/components/ui';

export interface GuardedDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** When true, Esc / overlay / close ask "Discard changes?" first. */
  readonly dirty: boolean;
  /** Block closing entirely (e.g. while a request is in flight). */
  readonly locked?: boolean;
  /** Render prop receives `requestClose`, which honours the dirty guard (for Cancel buttons). */
  readonly children: ReactNode | ((requestClose: () => void) => ReactNode);
}

/** Layers that own their Escape (select lists, menus, popovers, confirms): never close the wizard from them. */
const NESTED_LAYER = '[role="listbox"],[role="menu"],[data-radix-popper-content-wrapper],[role="alertdialog"]';

function isFocusTarget(node: Element | null | undefined): node is HTMLElement {
  return node instanceof HTMLElement && node.isConnected && node !== document.body && !node.hasAttribute('disabled');
}

/** Focus the element that opened the wizard, or the page's main region when it is gone. */
function restoreOpenerFocus(opener: Element | null) {
  if (isFocusTarget(opener) && !opener.closest('[role="dialog"]')) {
    opener.focus();
    return;
  }
  document.getElementById('main-content')?.focus({ preventScroll: true });
}

/**
 * Wizards pass this as DialogContent `onEscapeKeyDown`: Radix handles Escape in the capture
 * phase, before children can claim it, so GuardedDialog decides in the bubble phase instead.
 */
export function preventEscape(event: { preventDefault: () => void }) {
  event.preventDefault();
}

/**
 * A wizard dialog that asks before throwing work away. Escape is decided after children had a
 * chance to claim it (search clears, detail steps back) and never from an open select or menu.
 * Focus returns to the field after "Keep editing" and to the opener after the wizard closes.
 */
export function GuardedDialog({ open, onOpenChange, dirty, locked, children }: GuardedDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const [opener] = useState<Element | null>(() => (typeof document === 'undefined' ? null : document.activeElement));
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const requestClose = () => {
    if (locked || confirming) return;
    if (dirty) {
      const active = document.activeElement;
      setReturnFocus(isFocusTarget(active) && active.closest('[role="dialog"]') ? active : null);
      setConfirming(true);
      return;
    }
    onOpenChange(false);
  };
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  });

  useEffect(() => {
    if (!open) return;
    // A select/menu that already took one Escape is closing (it stays in the DOM for a frame
    // while focus returns); a second Escape aimed at it belongs to the wizard.
    const closingLayers = new WeakSet<Element>();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="alertdialog"]')) return;
      const layer = target?.closest(NESTED_LAYER);
      if (layer) {
        if (!closingLayers.has(layer)) {
          closingLayers.add(layer);
          return;
        }
      } else if (target && target !== document.body && !target.closest('[role="dialog"]')) {
        return;
      }
      requestCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return () => {
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body || !active.isConnected) restoreOpenerFocus(opener);
      });
    };
  }, [open, opener]);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) return onOpenChange(true);
          requestClose();
        }}
      >
        {typeof children === 'function' ? children(requestClose) : children}
      </Dialog>
      <DiscardConfirm
        open={confirming}
        onKeepEditing={() => setConfirming(false)}
        onDiscard={() => {
          setReturnFocus(null);
          setConfirming(false);
          onOpenChange(false);
        }}
        returnFocus={returnFocus}
      />
    </>
  );
}

/** Its own scrim above the wizard so the form behind is clearly dimmed, not peeking through. */
function DiscardConfirm({
  open,
  onKeepEditing,
  onDiscard,
  returnFocus,
}: {
  readonly open: boolean;
  readonly onKeepEditing: () => void;
  readonly onDiscard: () => void;
  readonly returnFocus: HTMLElement | null;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onKeepEditing()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-testid="discard-scrim"
          className="fixed inset-0 z-[calc(var(--z-modal)+10)] bg-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
        />
        <DialogPrimitive.Content
          role="alertdialog"
          data-testid="discard-confirm"
          className={cn(
            'fixed top-1/2 left-1/2 z-[calc(var(--z-modal)+11)] w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border-subtle bg-raised p-5 text-fg shadow-modal outline-none',
            'data-[state=closed]:animate-fade-out data-[state=open]:animate-dialog-in',
          )}
          onCloseAutoFocus={(event) => {
            const target = returnFocus;
            const fallback = document.querySelector<HTMLElement>(
              '[role="dialog"] input:not([disabled]), [role="dialog"] button:not([disabled])',
            );
            const next = target?.isConnected ? target : fallback;
            if (!next) return;
            event.preventDefault();
            next.focus();
          }}
        >
          <div className="flex gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-subtle text-danger-text">
              <TriangleAlert aria-hidden className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <DialogPrimitive.Title className="font-heading text-lg font-semibold text-fg">Discard changes?</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-base text-fg-secondary">
                What you entered here will be lost.
              </DialogPrimitive.Description>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" autoFocus>
                Keep editing
              </Button>
            </DialogPrimitive.Close>
            <Button variant="danger" onClick={onDiscard} data-testid="discard-confirm-button">
              Discard
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Roving-focus keyboard handling for a radiogroup of buttons (arrows, Home, End). */
export function useRovingRadio(count: number, onSelect: (index: number) => void, columns = 1) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const deltas: Record<string, number> = {
      ArrowDown: columns,
      ArrowUp: -columns,
      ArrowRight: 1,
      ArrowLeft: -1,
    };
    let next: number | null = null;
    if (event.key in deltas) next = (index + (deltas[event.key] ?? 0) + count) % count;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = count - 1;
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onSelect(next);
  };
  const register = (index: number) => (node: HTMLButtonElement | null) => {
    refs.current[index] = node;
  };
  return { onKeyDown, register };
}

export interface OptionCardItem<T extends string> {
  readonly value: T;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly badge?: ReactNode;
}

export interface OptionCardsProps<T extends string> {
  readonly label: string;
  readonly value: T | null;
  readonly onChange: (value: T) => void;
  readonly options: readonly OptionCardItem<T>[];
  readonly columns?: 1 | 2 | 3 | 4;
  readonly compact?: boolean;
  readonly className?: string;
  readonly testId?: string;
}

const GRID: Readonly<Record<1 | 2 | 3 | 4, string>> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
};

/** Selectable cards (radiogroup). Selected: primary border + tint + check. */
export function OptionCards<T extends string>({
  label,
  value,
  onChange,
  options,
  columns = 1,
  compact,
  className,
  testId,
}: OptionCardsProps<T>) {
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const visualColumns = typeof window !== 'undefined' && window.innerWidth < 640 ? (columns === 4 ? 2 : 1) : columns;
  const { onKeyDown, register } = useRovingRadio(
    options.length,
    (index) => {
      const option = options[index];
      if (option) onChange(option.value);
    },
    visualColumns,
  );
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId} className={cn('grid gap-2', GRID[columns], className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={register(index)}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === selectedIndex ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'group relative flex items-start gap-3 rounded-lg border text-left',
              'transition-[border-color,background-color,box-shadow,transform] duration-[var(--duration-fast)] ease-out',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-[0.99]',
              compact ? 'p-2.5' : 'p-3',
              selected
                ? 'border-primary bg-primary-subtle shadow-[0_0_0_1px_var(--primary)]'
                : 'border-border-default bg-raised hover:border-border-strong hover:bg-muted',
            )}
          >
            {option.icon ? <span className="mt-0.5 shrink-0">{option.icon}</span> : null}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-semibold text-fg">
                {option.title}
                {option.badge}
              </span>
              {option.description ? (
                <span className="mt-0.5 block text-sm text-fg-secondary">{option.description}</span>
              ) : null}
            </span>
            <span
              aria-hidden
              className={cn(
                'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-[var(--duration-fast)]',
                selected ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong',
              )}
            >
              {selected ? <Check strokeWidth={3.5} className="size-2.5" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface ChoiceChipsProps<T extends string> {
  readonly label: string;
  readonly options: readonly { readonly value: T; readonly label: string; readonly icon?: ReactNode }[];
  /** Single value (radio) or values (checkbox chips). */
  readonly value: T | readonly T[] | null;
  readonly onToggle: (value: T) => void;
  readonly multiple?: boolean;
  readonly size?: 'md' | 'lg';
  readonly testId?: string;
  readonly className?: string;
}

/** Rounded selectable chips. Single mode is a radiogroup with arrow keys; multiple uses checkboxes. */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onToggle,
  multiple,
  size = 'md',
  testId,
  className,
}: ChoiceChipsProps<T>) {
  const isSelected = (option: T) => (Array.isArray(value) ? value.includes(option) : value === option);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => isSelected(option.value)),
  );
  const { onKeyDown, register } = useRovingRadio(options.length, (index) => {
    const option = options[index];
    if (option && !multiple) onToggle(option.value);
  });
  return (
    <div
      role={multiple ? 'group' : 'radiogroup'}
      aria-label={label}
      data-testid={testId}
      className={cn('flex flex-wrap gap-2', className)}
    >
      {options.map((option, index) => {
        const selected = isSelected(option.value);
        return (
          <button
            key={option.value}
            ref={register(index)}
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={selected}
            tabIndex={multiple || index === selectedIndex ? 0 : -1}
            onClick={() => onToggle(option.value)}
            onKeyDown={multiple ? undefined : (event) => onKeyDown(event, index)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border font-medium',
              'transition-[background-color,border-color,color,transform] duration-[var(--duration-fast)] ease-out',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-[0.97]',
              size === 'lg' ? 'h-10 px-4 text-base' : 'h-8 px-3 text-sm',
              '[&_svg]:size-4',
              selected
                ? 'border-primary bg-primary-selected text-primary-text'
                : 'border-border-default bg-raised text-fg hover:border-border-strong hover:bg-muted',
            )}
          >
            {multiple && selected ? <Check aria-hidden strokeWidth={3} /> : option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function InlineError({ children, onRetry }: { readonly children: ReactNode; readonly onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger-text"
    >
      <span className="flex-1">{children}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
