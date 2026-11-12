/**
 * Receiving-scoped ledger (`/receiving/transactions`): the full Transaction History grid
 * (every ledger column, typed filters, saved views, Export As Excel) opened pre-filtered to
 * the receiving transaction types. Links from the receipt drawer, the PO detail and the
 * Receiving History header build their URL here, so the filters (PO, SKU, user, type) are
 * real grid filters the user can see, change and clear.
 */
import { serializeGridQuery, type GridFilter } from '@/server/query/grid-query';

/** Ledger types a receipt writes or reverses. */
export const RECEIVING_TXN_TYPES = [
  'Receiving',
  'Cancel Receiving',
  'Return Receiving',
  'Kitting',
  'Disassemble Kit',
] as const;
export type ReceivingTxnType = (typeof RECEIVING_TXN_TYPES)[number];

export const RECEIVING_LEDGER_PATH = '/receiving/transactions';

/** Default chip when the page opens with no filters. */
export const RECEIVING_LEDGER_DEFAULT_QUERY = serializeGridQuery({
  filters: [{ field: 'type', op: 'in', values: [...RECEIVING_TXN_TYPES] }],
});

export interface ReceivingLedgerScope {
  readonly poCode?: string | null;
  readonly sku?: string | null;
  readonly user?: string | null;
  readonly types?: readonly string[];
}

/** URL of the receiving ledger with the given filters (types default to every receiving type). */
export function receivingLedgerHref(scope: ReceivingLedgerScope = {}): string {
  const filters: GridFilter[] = [
    {
      field: 'type',
      op: 'in',
      values: [...(scope.types && scope.types.length > 0 ? scope.types : RECEIVING_TXN_TYPES)],
    },
  ];
  if (scope.poCode) filters.push({ field: 'poCode', op: 'eq', value: scope.poCode });
  if (scope.sku) filters.push({ field: 'sku', op: 'eq', value: scope.sku });
  if (scope.user) filters.push({ field: 'user', op: 'eq', value: scope.user });
  // Newest first, so the receipt just posted (or cancelled) is the first row.
  const qs = serializeGridQuery({ filters, sort: [{ field: 'at', dir: 'desc' }] });
  return `${RECEIVING_LEDGER_PATH}?${qs}`;
}
