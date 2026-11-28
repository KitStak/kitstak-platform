/**
 * One test per row of the posting table (docs/ledger/SPEC.md 4.4). Each asserts the entry
 * balances to the cent and that the right accounts take the right sides.
 */
import { describe, expect, it } from 'vitest';
import { lineTax, mulQuantityPrice } from '@/lib/money';
import {
  accrualPosted,
  accrualReversed,
  assertBalanced,
  billApproved,
  billPaymentRecorded,
  closedMonthMessage,
  creditApplied,
  creditNoteIssued,
  depositMade,
  entryTotals,
  expensePosted,
  invoiceSent,
  manualEntry,
  openBillImported,
  openInvoiceImported,
  openingBalances,
  paymentReceived,
  payrollImported,
  PostingError,
  refundPaid,
  reimbursementApproved,
  reimbursementPaid,
  reversalOf,
  transferMade,
  vendorCreditApproved,
  writeOffPosted,
  type AccountRef,
  type EntryDraft,
  type PostingLine,
} from './posting-rules';

const B = (value: number | string): bigint => BigInt(value);
const CUSTOMER = 'cust-harbor';
const VENDOR = 'vend-ridgeway';
const ACC = { storage: 'acc-4100', kitting: 'acc-4000', extras: 'acc-4400', credits: 'acc-4900', packaging: 'acc-5200', rent: 'acc-6000', checking: 'acc-1000', card: 'acc-2100', fee: 'acc-6800' };

const name = (ref: AccountRef): string => ('key' in ref ? ref.key : ref.id);

/** `{ account: net }` with debits positive, so a test reads like the spec's Dr and Cr lists. */
function sides(entry: EntryDraft): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const line of entry.lines) out[name(line.account)] = (out[name(line.account)] ?? B(0)) + line.debit - line.credit;
  return out;
}

function expectBalanced(entry: EntryDraft): void {
  expect(() => assertBalanced(entry)).not.toThrow();
  const totals = entryTotals(entry.lines);
  expect(totals.debit).toBe(totals.credit);
  expect(entry.lines.length).toBeGreaterThanOrEqual(2);
  for (const line of entry.lines) expect(line.debit === B(0) || line.credit === B(0)).toBe(true);
}

/** The seed's INV-1042 (4.2 worked example): storage, kit assembly and taxable labels at 8.25%. */
function inv1042() {
  const storage = mulQuantityPrice('412', '18.5000');
  const kitting = mulQuantityPrice('3000', '2.7500');
  const labels = mulQuantityPrice('3000', '0.0350');
  const labelsTax = lineTax(labels, 82500);
  return {
    id: 'inv-1042',
    customerId: CUSTOMER,
    date: '2026-10-31',
    totalCents: storage + kitting + labels + labelsTax,
    lines: [
      { accountId: ACC.storage, amountCents: storage, taxCents: B(0) },
      { accountId: ACC.kitting, amountCents: kitting, taxCents: B(0) },
      { accountId: ACC.extras, amountCents: labels, taxCents: labelsTax, taxRateId: 'tax-austin' },
    ],
  };
}

describe('the INV-1042 worked example (4.2, 4.4)', () => {
  it('stamps the line amounts and the 866 cents of tax', () => {
    const doc = inv1042();
    expect(doc.lines.map((line) => line.amountCents)).toEqual([B(762200), B(825000), B(10500)]);
    expect(doc.lines[2]!.taxCents).toBe(B(866));
    expect(doc.totalCents).toBe(B(1598566));
  });

  it('invoice sent: Dr 1100 1598566; Cr 4100, 4000, 4400 and 2200', () => {
    const entry = invoiceSent(inv1042());
    expectBalanced(entry);
    expect(entry.sourceType).toBe('invoice');
    expect(sides(entry)).toEqual({ ar: B(1598566), [ACC.storage]: B(-762200), [ACC.kitting]: B(-825000), [ACC.extras]: B(-10500), sales_tax: B(-866) });
    expect(entry.lines.find((line) => name(line.account) === 'ar')).toMatchObject({ customerId: CUSTOMER, invoiceId: 'inv-1042' });
    expect(entry.lines.find((line) => name(line.account) === 'sales_tax')).toMatchObject({ taxRateId: 'tax-austin' });
  });

  it('a payment of 800000 to undeposited: Dr 1050, Cr 1100, leaving 798566 due', () => {
    const entry = paymentReceived({ id: 'pmt-1', customerId: CUSTOMER, date: '2026-11-10', amountCents: B(800000), applications: [{ invoiceId: 'inv-1042', amountCents: B(800000) }] });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ undeposited: B(800000), ar: B(-800000) });
    expect(B(1598566) - B(800000)).toBe(B(798566));
  });
});

