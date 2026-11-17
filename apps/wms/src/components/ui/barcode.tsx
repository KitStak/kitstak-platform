'use client';

/**
 * Barcode (BUILD_PLAN F4.2) rendered to inline SVG with bwip-js. Supports any bwip-js
 * symbology; the common ones are typed. Invalid data shows a readable error instead
 * of throwing.
 */
import * as React from 'react';
import { toSVG } from 'bwip-js/browser';
import { cn } from '@/lib/utils';

export type BarcodeType =
  'code128' | 'code39' | 'ean13' | 'upca' | 'qrcode' | 'datamatrix' | 'gs1-128' | 'pdf417' | 'itf14';

export interface BarcodeProps {
  readonly value: string;
  readonly type?: BarcodeType;
  /** Bar height in mm (1D codes). Default 12. */
  readonly height?: number;
  /** Module width multiplier. Default 2. */
  readonly scale?: number;
  readonly showText?: boolean;
  readonly className?: string;
  readonly 'aria-label'?: string;
}

const TWO_D: ReadonlySet<BarcodeType> = new Set(['qrcode', 'datamatrix', 'pdf417']);

const VIEWBOX_RE = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/;

/**
 * bwip-js emits an SVG with a viewBox but no width/height, which collapses to 0x0 inside
 * an inline-block. Pure: copies the viewBox size onto the root `<svg>` as its intrinsic size.
 */
export function withIntrinsicSize(svg: string): string {
  const match = VIEWBOX_RE.exec(svg);
  if (!match || /<svg[^>]*\swidth=/.test(svg)) return svg;
  return svg.replace(/<svg/, `<svg width="${match[1]}" height="${match[2]}"`);
}

/**
 * Height / width of a symbol as bwip-js draws it with no padding or text (the proportions the
 * PDF renderer's barcode image has). Null when the value cannot be encoded. PURE.
 */
export function barcodeAspect(type: BarcodeType, value: string, heightMm: number): number | null {
  if (!value.trim()) return null;
  try {
    const svg = toSVG({
      bcid: type,
      text: value.trim(),
      scale: 3,
      ...(TWO_D.has(type) ? {} : { height: Math.max(4, heightMm) }),
      includetext: false,
    });
    const match = VIEWBOX_RE.exec(svg);
    const [width, height] = [Number(match?.[1]), Number(match?.[2])];
    return width > 0 && height > 0 ? height / width : null;
  } catch {
    return null;
  }
}

export function renderBarcodeSvg({
  value,
  type = 'code128',
  height = 12,
  scale = 2,
  showText = true,
}: Omit<BarcodeProps, 'className' | 'aria-label'>): {
  readonly svg: string | null;
  readonly error: string | null;
} {
  if (!value) return { svg: null, error: 'No value' };
  try {
    const svg = toSVG({
      bcid: type,
      text: value,
      scale,
      ...(TWO_D.has(type) ? {} : { height }),
      includetext: showText && !TWO_D.has(type),
      textxalign: 'center',
      textsize: 9,
      // Human-readable text sits below the bars with a quiet zone around the symbol (catalog REQ-9).
      textyoffset: 2,
      paddingwidth: 4,
      paddingheight: 2,
    });
    return { svg: withIntrinsicSize(svg), error: null };
  } catch (e) {
    return {
      svg: null,
      error: e instanceof Error ? e.message.replace(/^bwipp\.\w+#?\d*:\s*/, '') : 'Cannot encode this value',
    };
  }
}

export function Barcode({
  value,
  type = 'code128',
  height,
  scale,
  showText,
  className,
  'aria-label': ariaLabel,
}: BarcodeProps) {
  const result = React.useMemo(
    () => renderBarcodeSvg({ value, type, height, scale, showText }),
    [value, type, height, scale, showText],
  );
  if (!result.svg) {
    return (
      <span
        role="img"
        aria-label={`Barcode unavailable: ${result.error ?? ''}`}
        className={cn(
          'inline-flex items-center rounded border border-dashed border-danger/40 bg-danger-soft px-2 py-1 text-2xs text-danger',
          className,
        )}
      >
        Invalid barcode: {result.error}
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={ariaLabel ?? `${type} barcode ${value}`}
      className={cn('inline-block bg-white p-1 [&>svg]:h-auto [&>svg]:max-w-full', className)}
      // Safe: bwip-js generates the SVG markup from the encoded value; the text is escaped by the library.
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
}
