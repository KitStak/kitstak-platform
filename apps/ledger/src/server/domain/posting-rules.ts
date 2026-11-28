/**
 * The posting rules of docs/ledger/SPEC.md 4.4, as pure functions. Each builder turns one
 * document event into one balanced entry draft (accounts named by id or by system key). Nothing
 * here touches the database: `posting.ts` is the one writer, and it refuses any draft that does
 * not balance before it reaches the database trigger that refuses it again at commit.
 *
 * Amounts are whole cents in `bigint`. A line amount may be negative (a credit line or a
 * discount): it then lands on the other side of its account, so every journal line stays positive.
 * Zero lines are dropped.
 */
import type { JournalSourceType, SystemKey } from '@/lib/ledger-enums';

const ZERO = BigInt(0);

export type AccountRef = { readonly key: SystemKey } | { readonly id: string };

export interface LineTags {
  readonly customerId?: string | null;
  readonly vendorId?: string | null;
  readonly invoiceId?: string | null;
  readonly billId?: string | null;
  readonly pulseJobId?: string | null;
  readonly taxRateId?: string | null;
  readonly memo?: string | null;
}

export interface PostingLine extends LineTags {
  readonly account: AccountRef;
  readonly debit: bigint;
  readonly credit: bigint;
}

export interface EntryDraft {
  readonly sourceType: JournalSourceType;
  readonly sourceId: string | null;
  /** YYYY-MM-DD, the document date. Nothing in Ledger moves a date on its own. */
  readonly entryDate: string;
  readonly memo?: string | null;
  readonly reversesEntryId?: string | null;
  readonly autoReverseOn?: string | null;
  readonly lines: readonly PostingLine[];
}

export class PostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostingError';
  }
}

const key = (systemKey: SystemKey): AccountRef => ({ key: systemKey });
const byId = (id: string): AccountRef => ({ id });

/** A debit of `cents` (negative goes to the credit side). */
export function debit(account: AccountRef, cents: bigint, tags: LineTags = {}): PostingLine {
  return cents >= ZERO ? { ...tags, account, debit: cents, credit: ZERO } : { ...tags, account, debit: ZERO, credit: -cents };
}

/** A credit of `cents` (negative goes to the debit side). */
export function credit(account: AccountRef, cents: bigint, tags: LineTags = {}): PostingLine {
  return cents >= ZERO ? { ...tags, account, debit: ZERO, credit: cents } : { ...tags, account, debit: -cents, credit: ZERO };
}

const nonZero = (lines: readonly PostingLine[]): PostingLine[] => lines.filter((line) => line.debit !== ZERO || line.credit !== ZERO);