describe('every posting rule balances (4.4)', () => {
  it('a negative invoice line (a discount) debits its account', () => {
    const entry = invoiceSent({ id: 'inv-2', customerId: CUSTOMER, date: '2026-11-01', totalCents: B(9000), lines: [
      { accountId: ACC.kitting, amountCents: B(10000), taxCents: B(0) },
      { accountId: ACC.credits, amountCents: B(-1000), taxCents: B(0) },
    ] });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ ar: B(9000), [ACC.kitting]: B(-10000), [ACC.credits]: B(1000) });
  });

  it('a tax rate with its own account credits that account', () => {
    const entry = invoiceSent({ id: 'inv-3', customerId: CUSTOMER, date: '2026-11-01', totalCents: B(10825), lines: [
      { accountId: ACC.extras, amountCents: B(10000), taxCents: B(825), taxRateId: 't1', taxAccountId: 'acc-2210' },
    ] });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ ar: B(10825), [ACC.extras]: B(-10000), 'acc-2210': B(-825) });
  });

  it('invoice changed while open: reverse, then post again', () => {
    const first = invoiceSent(inv1042());
    const reversal = reversalOf({ id: 'je-1', sourceType: first.sourceType, sourceId: first.sourceId, entryDate: first.entryDate, lines: first.lines });
    expectBalanced(reversal);
    expect(reversal.reversesEntryId).toBe('je-1');
    expect(reversal.entryDate).toBe(first.entryDate);
    const net = { ...sides(first) };
    for (const [account, value] of Object.entries(sides(reversal))) net[account] = (net[account] ?? B(0)) + value;
    expect(Object.values(net).every((value) => value === B(0))).toBe(true);
  });

  it('invoice voided: a reversing entry on the issue date', () => {
    const sent = invoiceSent(inv1042());
    const voided = reversalOf({ id: 'je-2', sourceType: 'invoice', sourceId: 'inv-1042', entryDate: sent.entryDate, lines: sent.lines });
    expectBalanced(voided);
    expect(sides(voided).ar).toBe(B(-1598566));
  });

  it('credit note issued: Dr revenue and sales tax; Cr AR', () => {
    const entry = creditNoteIssued({ id: 'cn-1', customerId: CUSTOMER, date: '2026-11-05', totalCents: B(10866), lines: [{ accountId: ACC.extras, amountCents: B(10000), taxCents: B(866), taxRateId: 't1' }] });
    expectBalanced(entry);
    expect(entry.sourceType).toBe('credit_note');
    expect(sides(entry)).toEqual({ [ACC.extras]: B(10000), sales_tax: B(866), ar: B(-10866) });
  });

  it('payment received with an unapplied part: the rest goes to customer credits', () => {
    const entry = paymentReceived({ id: 'pmt-2', customerId: CUSTOMER, date: '2026-11-10', amountCents: B(50000), applications: [{ invoiceId: 'a', amountCents: B(30000) }, { invoiceId: 'b', amountCents: B(5000) }] });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ undeposited: B(50000), ar: B(-35000), customer_credit: B(-15000) });
  });

  it('payment deposited straight to the bank debits the bank', () => {
    const entry = paymentReceived({ id: 'pmt-3', customerId: CUSTOMER, date: '2026-11-10', amountCents: B(1000), applications: [], depositTo: { id: ACC.checking } });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ [ACC.checking]: B(1000), customer_credit: B(-1000) });
  });

  it('refuses applications above the payment', () => {
    expect(() => paymentReceived({ id: 'x', customerId: CUSTOMER, date: '2026-11-10', amountCents: B(100), applications: [{ invoiceId: 'a', amountCents: B(101) }] })).toThrow(PostingError);
  });

  it('unapplied credit applied later: Dr customer credits; Cr AR', () => {
    const entry = creditApplied({ id: 'app-1', customerId: CUSTOMER, invoiceId: 'inv-9', date: '2026-11-20', amountCents: B(15000) });
    expectBalanced(entry);
    expect(entry.sourceType).toBe('application');
    expect(sides(entry)).toEqual({ customer_credit: B(15000), ar: B(-15000) });
  });

  it('refund of a customer credit: Dr customer credits; Cr bank', () => {
    const entry = refundPaid({ id: 'ref-1', customerId: CUSTOMER, date: '2026-11-21', amountCents: B(2500), bank: { key: 'default_bank' } });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ customer_credit: B(2500), default_bank: B(-2500) });
  });

  it('deposit with a card fee: Dr bank the net and the fee; Cr undeposited the payments', () => {
    const entry = depositMade({ id: 'dep-1', date: '2026-11-12', bank: { id: ACC.checking }, paymentsCents: B(800000), fees: [{ account: { key: 'bank_fees' }, cents: B(2320) }] });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ [ACC.checking]: B(797680), bank_fees: B(2320), undeposited: B(-800000) });
  });

  it('write off: Dr bad debt; Cr AR', () => {
    const entry = writeOffPosted({ id: 'wo-1', invoiceId: 'inv-7', customerId: CUSTOMER, date: '2026-11-25', amountCents: B(64000) });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ bad_debt: B(64000), ar: B(-64000) });
  });

  const bill = { id: 'bill-1', vendorId: VENDOR, date: '2026-11-03', totalCents: B(250000), lines: [{ accountId: ACC.packaging, amountCents: B(180000), pulseJobId: 'job-1' }, { accountId: ACC.rent, amountCents: B(70000) }] };

  it('bill approved: Dr each line; Cr bills to pay', () => {
    const entry = billApproved(bill);
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ [ACC.packaging]: B(180000), [ACC.rent]: B(70000), ap: B(-250000) });
    expect(entry.lines.find((line) => name(line.account) === 'ap')).toMatchObject({ vendorId: VENDOR, billId: 'bill-1' });
    expect(entry.lines.find((line) => name(line.account) === ACC.packaging)?.pulseJobId).toBe('job-1');
  });

  it('bill voided: a reversing entry on the bill date', () => {
    const approved = billApproved(bill);
    const voided = reversalOf({ id: 'je-b', sourceType: 'bill', sourceId: 'bill-1', entryDate: approved.entryDate, lines: approved.lines });
    expectBalanced(voided);
    expect(sides(voided).ap).toBe(B(250000));
  });

  it('vendor credit approved: Dr bills to pay; Cr each line', () => {
    const entry = vendorCreditApproved({ ...bill, id: 'vc-1', totalCents: B(18000), lines: [{ accountId: ACC.packaging, amountCents: B(18000) }] });
    expectBalanced(entry);
    expect(entry.sourceType).toBe('vendor_credit');
    expect(sides(entry)).toEqual({ ap: B(18000), [ACC.packaging]: B(-18000) });
  });

  it('bill payment: Dr bills to pay per bill; Cr bank or card', () => {
    const entry = billPaymentRecorded({ id: 'bp-1', vendorId: VENDOR, date: '2026-11-15', from: { id: ACC.checking }, bills: [{ billId: 'bill-1', amountCents: B(250000) }, { billId: 'bill-2', amountCents: B(1000) }] });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ ap: B(251000), [ACC.checking]: B(-251000) });
  });

  it('expense on a card: Dr each line; Cr the card', () => {
    const entry = expensePosted({ id: 'exp-1', date: '2026-11-04', paidFrom: { id: ACC.card }, lines: [{ accountId: ACC.packaging, amountCents: B(4599), pulseJobId: 'job-2' }, { accountId: ACC.rent, amountCents: B(1000) }] });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ [ACC.packaging]: B(4599), [ACC.rent]: B(1000), [ACC.card]: B(-5599) });
  });

  it('expense from the bank: Cr the bank', () => {
    const entry = expensePosted({ id: 'exp-2', date: '2026-11-04', paidFrom: { key: 'default_bank' }, lines: [{ accountId: ACC.fee, amountCents: B(1500) }] });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ [ACC.fee]: B(1500), default_bank: B(-1500) });
  });

  it('reimbursement approved: Dr each line; Cr owed to people', () => {
    const entry = reimbursementApproved({ id: 'exp-3', date: '2026-11-06', lines: [{ accountId: ACC.packaging, amountCents: B(3200) }] });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ [ACC.packaging]: B(3200), reimbursements: B(-3200) });
  });

  it('reimbursement paid: Dr owed to people; Cr bank', () => {
    const entry = reimbursementPaid({ id: 'rp-1', date: '2026-11-08', amountCents: B(3200), bank: { key: 'default_bank' } });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ reimbursements: B(3200), default_bank: B(-3200) });
  });

  it('transfer, paying the card: Dr the card; Cr checking', () => {
    const entry = transferMade({ id: 'tr-1', date: '2026-11-28', from: { id: ACC.checking }, to: { id: ACC.card }, amountCents: B(120000) });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ [ACC.card]: B(120000), [ACC.checking]: B(-120000) });
  });

  it('month end accrual (the Apex example, 4.10): Dr 1150 350000; Cr 4950; reverses Nov 1', () => {
    const earned = B(1250000);
    const billed = B(900000);
    const entry = accrualPosted({ id: 'acr-1', monthEnd: '2026-10-31', totalCents: earned - billed });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ unbilled: B(350000), accrued_revenue: B(-350000) });
    expect(entry.autoReverseOn).toBe('2026-11-01');
  });

  it('accrual reversal on the first day of the next month: Dr 4950; Cr 1150', () => {
    const entry = accrualReversed({ id: 'acr-1', monthEnd: '2026-12-31', totalCents: B(350000), reversesEntryId: 'je-acr' });
    expectBalanced(entry);
    expect(entry.entryDate).toBe('2027-01-01');
    expect(sides(entry)).toEqual({ accrued_revenue: B(350000), unbilled: B(-350000) });
  });

  it('refuses a negative accrual (billed ahead of the work is never booked)', () => {
    expect(() => accrualPosted({ id: 'x', monthEnd: '2026-10-31', totalCents: B(-1) })).toThrow(PostingError);
  });

  it('manual journal entry: as typed, balanced', () => {
    const entry = manualEntry({ date: '2026-11-30', memo: 'Depreciation', lines: [
      { account: { id: 'acc-6200' }, debitCents: B(41667), creditCents: B(0) },
      { account: { id: 'acc-1510' }, debitCents: B(0), creditCents: B(41667) },
    ] });
    expectBalanced(entry);
    expect(entry.sourceType).toBe('manual');
  });

  it('refuses an unbalanced manual entry', () => {
    expect(() => manualEntry({ date: '2026-11-30', lines: [
      { account: { id: 'a' }, debitCents: B(100), creditCents: B(0) },
      { account: { id: 'b' }, debitCents: B(0), creditCents: B(99) },
    ] })).toThrow(/does not balance/);
  });

  it('opening balances: the difference goes to Opening balances (3900)', () => {
    const entry = openingBalances({ id: 'open-1', openingDate: '2026-07-30', lines: [
      { account: { key: 'default_bank' }, debitCents: B(4210000), creditCents: B(0) },
      { account: { key: 'default_card' }, debitCents: B(0), creditCents: B(310000) },
    ] });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ default_bank: B(4210000), default_card: B(-310000), opening_equity: B(-3900000) });
  });

  it('open invoice imported: Dr AR; Cr Opening balances', () => {
    const entry = openInvoiceImported({ invoiceId: 'inv-old', customerId: CUSTOMER, openingDate: '2026-07-30', balanceCents: B(55000) });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ ar: B(55000), opening_equity: B(-55000) });
  });

  it('open bill imported: Dr Opening balances; Cr bills to pay', () => {
    const entry = openBillImported({ billId: 'bill-old', vendorId: VENDOR, openingDate: '2026-07-30', balanceCents: B(22000) });
    expectBalanced(entry);
    expect(sides(entry)).toEqual({ opening_equity: B(22000), ap: B(-22000) });
  });

  it('payroll journal imported: as in the file, balanced', () => {
    const entry = payrollImported({ id: 'pay-1', date: '2026-11-15', lines: [
      { account: { id: 'acc-5000' }, debitCents: B(1840000), creditCents: B(0) },
      { account: { id: 'acc-6410' }, debitCents: B(140760), creditCents: B(0) },
      { account: { key: 'payroll' }, debitCents: B(0), creditCents: B(1980760) },
    ] });
    expectBalanced(entry);
    expect(entry.sourceType).toBe('payroll');
  });
});

