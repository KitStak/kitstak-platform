'use client';
/**
 * Task drawer: slides in from the right over any page whenever the URL has `?task=OPS-42`
 * (shareable, back-button friendly). Mounted once by the shell (`<TaskDrawerHost />`, also
 * exported as `TaskDrawerProvider`). Open it from anywhere with `useTaskDrawer().open(keyOrId)`.
 *
 * Non-modal like CRM's item card: the page behind stays usable, clicking another task card or
 * row swaps the drawer in place, clicking empty page space closes it. Resizable (drag the left
 * edge or use ←/→ on it; width remembered), Esc closes (first Esc leaves a text field),
 * ↑/↓ or j/k move to the previous / next task in the view.
 */
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { isEditableTarget } from '@/lib/hooks/use-hotkeys';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { TaskDetailView } from './task-detail';
import { TASK_PANEL_ATTR } from './task-nav';
import { useTaskPrefetch } from './prefetch-task';

const DEFAULT_WIDTH = 760;
const MIN_WIDTH = 480;
const MAX_WIDTH = 1280;
const KEY_STEP = 32;
const GUTTER = 64;
const STORAGE_KEY = 'kitstak.projects.taskPanel.width';

/** Clicks on these (outside the panel) never close it. */
const KEEP_OPEN_SELECTOR =
  '[data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"], [data-sonner-toaster], [data-sonner-toast], [data-task-keep-open]';

function clampWidth(width: number): number {
  const viewport = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const max = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewport - GUTTER));
  return Math.round(Math.min(max, Math.max(MIN_WIDTH, Number.isFinite(width) ? width : DEFAULT_WIDTH)));
}

function readWidth(): number {
  try {
    const raw = Number(window.localStorage.getItem(STORAGE_KEY));
    return raw ? raw : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function storeWidth(width: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Width isn't remembered when storage is unavailable.
  }
}

function TaskDrawerInner() {
  const router = useRouter();
  const { taskKey, closeTask, hrefFor } = useTaskDrawer();
  // Hovering a task row or card warms its detail so the drawer paints at once.
  useTaskPrefetch();
  // The panel only renders in the browser (Radix portal), so reading storage here is safe.
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_WIDTH : clampWidth(readWidth()),
  );
  const [dragging, setDragging] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // Keep showing the last task while the panel animates closed.
  const [shownKey, setShownKey] = useState<string | null>(taskKey);
  if (taskKey && taskKey !== shownKey) setShownKey(taskKey);

  useEffect(() => {
    const onResize = () => setWidth((current) => clampWidth(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (
      taskKey &&
      !returnFocus.current &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
    ) {
      returnFocus.current = document.activeElement;
    }
  }, [taskKey]);

  const openInPlace = useCallback(
    (key: string, options?: { replace?: boolean }) => {
      const href = hrefFor(key);
      if (options?.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [hrefFor, router],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setWidth(clampWidth(window.innerWidth - event.clientX));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    storeWidth(width);
  };
  const onHandleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const next = clampWidth(width + (event.key === 'ArrowLeft' ? KEY_STEP : -KEY_STEP));
    setWidth(next);
    storeWidth(next);
  };

  return (
    <DialogPrimitive.Root
      open={Boolean(taskKey)}
      onOpenChange={(open) => (open ? undefined : closeTask())}
      modal={false}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={contentRef}
          {...{ [TASK_PANEL_ATTR]: '' }}
          data-testid="task-drawer"
          data-resizing={dragging ? 'true' : undefined}
          aria-describedby={undefined}
          tabIndex={-1}
          style={{ width: `min(${width}px, 100vw)` }}
          onOpenAutoFocus={(event) => {
            // Focus the panel itself: Esc, ↑/↓ and j/k work right away, no tooltip pops.
            event.preventDefault();
            contentRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            // URL-driven: no Trigger to return to, so restore focus to what opened it.
            event.preventDefault();
            const target = returnFocus.current;
            returnFocus.current = null;
            if (target && document.contains(target)) target.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={(event) => {
            const active = document.activeElement;
            if (active && contentRef.current?.contains(active) && isEditableTarget(active)) {
              // First Esc leaves the text field (the field saves on blur).
              event.preventDefault();
              (active as HTMLElement).blur();
              contentRef.current?.focus({ preventScroll: true });
              return;
            }
            if (
              active &&
              !contentRef.current?.contains(active) &&
              active !== document.body &&
              isEditableTarget(active)
            ) {
              // Typing on the page behind (e.g. a board search box): Esc belongs to it.
              event.preventDefault();
            }
          }}
          onFocusOutside={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => {
            const target = event.target as Element | null;
            if (!target?.closest) return;
            // Popovers, menus, dialogs and toasts (Undo!) live in portals outside the panel.
            if (target.closest(KEEP_OPEN_SELECTOR)) {
              event.preventDefault();
              return;
            }
            // Clicking another task in the view swaps the drawer instead of closing it.
            if (target.closest('[data-task-key]')) event.preventDefault();
          }}
          className="ks-task-panel fixed top-0 right-0 bottom-0 z-[var(--z-modal)] flex flex-col border-l border-border-subtle bg-raised text-fg shadow-modal outline-none data-[state=closed]:animate-slide-out-right data-[state=open]:animate-slide-in-right"
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            aria-valuemin={MIN_WIDTH}
            aria-valuemax={MAX_WIDTH}
            aria-valuenow={Math.round(width)}
            tabIndex={0}
            data-dragging={dragging ? 'true' : undefined}
            className="ks-task-resize hidden sm:block"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => {
              const next = clampWidth(DEFAULT_WIDTH);
              setWidth(next);
              storeWidth(next);
            }}
            onKeyDown={onHandleKey}
          />
          {shownKey ? (
            <>
              <DialogPrimitive.Title className="sr-only">Task {shownKey}</DialogPrimitive.Title>
              <TaskDetailView
                key={shownKey}
                taskRef={shownKey}
                variant="drawer"
                onDeleted={closeTask}
                onClose={closeTask}
                onOpenTask={openInPlace}
              />
            </>
          ) : (
            <DialogPrimitive.Title className="sr-only">Task</DialogPrimitive.Title>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Mounted once by the shell: renders the task drawer whenever the URL has `?task=OPS-42`. */
export function TaskDrawerHost() {
  return (
    <Suspense fallback={null}>
      <TaskDrawerInner />
    </Suspense>
  );
}

/** Alias: the shell-level provider that makes `useTaskDrawer().open()` work everywhere. */
export const TaskDrawerProvider = TaskDrawerHost;
