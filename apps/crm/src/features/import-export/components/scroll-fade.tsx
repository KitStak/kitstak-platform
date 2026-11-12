'use client';
/**
 * Horizontal scroll container with edge fades that appear only when there is more content in
 * that direction, so wide previews never read as clipped text.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui';

export interface ScrollFadeProps {
  readonly children: ReactNode;
  readonly className?: string;
  /** Accessible name for the scroll region (it is keyboard-focusable when it overflows). */
  readonly label: string;
  /** Called with whether the content overflows horizontally. */
  readonly onOverflowChange?: (overflowing: boolean) => void;
  readonly testId?: string;
  /** Width of a sticky first column: the start fade sits after it instead of over it. */
  readonly startInset?: number;
}

export function ScrollFade({ children, className, label, onOverflowChange, testId, startInset = 0 }: ScrollFadeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    const next = { start: node.scrollLeft > 1, end: node.scrollLeft < max - 1 };
    setEdges((current) => (current.start === next.start && current.end === next.end ? current : next));
    onOverflowChange?.(max > 1);
  }, [onOverflowChange]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);

  const overflowing = edges.start || edges.end;
  return (
    <div className={cn('relative min-w-0', className)}>
      <div
        ref={ref}
        onScroll={measure}
        role="region"
        aria-label={label}
        tabIndex={overflowing ? 0 : undefined}
        data-testid={testId}
        data-scrolled={edges.start ? 'true' : undefined}
        className="group/scroll overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
      >
        {children}
      </div>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 w-8 bg-linear-to-r from-panel to-transparent transition-opacity duration-[var(--duration-fast)] ease-out',
          edges.start ? 'opacity-100' : 'opacity-0',
        )}
        style={{ left: startInset }}
      />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-panel to-transparent transition-opacity duration-[var(--duration-fast)] ease-out',
          edges.end ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