describe('the rules the database enforces again', () => {
  const line = (debit: number, credit: number): PostingLine => ({ account: { key: 'ar' }, debit: B(debit), credit: B(credit) });

  it('an entry needs two or more lines', () => {
    expect(() => assertBalanced({ sourceType: 'manual', sourceId: null, entryDate: '2026-11-01', lines: [line(1, 0)] })).toThrow(/two or more/);
  });

  it('a line is a debit or a credit, never both and never zero', () => {
    expect(() => assertBalanced({ sourceType: 'manual', sourceId: null, entryDate: '2026-11-01', lines: [line(1, 1), line(0, 0)] })).toThrow(PostingError);
  });

  it('drops zero lines, so an invoice with no tax has no tax line', () => {
    const entry = invoiceSent({ id: 'i', customerId: CUSTOMER, date: '2026-11-01', totalCents: B(100), lines: [{ accountId: ACC.kitting, amountCents: B(100), taxCents: B(0) }] });
    expect(entry.lines).toHaveLength(2);
  });

  it('says a closed month in the house words', () => {
    expect(closedMonthMessage('2026-10')).toBe('October 2026 is closed. Date it in November, or ask the owner to reopen October.');
    expect(closedMonthMessage('2026-12')).toBe('December 2026 is closed. Date it in January, or ask the owner to reopen December.');
  });
});
