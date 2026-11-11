'use client';
import { forwardRef, useRef, type KeyboardEvent, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui';

export interface CellSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly testId: string;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** Runs before Esc / outside click closes the sheet; call preventDefault to keep it open. */
  readonly onDismiss?: (reason: 'escape' | 'outside', event: { preventDefault: () => void }) => void;
  readonly children: ReactNode;
}

/**
 * Narrow-screen cell editor: a bottom sheet instead of an anchored popover, so pickers never
 * flip above the cell and cover sticky headers / toolbars. The body scrolls; the sheet is capped
 * at 85% of the viewport so the board stays visible behind the scrim.
 */
export const CellSheet = forwardRef<HTMLDivElement, CellSheetProps>(function CellSheet(
  { open, onClose, title, testId, onKeyDown, onDismiss, children },
  ref,
) {
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-overlay/50 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          ref={ref}
          data-testid={testId}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // Keep the editor's own autofocus (search / date input). Never land on the Close button:
          // its tooltip would swallow the first Esc.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const body = bodyRef.current;
            if (!body || body.contains(document.activeElement)) return;
            const first = body.querySelector<HTMLElement>(
              'input:not([disabled]), [role="listbox"], textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
            );
            (first ?? body).focus({ preventScroll: true });
          }}
          onKeyDown={onKeyDown}
          onEscapeKeyDown={(event) => onDismiss?.('escape', event)}
          onInteractOutside={(event) => onDismiss?.('outside', event)}
          className="ks-cell-sheet ks-popover-surface fixed inset-x-0 bottom-0 z-[var(--z-popover)] flex max-h-[85dvh] flex-col rounded-t-xl rounded-b-none pb-[env(safe-area-inset-bottom)] outline-none"
        >
          <div className="flex flex-none items-center gap-2 border-b border-border-subtle py-1.5 pr-1.5 pl-4">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <IconButton label="Close" icon={<X aria-hidden />} size="md" />
            </DialogPrimitive.Close>
          </div>
          {/* The editor's own max-h-[inherit] layouts (timeline) resolve against this body. */}
          <div ref={bodyRef} tabIndex={-1} className="flex min-h-0 max-h-[calc(85dvh-48px)] flex-1 outline-none flex-col overflow-y-auto p-3 [&>*]:mx-auto [&>*]:!w-full [&>*]:!max-w-[420px]">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
});
