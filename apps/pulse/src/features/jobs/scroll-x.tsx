'use client';
/**
 * A wide table that scrolls sideways inside its card. When the content does not fit, the region
 * can be reached with the keyboard (Tab, then the arrow keys), is named for screen readers, and
 * shows a soft fade on the side that has more to see.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

export function ScrollX({
  label,
  children,
  className,
  testId,
}: {
  /** What the region holds, for screen readers: "Quote lines against actual, scrolls sideways". */
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const left = node.scrollLeft > 1;
    const right = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
    setMore((previous) => (previous.left === left && previous.right === right ? previous : { left, right }));
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

  const scrolls = more.left || more.right;
  return (
    <div className={cn('relative', className)}>
      <div
        ref={ref}
        onScroll={measure}
        data-testid={testId}
        data-scrolls={scrolls ? 'true' : undefined}
        className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        {...(scrolls ? { tabIndex: 0, role: 'region', 'aria-label': `${label}, scrolls sideways` } : {})}
      >
        {children}
      </div>
      <span
        aria-hidden
        data-testid={testId ? `${testId}-fade-left` : undefined}
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-panel to-transparent transition-opacity duration-150',
          more.left ? 'opacity-100' : 'opacity-0',
        )}
      />
      <span
        aria-hidden
        data-testid={testId ? `${testId}-fade-right` : undefined}
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-panel to-transparent transition-opacity duration-150',
          more.right ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
