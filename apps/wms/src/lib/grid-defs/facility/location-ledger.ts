/**
 * Location ledger rules (M10, PURE). Critic R5: the Ledger history tab took direction from the
 * from/to location only, so a negative adjustment into a location read "In -2", and allocation
 * reservations were counted as stock movements.
 */

/** Transaction types that reserve or release stock without moving it. */
export const RESERVATION_TXN_TYPES: readonly string[] = ['Allocation', 'Allocation Cancel'];

export const LEDGER_KINDS = ['movements', 'reservations', 'all'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export type LedgerDirection = 'In' | 'Out' | 'Within';

export interface LedgerEffect {
  readonly direction: LedgerDirection;
  /** Units, always positive; read together with `direction`. */
  readonly qty: number;
  /** Signed change to this location's on-hand (0 for Within). */
  readonly delta: number;
}

/**
 * Direction and quantity for one transaction, seen from one location. A signed quantity wins over
 * the from/to pair: an adjustment of −2 recorded "into" the location is Out 2, never "In −2".
 */
export function ledgerEffect(fromHere: boolean, toHere: boolean, uomQty: number): LedgerEffect {
  if (fromHere && toHere) return { direction: 'Within', qty: Math.abs(uomQty), delta: 0 };
  const delta = toHere ? uomQty : -uomQty;
  if (delta === 0) return { direction: 'Within', qty: 0, delta: 0 };
  return { direction: delta > 0 ? 'In' : 'Out', qty: Math.abs(delta), delta };
}

export const isReservation = (type: string): boolean => RESERVATION_TXN_TYPES.includes(type);

/** Empty-state copy per ledger filter. */
export function ledgerEmptyCopy(kind: LedgerKind): { readonly title: string; readonly description: string } {
  if (kind === 'reservations')
    return {
      title: 'No reservations',
      description: 'Allocations that reserve stock in this location without moving it are listed here.',
    };
  return {
    title: 'No stock movements yet',
    description: 'Every receipt, transfer, pick and adjustment touching this location is listed here.',
  };
}
