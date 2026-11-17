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

/** Field rotation: N = as fed, R = a quarter turn clockwise (ZPL has no whole-label 90 degree turn). */
export type ZplRotation = 'N' | 'R';

/**
 * A landscape design on a label that is fed short edge first. Layout code works in design
 * coordinates (x right, y down); the frame maps them onto the fed label.
 */
export interface ZplFrame {
  readonly rotation: 'R';
  /** `^PW` of the fed label in dots (the design's height). */
  readonly printWidth: number;
}

/**
 * `^FO` origin for a field whose design box starts at (x, y) and is `height` dots tall.
 * Without a frame the design is the fed label. With one, the design's x axis runs down the
 * feed and its y axis runs from the right edge of the print head to the left, so the box's
 * upper-left corner on the fed label is (printWidth - y - height, x). Returns null when the
 * box would run past the bottom of the design (a negative origin is not valid ZPL).
 */
export function zplOrigin(
  frame: ZplFrame | undefined,
  x: number,
  y: number,
  height: number,
): readonly [number, number] | null {
  if (!frame) return [x, y];
  const fedX = frame.printWidth - y - height;
  return fedX < 0 ? null : [fedX, x];
}

/** QR version 1-10 capacity at error correction Q (what `^FDQA,` asks for). */
const QR_ALPHANUMERIC_CAPACITY = [16, 29, 47, 67, 87, 108, 125, 157, 189, 221] as const;
const QR_BYTE_CAPACITY = [11, 20, 32, 46, 60, 74, 86, 108, 130, 151] as const;
const QR_ALPHANUMERIC = /^[0-9A-Z $%*+\-./:]*$/;
const QR_TABLE_MAX_VERSION = 10;
const QR_MAX_VERSION = 40;
/** Rough extra bytes per QR version above the table (only used to reserve space). */
const QR_BYTES_PER_EXTRA_VERSION = 20;

/** Data Matrix ECC 200 square symbols: [modules per side, data codewords]. */
const DATA_MATRIX_SIZES: readonly (readonly [number, number])[] = [
  [10, 3],
  [12, 5],
  [14, 8],
  [16, 12],
  [18, 18],
  [20, 22],
  [22, 30],
  [24, 36],
  [26, 44],
  [32, 62],
  [36, 86],
  [40, 114],
  [44, 144],
  [48, 174],
  [52, 204],
  [64, 280],
  [72, 368],
  [80, 456],
  [88, 576],
  [96, 696],
  [104, 816],
  [120, 1050],
  [132, 1304],
  [144, 1558],
];
const DATA_MATRIX_LARGEST = 144;

/**
 * Side of a square 2D symbol in dots at `moduleDots` per module, or null when the size is not
 * predictable from the data (PDF417, 1D codes). Needed to place a symbol on a rotated label,
 * where a field is anchored by the edge nearest the bottom of the design.
 */
export function zplSymbolSize(symbology: string, value: string, moduleDots: number): number | null {
  const bytes = new TextEncoder().encode(value).length;
  if (symbology === 'qrcode') {
    const capacity = QR_ALPHANUMERIC.test(value) ? QR_ALPHANUMERIC_CAPACITY : QR_BYTE_CAPACITY;
    const index = capacity.findIndex((max) => bytes <= max);
    const overflow = bytes - (capacity.at(-1) ?? 0);
    const version =
      index >= 0
        ? index + 1
        : Math.min(QR_MAX_VERSION, QR_TABLE_MAX_VERSION + Math.ceil(overflow / QR_BYTES_PER_EXTRA_VERSION));
    return (17 + 4 * version) * moduleDots;
  }
  if (symbology === 'datamatrix') {
    // ASCII encodation: one codeword per character, one per pair of digits.
    const codewords = bytes - (value.match(/\d\d/g)?.length ?? 0);
    const modules = DATA_MATRIX_SIZES.find(([, max]) => codewords <= max)?.[0] ?? DATA_MATRIX_LARGEST;
    return modules * moduleDots;
  }
  return null;
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
  /** Landscape frame: x / y are design coordinates and the text is rotated to match. */
  readonly frame?: ZplFrame;
}

/** Text field, or '' when a framed field falls outside the label. */
export function zplText(field: ZplText): string {
  const h = field.height ?? 28;
  const wanted = field.blockWidth ? (field.maxLines ?? 1) : 1;
  // On a rotated label a block reserves all of its lines, so near the bottom of the design it
  // keeps only the lines that fit rather than being dropped.
  const lines = field.frame ? Math.min(wanted, Math.floor((field.frame.printWidth - field.y) / h)) : wanted;
  if (lines < 1) return '';
  const block = field.blockWidth ? `^FB${field.blockWidth},${lines},0,${field.align ?? 'L'},0` : '';
  // A rotated ^FB block is anchored by its full line count, with the first line rightmost.
  const origin = zplOrigin(field.frame, field.x, field.y, lines * h);
  if (!origin) return '';
  const rotation: ZplRotation = field.frame?.rotation ?? 'N';
  return `^FO${origin[0]},${origin[1]}^A0${rotation},${h},${h}${block}^FH\\^FD${zplField(field.text)}^FS`;
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

/** Box in design coordinates; with a frame its sides swap. '' when it falls outside the label. */
export function zplBox(
  x: number,
  y: number,
  width: number,
  height: number,
  thickness = 2,
  frame?: ZplFrame,
): string {
  const origin = zplOrigin(frame, x, y, height);
  if (!origin) return '';
  const [w, h] = frame ? [height, width] : [width, height];
  return `^FO${origin[0]},${origin[1]}^GB${w},${h},${thickness}^FS`;
}

/**
 * Wraps commands into one label (`^XA ... ^XZ`). Width (`^PW`) and length (`^LL`) describe the
 * label as it is fed, in dots: for a landscape design that is the design's height and width.
 */
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
