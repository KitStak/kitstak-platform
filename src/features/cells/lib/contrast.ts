/**
 * WCAG 2.x contrast math. Pill text colors are tokens (`--label-<name>-fg`); the unit tests use
 * this module to prove every token pairing meets AA (≥ 4.5:1) in both themes, and `pickTextColor`
 * is the rule those tokens were derived from (white when it passes, otherwise ink).
 */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match || match[1] === undefined) return null;
  const body = match[1].length === 3 ? [...match[1]].map((char) => char + char).join('') : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(body.slice(offset, offset + 2), 16)) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** White text when it reaches `min` contrast on the background, otherwise the ink color. */
export function pickTextColor(background: string, ink = '#1f2533', min = 4.5): 'white' | 'ink' {
  return contrastRatio(background, '#ffffff') >= min ? 'white' : contrastRatio(background, ink) >= contrastRatio(background, '#ffffff') ? 'ink' : 'white';
}
