/**
 * Screenshot slots on /ledger. Every `file` is null until the Ledger app exists and its screens are
 * captured. Put each picture in public/ledger/shots/<slot>.webp and fill in `file`, `width`, `height`
 * and `alt`. While any slot is empty, LEDGER_IS_LIVE cannot be turned on (src/lib/go-live.test.ts).
 */
import type { AppShotSlot } from '../product/app-shot';

export const LEDGER_SHOTS = {
  hero: { screen: 'Money home', note: 'What you are owed, what is due, and how close the month is.', file: null, rows: 7 },
  invoices: { screen: 'Draft invoice', note: 'A month of WMS bill lines for one client, ready to send.', file: null, rows: 6 },
  collections: { screen: 'Aging', note: 'Open invoices by customer and bucket.', file: null },
  bills: { screen: 'Bills', note: 'Vendor bills waiting for approval and payment.', file: null },
  expenses: { screen: 'Expense', note: 'A receipt photo tagged to a job.', file: null, shape: 'narrow', rows: 4 },
  bank: { screen: 'Reconcile', note: 'Bank lines matched to invoices and bills.', file: null, rows: 6 },
  close: { screen: 'Close the month', note: 'The checklist, the accruals and the lock.', file: null },
  stack: { screen: 'Earned vs billed', note: 'Pulse’s earned revenue beside what was billed and collected.', file: null },
} as const satisfies Readonly<Record<string, AppShotSlot>>;
