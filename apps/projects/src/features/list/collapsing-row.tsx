'use client';
/**
 * A single line of chips that never cuts a chip in half. Children that do not fit are hidden and
 * counted into a "+N" badge that sits right after the last chip shown (its tooltip names the
 * hidden ones). Used by List rows and Table cells for CRM/WMS chips and labels.
 */
import { Children, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui';

export interface CollapsingRowProps {
  readonly children: ReactNode;
  /** Plain names of the children, in order, for the "+N" tooltip. */
  readonly names: readonly string[];
  readonly className?: string;
}

/** Room kept for the "+N" badge when something is hidden. */
const BADGE_ROOM = 30;

export function CollapsingRow({ children, names, className }: CollapsingRowProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<{ hidden: number; left: number }>({ hidden: 0, left: 0 });
  const count = Children.count(children);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const items = (Array.from(element.children) as HTMLElement[]).filter((item) => !item.dataset.badge);
      const width = element.clientWidth;
      const fits = (item: HTMLElement, room: number) => item.offsetLeft + item.offsetWidth + room <= width + 0.5;
      const allFit = items.every((item) => fits(item, 0));
      let visible = items.length;
      if (!allFit) {
        visible = 0;
        while (visible < items.length && fits(items[visible] as HTMLElement, BADGE_ROOM)) visible += 1;
        // A lone chip may be cut (there is nothing to count). With several, a chip that does not fit
        // beside the badge is folded too, so the cell can read just "+3"; nothing ever overlaps.
        if (items.length === 1) visible = 1;
      }
      let left = 0;
      items.forEach((item, index) => {
        const show = index < visible;
        item.style.visibility = show ? '' : 'hidden';
        if (show) {
          item.removeAttribute('aria-hidden');
          item.removeAttribute('inert');
          left = item.offsetLeft + item.offsetWidth + 4;
        } else {
          item.setAttribute('aria-hidden', 'true');
          item.setAttribute('inert', '');
        }
      });
      const hidden = items.length - visible;
      if (hidden > 0) left = visible === 0 ? 0 : Math.min(left, Math.max(0, width - BADGE_ROOM + 2));
      setState((previous) => (previous.hidden === hidden && previous.left === left ? previous : { hidden, left }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count, names]);

  if (count === 0) return null;
  const hiddenNames = names.slice(names.length - state.hidden);
  return (
    <span className={cn('relative flex min-w-0', className)}>
      <span ref={ref} className="relative flex h-5 min-w-0 flex-1 items-center gap-1 overflow-hidden [&>*]:shrink-0 [&>*:first-child]:max-w-full">
        {children}
        {state.hidden > 0 ? (
          <span data-badge="1" title={hiddenNames.join(', ')} style={{ position: 'absolute', left: state.left }} className="top-0 rounded-full bg-muted px-1.5 text-2xs leading-5 whitespace-nowrap text-fg-secondary tabular-nums">
            +{state.hidden}
          </span>
        ) : null}
      </span>
    </span>
  );
}
