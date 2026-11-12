/**
 * ZPL II helpers for label printers (203 dpi). Field data is escaped with `^FH` hex
 * encoding so `^`, `~` and non-ASCII characters in user data can never inject commands.
 */

export const ZPL_DPI = 203;

/** Inches -> dots at 203 dpi. */
export const dots = (inches: number): number => Math.round(inches * ZPL_DPI);

/** Hex-escapes a field for use after `^FH\` (escape char `\`). */
export function zplField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value).replace(/[\r\n\t]+/g, ' ');
  const bytes = new TextEncoder().encode(text);
  return Array.from(bytes, (byte) => {
    const ch = String.fromCharCode(byte);
    const safe = byte >= 0x20 && byte <= 0x7e && ch !== '^' && ch !== '~' && ch !== '\\';
    return safe ? ch : `\\${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }).join('');
}

export interface ZplText {
  readonly x: number;
  readonly y: number;
  readonly text: unknown;
  /** Font height in dots. */
  readonly height?: number;
  /** Width of a wrapping block in dots (enables ^FB). */
  readonly blockWidth?: number;
  readonly maxLines?: number;
  readonly align?: 'L' | 'C' | 'R';
}

export function zplText(field: ZplText): string {
  const h = field.height ?? 28;
  const block = field.blockWidth
    ? `^FB${field.blockWidth},${field.maxLines ?? 1},0,${field.align ?? 'L'},0`
    : '';
  return `^FO${field.x},${field.y}^A0N,${h},${h}${block}^FH\\^FD${zplField(field.text)}^FS`;
}

export interface ZplBarcode {
  readonly x: number;
  readonly y: number;
  readonly value: string;
  readonly height?: number;
  /** Module width in dots (1-10). */
  readonly moduleWidth?: number;
  readonly humanReadable?: boolean;
}

/** Code 128 (auto subset). */
export function zplCode128(barcode: ZplBarcode): string {
  const hr = barcode.humanReadable === false ? 'N' : 'Y';
  return `^FO${barcode.x},${barcode.y}^BY${barcode.moduleWidth ?? 2}^BCN,${barcode.height ?? 100},${hr},N,N^FH\\^FD${zplField(barcode.value)}^FS`;
}

/** QR code, model 2. */
export function zplQr(barcode: Omit<ZplBarcode, 'height' | 'humanReadable'>): string {
  return `^FO${barcode.x},${barcode.y}^BQN,2,${barcode.moduleWidth ?? 5}^FH\\^FDQA,${zplField(barcode.value)}^FS`;
}

export function zplBox(x: number, y: number, width: number, height: number, thickness = 2): string {
  return `^FO${x},${y}^GB${width},${height},${thickness}^FS`;
}

/** Wraps commands into one label (`^XA ... ^XZ`) with print width/length in dots. */
export function zplLabel(
  widthDots: number,
  lengthDots: number,
  commands: readonly string[],
  copies = 1,
): string {
  return [
    '^XA',
    '^CI28',
    `^PW${widthDots}`,
    `^LL${lengthDots}`,
    '^LH0,0',
    ...commands,
    `^PQ${Math.max(1, Math.floor(copies))}`,
    '^XZ',
  ].join('\n');
}
