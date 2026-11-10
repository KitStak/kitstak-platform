/**
 * Width that fits an uppercase 11px header label plus the sort and info icons on one line,
 * so a long label ("TOTAL AVAILABLE INVENTORY QUANTITY") never runs into the next column's icon.
 */
export function headerWidth(label: string): number {
  return Math.max(140, Math.ceil(label.length * 7.6) + 64);
}
