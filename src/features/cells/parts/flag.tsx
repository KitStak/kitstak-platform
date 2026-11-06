'use client';
import { useId, type ReactNode } from 'react';
import { cn } from '@/components/ui';
import { FLAG_SHAPES, type FlagShape } from '../lib/flag-shapes';

function renderShape(shape: FlagShape, key: number): ReactNode {
  switch (shape.t) {
    case 'rect':
      return <rect key={key} x={shape.x} y={shape.y} width={shape.w} height={shape.h} fill={shape.c} />;
    case 'circle':
      return <circle key={key} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.c} />;
    case 'poly':
      return <polygon key={key} points={shape.p} fill={shape.c} />;
    case 'line':
      return <path key={key} d={shape.d} stroke={shape.c} strokeWidth={shape.w} fill="none" />;
    case 'nest':
      return (
        <svg key={key} x={shape.x} y={shape.y} width={shape.w} height={shape.h} viewBox="0 0 20 15" preserveAspectRatio="none" overflow="hidden">
          {shape.shapes.map(renderShape)}
        </svg>
      );
    default:
      return null;
  }
}

/**
 * Country flag as inline SVG (20×15, 2px radius, 1px inset hairline) so it looks the same on
 * every OS. Unknown codes fall back to a neutral tile with the ISO code.
 */
export function Flag({ code, className }: { readonly code: string; readonly className?: string }) {
  const clipId = useId();
  const upper = code.toUpperCase();
  const shapes = FLAG_SHAPES[upper];
  if (!shapes) {
    return (
      <span
        aria-hidden
        className={cn(
          'inline-flex h-[15px] w-5 shrink-0 items-center justify-center rounded-[2px] bg-muted text-[8px] font-bold tracking-tight text-fg-secondary shadow-[inset_0_0_0_1px_var(--border-default)]',
          className,
        )}
      >
        {upper}
      </span>
    );
  }
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 15"
      width={20}
      height={15}
      data-flag={upper}
      className={cn('inline-block h-[15px] w-5 shrink-0', className)}
    >
      <defs>
        <clipPath id={clipId}>
          <rect width={20} height={15} rx={2} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>{shapes.map(renderShape)}</g>
      <rect x={0.5} y={0.5} width={19} height={14} rx={1.5} fill="none" stroke="var(--flag-hairline, rgb(0 0 0 / 0.14))" strokeWidth={1} />
    </svg>
  );
}
