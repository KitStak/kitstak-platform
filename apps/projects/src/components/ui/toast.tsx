'use client';
import { useEffect, useState } from 'react';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { answerViewOnly } from '@kitstak/ui/view-only';
import { Spinner } from './spinner';

export interface ToasterProps {
  readonly theme?: 'light' | 'dark' | 'system';
}

const EDGE = 20;

/**
 * Left edge of the page content (`#main-content`), so toasts sit over the content and never over
 * the sidebar, and stay clear of the task drawer on the right. Follows sidebar collapse and resizes.
 */
function useContentLeft(): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const measure = () => {
      const main = document.getElementById('main-content');
      setLeft(main ? Math.max(0, Math.round(main.getBoundingClientRect().left)) : 0);
    };
    measure();
    const main = document.getElementById('main-content');
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (main && observer) observer.observe(main);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return left;
}

/** App-wide toaster, themed with KitStak tokens. Mount once (in Providers). */
export function Toaster({ theme = 'system' }: ToasterProps) {
  const contentLeft = useContentLeft();
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-left"
      offset={{ bottom: EDGE, left: contentLeft + EDGE }}
      mobileOffset={{ bottom: 12, left: 12, right: 12 }}
      gap={8}
      visibleToasts={3}
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

export interface ToastOptions {
  /**
   * Stable id. A new toast with the same id replaces the one on screen instead of stacking on it,
   * e.g. `task:OPS-23` so "Added OPS-23" turns into "Marked OPS-23 done · Undo".
   */
  readonly id?: string | number;
}

/** Toast id for messages about one task: later toasts about the same task replace earlier ones. */
export const taskToastId = (taskKey: string): string => `task:${taskKey}`;

export interface UndoToastOptions extends ToastOptions {
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
  // Replacing a toast in place (same id) drops its Undo button: sonner merges the old fields in.
  success: (message: string, description?: string, options?: ToastOptions) =>
    sonnerToast.success(message, { description, id: options?.id, action: undefined, icon: undefined }),
  /**
   * With an id this replaces that toast in place, e.g. an optimistic "OPS-6 is due today · Undo"
   * becomes "Couldn't save your change": one toast, no Undo for a change that never happened.
   */
  error: (message: string, description?: string, options?: ToastOptions) => {
    if (options?.id !== undefined && lastUndo?.id === options.id) lastUndo = null;
    // A change the server refused because the plan is view only is answered by the view only
    // dialog (the banner's words and its button), not by a toast with other words (SPEC 9.4).
    if (answerViewOnly(message, description)) {
      if (options?.id !== undefined) sonnerToast.dismiss(options.id);
      return options?.id ?? '';
    }
    return sonnerToast.error(message, { description, id: options?.id, action: undefined, icon: undefined });
  },
  info: (message: string, description?: string, options?: ToastOptions) =>
    sonnerToast.info(message, { description, id: options?.id }),
  warning: (message: string, description?: string, options?: ToastOptions) =>
    sonnerToast.warning(message, { description, id: options?.id }),
  loading: (message: string) => sonnerToast.loading(message),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  promise: sonnerToast.promise,
  undo: (message: string, { id: wantedId, description, onUndo, undoLabel = 'Undo', duration = 8000 }: UndoToastOptions) => {
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      if (lastUndo?.id === id) lastUndo = null;
      runUndo(onUndo);
    };
    const id = sonnerToast(message, {
      id: wantedId,
      description,
      duration,
      // Replacing a success toast in place: drop its check icon so the row reads as a fresh message.
      icon: null,
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
