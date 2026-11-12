import { describe, expect, it } from 'vitest';
import { RECEIVING_TYPES } from '@/lib/enums';
import { receivingTypeLabel } from '@/lib/grid-defs/receiving/receiving-types';
import {
  RECEIVING_LEDGER_DEFAULT_QUERY,
  RECEIVING_TXN_TYPES,
  receivingLedgerHref,
} from '@/lib/grid-defs/receiving/receiving-ledger';
import {
  addSerial,
  EMPTY_DRAFT,
  matchLine,
  rfReceiveBody,
  rfReceiveIssue,
  type RfLine,
} from '@/lib/grid-defs/receiving/rf-receive';
import { parseGridQuery } from '@/server/query/grid-query';

describe('receiving type labels', () => {
  it('reads every stored type as a human label', () => {
    expect(receivingTypeLabel('DisassembleKit')).toBe('Disassemble kit');
    expect(receivingTypeLabel('Add Inventory')).toBe('Add inventory');
    expect(receivingTypeLabel('Product Receive')).toBe('Product receive');
    expect(receivingTypeLabel('Purchase Order')).toBe('Purchase order');
    expect(receivingTypeLabel('Kitting')).toBe('Kitting');
    expect(receivingTypeLabel('Return')).toBe('Return');
    for (const t of RECEIVING_TYPES) expect(receivingTypeLabel(t)).not.toMatch(/[a-z][A-Z]/);
  });
  it('splits unknown camel case and handles empty', () => {
    expect(receivingTypeLabel('CrossDockReceive')).toBe('Cross dock receive');
    expect(receivingTypeLabel(null)).toBe('—');
  });
});

describe('receiving ledger links', () => {
  it('default query filters to the receiving transaction types', () => {
    const q = parseGridQuery(new URLSearchParams(RECEIVING_LEDGER_DEFAULT_QUERY)).query;
    expect(q.filters).toEqual([{ field: 'type', op: 'in', values: [...RECEIVING_TXN_TYPES] }]);
    expect(RECEIVING_TXN_TYPES).toContain('Cancel Receiving');
  });
  it('adds PO, SKU and user as real filters, newest first', () => {
    const href = receivingLedgerHref({
      poCode: 'PO-1, X',
      sku: 'SKU-1',
      user: 'Mike',
      types: ['Cancel Receiving'],
    });
    expect(href.startsWith('/receiving/transactions?')).toBe(true);
    const parsed = parseGridQuery(new URLSearchParams(href.split('?')[1]));
    expect(parsed.issues).toEqual([]);
    expect(parsed.query.filters).toEqual([
      { field: 'type', op: 'in', values: ['Cancel Receiving'] },
      { field: 'poCode', op: 'eq', value: 'PO-1, X' },
      { field: 'sku', op: 'eq', value: 'SKU-1' },
      { field: 'user', op: 'eq', value: 'Mike' },
    ]);
    expect(parsed.query.sort).toEqual([{ field: 'at', dir: 'desc' }]);
  });
});

const line = (over: Partial<RfLine> = {}): RfLine => ({
  id: 'l1',
  sku: 'MUG',
  barcode: '841',
  orderedQuantity: 5,
  receivedQuantity: 1,
  uomQuantity: 1,
  tracking: { lot: false, expiry: false, production: false, serial: false },
  ...over,
});

describe('RF receive rules', () => {
  it('matches by barcode, then SKU, preferring an open line', () => {
    const done = line({ id: 'done', receivedQuantity: 5 });
    const open = line({ id: 'open' });
    expect(matchLine([done, open], ' 841 ')?.id).toBe('open');
    expect(matchLine([done, open], 'mug')?.id).toBe('open');
    expect(matchLine([done], 'MUG')?.id).toBe('done');
    expect(matchLine([open], 'nope')).toBeNull();
  });
  it('blocks Confirm with the first missing field', () => {
    const tracked = line({ tracking: { lot: true, expiry: true, production: false, serial: false } });
    expect(rfReceiveIssue(tracked, EMPTY_DRAFT)).toMatch(/lot tracked/);
    expect(rfReceiveIssue(tracked, { ...EMPTY_DRAFT, lotNumber: 'L1' })).toMatch(/expiry/);
    expect(rfReceiveIssue(tracked, { ...EMPTY_DRAFT, lotNumber: 'L1', expiryDate: '2027-01-01' })).toMatch(
      /location/,
    );
    expect(rfReceiveIssue(line(), { ...EMPTY_DRAFT, locationId: 'loc', quantity: 0 })).toMatch(/quantity/);
    expect(rfReceiveIssue(line(), { ...EMPTY_DRAFT, locationId: 'loc', lpMode: 'existing' })).toMatch(/LP/);
    expect(rfReceiveIssue(line(), { ...EMPTY_DRAFT, locationId: 'loc', quantity: 5 })).toMatch(
      /over-receipt/,
    );
    expect(
      rfReceiveIssue(line(), { ...EMPTY_DRAFT, locationId: 'loc', quantity: 5, allowOverReceipt: true }),
    ).toBeNull();
    expect(rfReceiveIssue(line(), { ...EMPTY_DRAFT, locationId: 'loc', quantity: 4 })).toBeNull();
  });
  it('needs one serial per unit and refuses duplicates', () => {
    const s = line({
      uomQuantity: 2,
      tracking: { lot: false, expiry: false, production: false, serial: true },
    });
    expect(rfReceiveIssue(s, { ...EMPTY_DRAFT, locationId: 'x', serials: ['A'] })).toBe(
      'Scan 2 serial numbers (1 scanned).',
    );
    expect(addSerial(['A'], 'a').error).toBe('a is already scanned.');
    expect(addSerial(['A'], 'B').serials).toEqual(['A', 'B']);
  });
  it('builds the receive body for one line', () => {
    const body = rfReceiveBody(
      line(),
      { ...EMPTY_DRAFT, quantity: 2, locationId: 'loc', lotNumber: ' ' },
      { version: 3, fromSuggestion: true, suggestQty: 2 },
    );
    expect(body).toMatchObject({
      version: 3,
      allowOverReceipt: false,
      lines: [
        {
          lineId: 'l1',
          quantity: 2,
          locationId: 'loc',
          lpMode: 'none',
          lpId: null,
          lotNumber: null,
          fromSuggestion: true,
          suggestBasis: { qty: 2 },
        },
      ],
    });
  });
});