export function entryTotals(lines: readonly PostingLine[]): { readonly debit: bigint; readonly credit: bigint } {
  let d = ZERO;
  let c = ZERO;
  for (const line of lines) {
    d += line.debit;
    c += line.credit;
  }
  return { debit: d, credit: c };
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The rules the database checks at commit, checked first here with a plain message. */
export function assertBalanced(draft: EntryDraft): void {
  if (!DATE_RE.test(draft.entryDate)) throw new PostingError(`The entry date ${draft.entryDate} is not a YYYY-MM-DD date.`);
  if (draft.lines.length < 2) throw new PostingError('An entry needs two or more lines.');
  for (const line of draft.lines) {
    const oneSide = (line.debit > ZERO && line.credit === ZERO) || (line.credit > ZERO && line.debit === ZERO);
    if (!oneSide) throw new PostingError('Each line is a debit or a credit above zero, never both.');
  }
  const totals = entryTotals(draft.lines);
  if (totals.debit !== totals.credit) throw new PostingError(`The entry does not balance: debits ${totals.debit}, credits ${totals.credit}.`);
}

function draft(base: Omit<EntryDraft, 'lines'>, lines: readonly PostingLine[]): EntryDraft {
  const out: EntryDraft = { ...base, lines: nonZero(lines) };
  assertBalanced(out);
  return out;
}

/** Sums lines that share an account and every tag, so an entry stays short and readable. */
export function mergeLines(lines: readonly PostingLine[]): PostingLine[] {
  const groups = new Map<string, { line: PostingLine; net: bigint }>();
  for (const line of lines) {
    const ref = 'key' in line.account ? `k:${line.account.key}` : `i:${line.account.id}`;
    const id = [ref, line.customerId, line.vendorId, line.invoiceId, line.billId, line.pulseJobId, line.taxRateId, line.memo].map((part) => part ?? '').join('|');
    const found = groups.get(id);
    const net = line.debit - line.credit;
    if (found) found.net += net;
    else groups.set(id, { line, net });
  }
  return [...groups.values()].map(({ line, net }) => debit(line.account, net, line));
}

/* ------------------------------------------------------------------ money owed to you */

export interface SalesLine {
  /** The line's revenue account. */
  readonly accountId: string;
  readonly amountCents: bigint;
  readonly taxCents: bigint;
  readonly taxRateId?: string | null;
  /** The rate's sales tax account; the system Sales tax to pay account when left out. */
  readonly taxAccountId?: string | null;
  readonly pulseJobId?: string | null;
}

export interface SalesDocument {
  readonly id: string;
  readonly customerId: string;
  readonly date: string;
  readonly totalCents: bigint;
  readonly lines: readonly SalesLine[];
}

function salesSides(doc: SalesDocument): { ar: PostingLine; rest: PostingLine[] } {
  const tags = { customerId: doc.customerId, invoiceId: doc.id };
  const rest: PostingLine[] = [];
  for (const line of doc.lines) {
    rest.push(credit(byId(line.accountId), line.amountCents, { ...tags, pulseJobId: line.pulseJobId ?? null }));
    if (line.taxCents !== ZERO) {
      const taxAccount = line.taxAccountId ? byId(line.taxAccountId) : key('sales_tax');
      rest.push(credit(taxAccount, line.taxCents, { ...tags, taxRateId: line.taxRateId ?? null }));
    }
  }
  return { ar: debit(key('ar'), doc.totalCents, tags), rest: mergeLines(rest) };
}

/** Invoice sent: Dr AR total; Cr each line's revenue account; Cr sales tax per rate. */
export function invoiceSent(doc: SalesDocument): EntryDraft {
  const { ar, rest } = salesSides(doc);
  return draft({ sourceType: 'invoice', sourceId: doc.id, entryDate: doc.date }, [ar, ...rest]);
}

/** Credit note issued: the mirror of an invoice. Dr revenue and sales tax; Cr AR total. */
export function creditNoteIssued(doc: SalesDocument): EntryDraft {
  const { ar, rest } = salesSides(doc);
  return draft({ sourceType: 'credit_note', sourceId: doc.id, entryDate: doc.date }, [...rest.map(flip), flip(ar)]);
}

export interface PaymentReceived {
  readonly id: string;
  readonly customerId: string;
  readonly date: string;
  readonly amountCents: bigint;
  readonly applications: readonly { readonly invoiceId: string; readonly amountCents: bigint }[];
  /** Payments not deposited yet (default), or the bank when "Deposited straight to the bank". */
  readonly depositTo?: AccountRef;
}

/** Payment received: Dr undeposited (or bank); Cr AR for the applied part, Cr customer credits for the rest. */
export function paymentReceived(payment: PaymentReceived): EntryDraft {
  const applied = payment.applications.reduce((sum, app) => sum + app.amountCents, ZERO);
  if (payment.amountCents <= ZERO) throw new PostingError('A payment is above zero.');
  if (applied > payment.amountCents) throw new PostingError('The applications add up to more than the payment.');
  const tags = { customerId: payment.customerId };
  return draft({ sourceType: 'payment', sourceId: payment.id, entryDate: payment.date }, [
    debit(payment.depositTo ?? key('undeposited'), payment.amountCents, tags),
    ...payment.applications.map((app) => credit(key('ar'), app.amountCents, { ...tags, invoiceId: app.invoiceId })),
    credit(key('customer_credit'), payment.amountCents - applied, tags),
  ]);
}

/** An unapplied credit applied later: Dr customer credits; Cr AR, dated the day it is applied. */
export function creditApplied(input: { readonly id: string; readonly customerId: string; readonly invoiceId: string; readonly date: string; readonly amountCents: bigint }): EntryDraft {
  const tags = { customerId: input.customerId };
  return draft({ sourceType: 'application', sourceId: input.id, entryDate: input.date }, [
    debit(key('customer_credit'), input.amountCents, tags),
    credit(key('ar'), input.amountCents, { ...tags, invoiceId: input.invoiceId }),
  ]);
}

/** Refund of a customer credit: Dr customer credits; Cr bank. */
export function refundPaid(input: { readonly id: string; readonly customerId: string; readonly date: string; readonly amountCents: bigint; readonly bank: AccountRef }): EntryDraft {
  return draft({ sourceType: 'refund', sourceId: input.id, entryDate: input.date }, [
    debit(key('customer_credit'), input.amountCents, { customerId: input.customerId }),
    credit(input.bank, input.amountCents),
  ]);
}

/** Deposit: Dr bank the net; Dr each fee; Cr payments not deposited yet, the sum of the payments. */
export function depositMade(input: {
  readonly id: string;
  readonly date: string;
  readonly bank: AccountRef;
  readonly paymentsCents: bigint;
  readonly fees?: readonly { readonly account: AccountRef; readonly cents: bigint }[];
}): EntryDraft {
  const fees = input.fees ?? [];
  const feeTotal = fees.reduce((sum, fee) => sum + fee.cents, ZERO);
  if (feeTotal > input.paymentsCents) throw new PostingError('The fees are more than the deposit.');
  return draft({ sourceType: 'deposit', sourceId: input.id, entryDate: input.date }, [
    debit(input.bank, input.paymentsCents - feeTotal),
    ...fees.map((fee) => debit(fee.account, fee.cents)),
    credit(key('undeposited'), input.paymentsCents),
  ]);
}

/** Write off: Dr bad debt (or the account picked); Cr AR. */
export function writeOffPosted(input: { readonly id: string; readonly invoiceId: string; readonly customerId: string; readonly date: string; readonly amountCents: bigint; readonly account?: AccountRef }): EntryDraft {
  if (input.amountCents <= ZERO) throw new PostingError('A write off is above zero.');
  const tags = { customerId: input.customerId, invoiceId: input.invoiceId };
  return draft({ sourceType: 'write_off', sourceId: input.id, entryDate: input.date }, [
    debit(input.account ?? key('bad_debt'), input.amountCents, tags),
    credit(key('ar'), input.amountCents, tags),
  ]);
}

/* ------------------------------------------------------------------ money you owe */

export interface CostLine {
  /** The line's expense or asset account. */
  readonly accountId: string;
  readonly amountCents: bigint;
  readonly customerId?: string | null;
  readonly pulseJobId?: string | null;
}

export interface PurchaseDocument {
  readonly id: string;
  readonly vendorId: string;
  readonly date: string;
  readonly totalCents: bigint;
  readonly lines: readonly CostLine[];
}

function costLines(lines: readonly CostLine[], tags: LineTags): PostingLine[] {
  return mergeLines(lines.map((line) => debit(byId(line.accountId), line.amountCents, { ...tags, customerId: line.customerId ?? null, pulseJobId: line.pulseJobId ?? null })));
}

/** Bill approved: Dr each line's account; Cr bills to pay, the total. */
export function billApproved(bill: PurchaseDocument): EntryDraft {
  const tags = { vendorId: bill.vendorId, billId: bill.id };
  return draft({ sourceType: 'bill', sourceId: bill.id, entryDate: bill.date }, [...costLines(bill.lines, tags), credit(key('ap'), bill.totalCents, tags)]);
}

/** Vendor credit approved: Dr bills to pay; Cr each line's account. */
export function vendorCreditApproved(credit_: PurchaseDocument): EntryDraft {
  const tags = { vendorId: credit_.vendorId, billId: credit_.id };
  return draft({ sourceType: 'vendor_credit', sourceId: credit_.id, entryDate: credit_.date }, [
    debit(key('ap'), credit_.totalCents, tags),
    ...costLines(credit_.lines, tags).map(flip),
  ]);
}

/** Bill payment recorded: Dr bills to pay (per bill); Cr the bank or the company card. */
export function billPaymentRecorded(input: {
  readonly id: string;
  readonly vendorId: string;
  readonly date: string;
  readonly from: AccountRef;
  readonly bills: readonly { readonly billId: string; readonly amountCents: bigint }[];
}): EntryDraft {
  const total = input.bills.reduce((sum, bill) => sum + bill.amountCents, ZERO);
  const tags = { vendorId: input.vendorId };
  return draft({ sourceType: 'bill_payment', sourceId: input.id, entryDate: input.date }, [
    ...input.bills.map((bill) => debit(key('ap'), bill.amountCents, { ...tags, billId: bill.billId })),
    credit(input.from, total, tags),
  ]);
}

/** Expense on a card or from the bank: Dr each line's account; Cr the card or the bank. */
export function expensePosted(input: { readonly id: string; readonly date: string; readonly paidFrom: AccountRef; readonly lines: readonly CostLine[] }): EntryDraft {
  const total = input.lines.reduce((sum, line) => sum + line.amountCents, ZERO);
  return draft({ sourceType: 'expense', sourceId: input.id, entryDate: input.date }, [...costLines(input.lines, {}), credit(input.paidFrom, total)]);
}

/** Reimbursement approved: Dr each line's account; Cr owed to people. */
export function reimbursementApproved(input: { readonly id: string; readonly date: string; readonly lines: readonly CostLine[] }): EntryDraft {
  const total = input.lines.reduce((sum, line) => sum + line.amountCents, ZERO);
  return draft({ sourceType: 'reimbursement', sourceId: input.id, entryDate: input.date }, [...costLines(input.lines, {}), credit(key('reimbursements'), total)]);
}

/** Reimbursement paid: Dr owed to people; Cr bank. */
export function reimbursementPaid(input: { readonly id: string; readonly date: string; readonly amountCents: bigint; readonly bank: AccountRef }): EntryDraft {
  return draft({ sourceType: 'reimbursement_payment', sourceId: input.id, entryDate: input.date }, [
    debit(key('reimbursements'), input.amountCents),
    credit(input.bank, input.amountCents),
  ]);
}

/** Transfer (including paying the card): Dr the to account; Cr the from account. */
export function transferMade(input: { readonly id: string; readonly date: string; readonly from: AccountRef; readonly to: AccountRef; readonly amountCents: bigint }): EntryDraft {
  if (input.amountCents <= ZERO) throw new PostingError('A transfer is above zero.');
  return draft({ sourceType: 'transfer', sourceId: input.id, entryDate: input.date }, [debit(input.to, input.amountCents), credit(input.from, input.amountCents)]);
}

/* ------------------------------------------------------------------ books */

/** The first day of the month after `date` (YYYY-MM-DD). */
export function firstOfNextMonth(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** Month end accrual (4.10): Dr 1150 work done not billed yet; Cr 4950; reverses on the 1st of next month. */
export function accrualPosted(input: { readonly id: string; readonly monthEnd: string; readonly totalCents: bigint }): EntryDraft {
  if (input.totalCents < ZERO) throw new PostingError('Only positive gaps are booked as an accrual.');
  return draft({ sourceType: 'accrual', sourceId: input.id, entryDate: input.monthEnd, autoReverseOn: firstOfNextMonth(input.monthEnd) }, [
    debit(key('unbilled'), input.totalCents),
    credit(key('accrued_revenue'), input.totalCents),
  ]);
}

/** Accrual reversal on the first day of the next month: Dr 4950; Cr 1150. */
export function accrualReversed(input: { readonly id: string; readonly monthEnd: string; readonly totalCents: bigint; readonly reversesEntryId?: string | null }): EntryDraft {
  return draft({ sourceType: 'accrual_reversal', sourceId: input.id, entryDate: firstOfNextMonth(input.monthEnd), reversesEntryId: input.reversesEntryId ?? null }, [
    debit(key('accrued_revenue'), input.totalCents),
    credit(key('unbilled'), input.totalCents),
  ]);
}

export interface TypedLine extends LineTags {
  readonly account: AccountRef;
  readonly debitCents: bigint;
  readonly creditCents: bigint;
}

function typed(lines: readonly TypedLine[]): PostingLine[] {
  return lines.map((line) => {
    if (line.debitCents < ZERO || line.creditCents < ZERO) throw new PostingError('Typed amounts are zero or more.');
    if (line.debitCents > ZERO && line.creditCents > ZERO) throw new PostingError('A typed line is a debit or a credit, never both.');
    return { ...line, debit: line.debitCents, credit: line.creditCents };
  });
}

/** Manual journal entry: as typed, balanced. `sourceId` is the entry's own id when known. */
export function manualEntry(input: { readonly id?: string | null; readonly date: string; readonly memo?: string | null; readonly autoReverseOn?: string | null; readonly lines: readonly TypedLine[] }): EntryDraft {
  return draft({ sourceType: 'manual', sourceId: input.id ?? null, entryDate: input.date, memo: input.memo ?? null, autoReverseOn: input.autoReverseOn ?? null }, typed(input.lines));
}

/** Payroll journal imported: as in the file, balanced. */
export function payrollImported(input: { readonly id: string; readonly date: string; readonly memo?: string | null; readonly lines: readonly TypedLine[] }): EntryDraft {
  return draft({ sourceType: 'payroll', sourceId: input.id, entryDate: input.date, memo: input.memo ?? null }, typed(input.lines));
}

/** Opening balances (7.2): each account's opening debit or credit; the difference to Opening balances (3900). */
export function openingBalances(input: { readonly id: string; readonly openingDate: string; readonly lines: readonly TypedLine[] }): EntryDraft {
  const lines = typed(input.lines);
  const totals = entryTotals(lines);
  const gap = totals.debit - totals.credit;
  return draft({ sourceType: 'opening', sourceId: input.id, entryDate: input.openingDate, memo: 'Opening balances' }, [...lines, credit(key('opening_equity'), gap)]);
}

/** Open invoice imported: Dr AR; Cr Opening balances, dated the opening date. */
export function openInvoiceImported(input: { readonly invoiceId: string; readonly customerId: string; readonly openingDate: string; readonly balanceCents: bigint }): EntryDraft {
  const tags = { customerId: input.customerId, invoiceId: input.invoiceId };
  return draft({ sourceType: 'opening', sourceId: input.invoiceId, entryDate: input.openingDate }, [
    debit(key('ar'), input.balanceCents, tags),
    credit(key('opening_equity'), input.balanceCents),
  ]);
}

/** Open bill imported: Dr Opening balances; Cr bills to pay, dated the opening date. */
export function openBillImported(input: { readonly billId: string; readonly vendorId: string; readonly openingDate: string; readonly balanceCents: bigint }): EntryDraft {
  const tags = { vendorId: input.vendorId, billId: input.billId };
  return draft({ sourceType: 'opening', sourceId: input.billId, entryDate: input.openingDate }, [
    debit(key('opening_equity'), input.balanceCents),
    credit(key('ap'), input.balanceCents, tags),
  ]);
}

/* ------------------------------------------------------------------ reversing */

/** One line with its sides swapped. */
export function flip(line: PostingLine): PostingLine {
  return { ...line, debit: line.credit, credit: line.debit };
}

/**
 * The reversing entry for a posted one (invoice changed, invoice or bill voided, an application
 * removed). Same source, same lines with the sides swapped, `reversesEntryId` set. `date` is the
 * date of the entry it reverses unless the rule says otherwise.
 */
export function reversalOf(entry: { readonly id: string; readonly sourceType: JournalSourceType; readonly sourceId: string | null; readonly entryDate: string; readonly lines: readonly PostingLine[] }, date = entry.entryDate): EntryDraft {
  return draft({ sourceType: entry.sourceType, sourceId: entry.sourceId, entryDate: date, reversesEntryId: entry.id, memo: 'Reversing entry' }, entry.lines.map(flip));
}

/* ------------------------------------------------------------------ words */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The house sentence for a posting into a closed month (4.4). `month` is YYYY-MM. */
export function closedMonthMessage(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const name = MONTHS[index] ?? month;
  const next = MONTHS[(index + 1) % 12] ?? month;
  return `${name} ${year} is closed. Date it in ${next}, or ask the owner to reopen ${name}.`;
}
