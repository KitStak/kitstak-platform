'use client';
/**
 * Code 128 barcode as crisp SVG bars (build tickets, scan sheets). The bars come from the engine
 * (`code128`), so a printed ticket and the scanner input read the same text.
 */
import { CODE128_QUIET_ZONE, canEncode128, code128, code128Width } from '@kitstak/programs-engine';
import { cn } from '@/components/ui';

export interface BarcodeProps {
  readonly value: string;
  /** Bar height in px. */
  readonly height?: number;
  /** Width of the narrowest bar in px. */
  readonly module?: number;
  /** Print the text under the bars. */
  readonly showText?: boolean;
  readonly className?: string;
}

export function Barcode({ value, height = 48, module = 1.5, showText = true, className }: BarcodeProps) {
  if (!canEncode128(value)) {
    return <span className={cn('font-key text-xs text-fg-muted', className)}>{value || 'No code'}</span>;
  }
  const { bars } = code128(value);
  const modules = code128Width(bars) + CODE128_QUIET_ZONE * 2;
  const width = modules * module;
  const rects: { x: number; w: number }[] = [];
  let x = CODE128_QUIET_ZONE;
  bars.forEach((w, index) => {
    if (index % 2 === 0) rects.push({ x, w });
    x += w;
  });
  return (
    <figure className={cn('inline-flex flex-col items-center gap-1', className)} data-testid="barcode">
      <svg role="img" aria-label={`Barcode ${value}`} width={width} height={height} viewBox={`0 0 ${modules} ${height}`} preserveAspectRatio="none" shapeRendering="crispEdges">
        <rect x={0} y={0} width={modules} height={height} fill="#ffffff" />
        {rects.map((rect) => (
          <rect key={rect.x} x={rect.x} y={0} width={rect.w} height={height} fill="#000000" />
        ))}
      </svg>
      {showText ? <figcaption className="font-key text-xs tracking-[0.08em] text-fg">{value}</figcaption> : null}
    </figure>
  );
}
