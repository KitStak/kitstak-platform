/**
 * Code 128 B barcodes for build tickets (docs/programs/SPEC.md 3.12, 5.20). Pure: returns the bar
 * and space widths in modules, which the UI kit draws as SVG. A scanner reads the build key back.
 */

/**
 * Widths (bar, space, bar, space, bar, space) of every Code 128 symbol value 0 to 105; 106 is the
 * stop symbol, which ends with a 2 module bar.
 */
const PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;
/** Quiet zone on each side, in modules. */
export const CODE128_QUIET_ZONE = 10;

/** The width pattern of a symbol value (exposed for tests and for drawing). */
export function code128Pattern(value: number): readonly number[] {
  const pattern = PATTERNS[value];
  if (pattern === undefined) throw new RangeError(`No Code 128 symbol ${value}`);
  return pattern.split('').map(Number);
}

/** True when every character can be written in Code 128 B (printable ASCII, space to `~`). */
export function canEncode128(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

/**
 * Encodes text as Code 128 B: start B, the characters, the check symbol and stop.
 * `bars` alternates bar and space widths starting with a bar. `checksum` is
 * `(104 + sum(position * value)) mod 103`.
 */
export function code128(text: string): { bars: readonly number[]; checksum: number } {
  if (!canEncode128(text)) throw new RangeError('Code 128 B takes printable characters only');
  const values: number[] = [];
  for (let i = 0; i < text.length; i += 1) values.push(text.charCodeAt(i) - 32);
  let sum = START_B;
  values.forEach((value, index) => {
    sum += value * (index + 1);
  });
  const checksum = sum % 103;
  const bars: number[] = [];
  for (const value of [START_B, ...values, checksum, STOP]) bars.push(...code128Pattern(value));
  return { bars, checksum };
}

/** Total width of a barcode in modules, without the quiet zones. */
export function code128Width(bars: readonly number[]): number {
  return bars.reduce((sum, width) => sum + width, 0);
}
