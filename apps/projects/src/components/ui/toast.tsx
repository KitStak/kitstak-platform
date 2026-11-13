'use client';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { Spinner } from './spinner';

export interface ToasterProps {
  readonly theme?: 'light' | 'dark' | 'system';
}

/** App-wide toaster, themed with KitStak tokens. Mount once (in Providers). */
export function Toaster({ theme = 'system' }: ToasterProps) {
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-left"
      offset={20}
      gap={8}
      visibleToasts={4}
      expand
      closeButton
      duration={6000}
      icons={{
        success: <CircleCheck aria-hidden className="size-[18px] text-success" />,
        error: <CircleAlert aria-hidden className="size-[18px] text-danger" />,
        warning: <TriangleAlert aria-hidden className="size-[18px] text-warning" />,
        info: <Info aria-hidden className="size-[18px] text-info" />,
        loading: <Spinner size="sm" label={null} className="text-primary" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'group pointer-events-auto flex w-[min(400px,calc(100vw-40px))] items-center gap-3 rounded-lg border border-border-subtle bg-raised py-3 pr-3 pl-4 text-base text-fg shadow-popover z-[var(--z-toast)]',
          title: 'font-medium',
          description: 'text-sm text-fg-secondary',
          content: 'flex min-w-0 flex-1 flex-col gap-0.5',
          icon: 'shrink-0 flex',
          actionButton:
            'shrink-0 rounded-sm px-2 h-7 text-sm font-semibold text-primary-text hover:bg-primary-subtle focus-visible:outline-2 focus-visible:outline-focus',
          cancelButton:
            'shrink-0 rounded-sm px-2 h-7 text-sm font-medium text-fg-secondary hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus',
          closeButton:
            '!static order-last !translate-none shrink-0 !size-6 !rounded-sm !border-0 !bg-transparent text-icon hover:!bg-hover',
        },
      }}
    />
  );
}

export interface UndoToastOptions {
  readonly description?: string;
  /** Invoked when the user clicks Undo. May be async; errors surface as an error toast. */
  readonly onUndo: () => void | Promise<void>;
  readonly undoLabel?: string;
  readonly duration?: number;
}

/** The most recent change that can be undone (Ctrl/Cmd+Z runs it, see `toast.undoLast`). */
let lastUndo: { readonly id: string | number; readonly run: () => void; readonly until: number } | null = null;

function runUndo(onUndo: () => void | Promise<void>): void {
  void Promise.resolve()
    .then(onUndo)
    .catch((error: unknown) => {
      sonnerToast.error("Couldn't undo", {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    });
}

/**
 * Typed toast API. `toast.undo('Board deleted', { onUndo })` shows the standard Undo action used
 * after destructive operations.
 */
export const toast = {
  success: (message: string, description?: string) => sonnerToast.success(message, { description }),
  error: (message: string, description?: string) => sonnerToast.error(message, { description }),
  info: (message: string, description?: string) => sonnerToast.info(message, { description }),
  warning: (message: string, description?: string) => sonnerToast.warning(message, { description }),
  loading: (message: string) => sonnerToast.loading(message),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  promise: sonnerToast.promise,
  undo: (message: string, { description, onUndo, undoLabel = 'Undo', duration = 8000 }: UndoToastOptions) => {
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      if (lastUndo?.id === id) lastUndo = null;
      runUndo(onUndo);
    };
    const id = sonnerToast(message, {
      description,
      duration,
      action: { label: undoLabel, onClick: once },
    });
    // Ctrl/Cmd+Z stays available for a while after the toast fades, like an editor's undo.
    lastUndo = { id, run: once, until: Date.now() + Math.max(duration, 60_000) };
    return id;
  },
  /** Undo the latest change that showed an Undo toast. False when there is nothing to undo. */
  undoLast: (): boolean => {
    const entry = lastUndo;
    if (!entry || entry.until < Date.now()) return false;
    lastUndo = null;
    sonnerToast.dismiss(entry.id);
    entry.run();
    return true;
  },
  /** Forget a pending undo (the change it would revert failed). */
  forgetUndo: (id: string | number) => {
    if (lastUndo?.id === id) lastUndo = null;
    sonnerToast.dismiss(id);
  },
} as const;
