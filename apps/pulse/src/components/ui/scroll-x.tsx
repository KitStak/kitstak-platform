'use client';
/**
 * A wide block (most often a table) that scrolls sideways inside its card. When the content does
 * not fit, the region can be reached with the keyboard (Tab, then the arrow keys), is named for
 * screen readers, and shows a soft fade on the side that has more to see.
 *
 * `Table` from `@/components/ui` wraps itself in this, so every table in the app gets the same
 * treatment without asking. Use it by hand around anything else that scrolls sideways.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';

export function ScrollX({
  label,
  children,
  className,
  scrollerClassName,
  testId,
}: {
  /** What the region holds, for screen readers: "Quote lines against actual". */
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
  /** Extra classes for the scrolling box itself, like a max height for a list that also scrolls down. */
  readonly scrollerClassName?: string;
  readonly testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<{ left: boolean; right: boolean; down: boolean; insetLeft: number; insetRight: number }>({
    left: false,
    right: false,
    down: false,
    insetLeft: 0,
    insetRight: 0,
  });

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const left = node.scrollLeft > 1;
    const right = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
    const down = node.scrollHeight > node.clientHeight + 1;
    // Columns pinned to an edge stay readable: the fade sits beside them, never over them.
    const head = node.querySelector('thead tr');
    const pinnedWidth = (side: 'left' | 'right'): number =>
      head
        ? [...head.children].reduce((total, cell) => {
            const style = getComputedStyle(cell);
            return style.position === 'sticky' && style[side] !== 'auto' ? total + cell.getBoundingClientRect().width : total;
          }, 0)
        : 0;
    const insetLeft = Math.round(pinnedWidth('left'));
    const insetRight = Math.round(pinnedWidth('right'));
    setMore((previous) =>
      previous.left === left && previous.right === right && previous.down === down && previous.insetLeft === insetLeft && previous.insetRight === insetRight
        ? previous
        : { left, right, down, insetLeft, insetRight },
    );
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);

  const sideways = more.left || more.right;
  const scrolls = sideways || more.down;
  return (
    <div className={cn('relative min-w-0', className)}>
      <div
        ref={ref}
        onScroll={measure}
        data-testid={testId}
        data-scroll-x=""
        data-scrolls={sideways ? 'true' : undefined}
        className={cn(
          // Positioned, so screen reader only text inside a cell (position: absolute) is clipped with its
          // cell and cannot stretch the page sideways.
          'relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus print:overflow-visible',
          scrollerClassName,
        )}
        {...(scrolls
          ? { tabIndex: 0, role: 'region', 'aria-label': sideways ? `${label}, scrolls sideways` : `${label}, scrolls` }
          : {})}
      >
        {children}
      </div>
      <span
        aria-hidden
        data-testid={testId ? `${testId}-fade-left` : undefined}
        style={{ left: more.insetLeft }}
        className={cn(
          'pointer-events-none absolute inset-y-0 z-[2] w-10 bg-gradient-to-r from-panel to-transparent transition-opacity duration-150 print:hidden',
          more.left ? 'opacity-100' : 'opacity-0',
        )}
      />
      <span
        aria-hidden
        data-scroll-fade="right"
        data-testid={testId ? `${testId}-fade-right` : undefined}
        style={{ right: more.insetRight }}
        className={cn(
          'pointer-events-none absolute inset-y-0 z-[2] w-10 bg-gradient-to-l from-panel to-transparent transition-opacity duration-150 print:hidden',
          more.right ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
