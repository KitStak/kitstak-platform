/**
 * Work order Transactions tab (Logiwa "Inventory Transaction Summary" parity): sign each ledger
 * row by direction and label it by role. The ledger stores unsigned quantities with a From and/or
 * To location: From-only rows leave stock (consumed, −n red), To-only rows add stock (+n green),
 * and rows with both are moves (unsigned).
 */
export interface WoLedgerRow {
  readonly type: string;
  readonly qty: number;
  readonly productId: string;
  readonly fromLocationId: string | null;
  readonly toLocationId: string | null;
  /** Type of the receipt the ledger row belongs to (e.g. "Kitting", "DisassembleKit"). */
  readonly receiptType?: string | null;
}

export interface WoTxnView {
  readonly qty: number;
  readonly direction: 'in' | 'out' | 'move';
  readonly label: string;
}

export function woTxnView(row: WoLedgerRow, kitProductId: string): WoTxnView {
  const abs = Math.abs(row.qty);
  const direction: WoTxnView['direction'] =
    row.fromLocationId && row.toLocationId
      ? 'move'
      : row.fromLocationId
        ? 'out'
        : row.toLocationId
          ? 'in'
          : row.qty < 0
            ? 'out'
            : 'in';
  const qty = direction === 'out' ? -abs : abs;
  const isKit = row.productId === kitProductId;
  const disassembly = /disassembl/i.test(row.type) || /disassembl/i.test(row.receiptType ?? '');
  let label = row.type;
  // Allocation rows reserve stock in place (From = To): they are reservations, not moves.
  if (row.type === 'Allocation') label = 'Allocation (reserved)';
  else if (row.type === 'Allocation Cancel') label = 'Allocation (released)';
  else if (direction === 'move')
    label = /picking/i.test(row.type) ? 'Picking (to kitting area)' : `${row.type} (move)`;
  else if (disassembly) label = isKit ? 'Disassembly (kit consumed)' : 'Disassembly (component returned)';
  else if (isKit && direction === 'in') label = 'Kitting (kit output)';
  else if (!isKit && direction === 'out') label = 'Kitting (component consumed)';
  else if (isKit && direction === 'out') label = 'Disassembly (kit consumed)';
  // A component coming back in on a work order is only a disassembly return (ledger type
  // "Disassemble Kit" since round 6; older rows carry the generic "Receiving").
  else if (!isKit && direction === 'in') label = 'Disassembly (component returned)';
  return { qty, direction, label };
}
