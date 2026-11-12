/**
 * Partial-shipment wording shared by the Ship order confirm/result (bulk + detail) and the
 * ship-preview API (critic r5: a Ready to Ship order with unpacked units ships what is packed and
 * becomes Partially Shipped, so the confirm must not promise "moves to Shipped & Canceled").
 */
export interface ShipLineFacts {
  readonly sku: string;
  readonly quantity: number;
  readonly cancelledQuantity: number;
  /** Units that ship on this Ship action: the line's Packed / Loaded allocations (what `shipOrders` consumes). */
  readonly packedQuantity: number;
  /** Units already shipped by an earlier (partial) shipment. */
  readonly shippedQuantity: number;
}

/** Units of a line that will still be unshipped after shipping what is packed. */
export function unshippedAfterShip(l: ShipLineFacts): number {
  const ordered = Math.max(0, l.quantity - l.cancelledQuantity);
  return Math.max(0, ordered - l.shippedQuantity - l.packedQuantity);
}

/**
 * "Partially shipped: 1 of 2 units of APX-TEE-WHT-M remain" (one clause per short line, "; "),
 * or null when every ordered unit is packed and the order ships in full.
 */
export function partialShipNote(lines: readonly ShipLineFacts[]): string | null {
  const parts = lines
    .map((l) => ({ l, left: unshippedAfterShip(l), ordered: Math.max(0, l.quantity - l.cancelledQuantity) }))
    .filter((x) => x.left > 0)
    .map(
      (x) =>
        `${x.left} of ${x.ordered} unit${x.ordered === 1 ? '' : 's'} of ${x.l.sku} remain${x.left === 1 ? 's' : ''}`,
    );
  return parts.length ? `Partially shipped: ${parts.join('; ')}` : null;
}
