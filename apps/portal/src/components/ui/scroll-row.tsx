'use client';
/**
 * A row that scrolls sideways when it does not fit (tabs, filter chips). An edge that hides more
 * fades out, so a cut word reads as "there is more this way", not as a broken layout. The fade
 * follows the scroll position: no fade at an edge with nothing beyond it. The current item
 * (`aria-current`) is scrolled into view when the row opens.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';

export interface ScrollRowProps {
  readonly children: ReactNode;
  /** Classes for the scrolling box (bleed margins, borders). */
  readonly className?: string;
  readonly 'aria-label'?: string;
  /** Render as a `nav` landmark. */
  readonly as?: 'nav' | 'div';
}

const FADE = 28;

export function ScrollRow({ children, className, as: Tag = 'div', ...rest }: ScrollRowProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [edges, setEdges] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const max = node.scrollWidth - node.clientWidth;
      const next = { left: node.scrollLeft > 2, right: node.scrollLeft < max - 2 };
      setEdges((current) => (current.left === next.left && current.right === next.right ? current : next));
    };
    const current = node.querySelector<HTMLElement>('[aria-current="page"]');
    if (current && node.scrollWidth > node.clientWidth) {
      const target = current.offsetLeft - (node.clientWidth - current.offsetWidth) / 2;
      node.scrollLeft = Math.max(0, target);
    }
    measure();
    node.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, []);

  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? 'transparent' : 'black'} 0, black ${edges.left ? FADE : 0}px, black calc(100% - ${edges.right ? FADE : 0}px), ${edges.right ? 'transparent' : 'black'} 100%)`
      : undefined;

  return (
    <Tag
      ref={ref as never}
      data-more-left={edges.left || undefined}
      data-more-right={edges.right || undefined}
      className={cn('overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
