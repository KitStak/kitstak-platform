/** Month words and the close checklist steps (docs/ledger/SPEC.md 4.11). Pure, unit tested. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-10` to `{ year, month }`, or null when it is not a month. */
export function parseMonth(value: string): { readonly year: number; readonly month: number } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

export function monthLabel(value: string): string {
  const parsed = parseMonth(value);
  return parsed ? `${MONTHS[parsed.month - 1]} ${parsed.year}` : value;
}

/** The last `count` full months before `today`, newest first. */
export function recentMonths(today: Date, count: number): readonly { readonly key: string; readonly label: string }[] {
  const out: { key: string; label: string }[] = [];
  let year = today.getUTCFullYear();
  let month = today.getUTCMonth() + 1;
  for (let i = 0; i < count; i += 1) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    const key = `${year}-${String(month).padStart(2, '0')}`;
    out.push({ key, label: monthLabel(key) });
  }
  return out;
}

export interface CloseStep {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly blocks: boolean;
}

export const CLOSE_STEPS: readonly CloseStep[] = [
  { key: 'bank_matched', title: 'Every bank and card account is matched', detail: 'Nothing unmatched dated in the month, each matched to a statement dated on or after the month end.', blocks: true },
  { key: 'invoices_sent', title: 'No draft invoices or credit notes', detail: 'Send, redate or delete drafts dated in the month.', blocks: true },
  { key: 'bills_entered', title: 'No draft bills', detail: 'Approve or delete draft bills dated in the month.', blocks: true },
  { key: 'expenses_done', title: 'No expenses waiting for approval', detail: 'Approve or reject submitted expenses dated in the month.', blocks: true },
  { key: 'wms_billed', title: 'Warehouse bills are on an invoice', detail: 'With WMS: approved warehouse bills for the month that are on no invoice.', blocks: false },
  { key: 'pulse_checks', title: 'Pulse checks for the month', detail: 'With Pulse: entries needing a rate, days not reviewed and programs not settled.', blocks: true },
  { key: 'accrual', title: 'Work done, not billed yet, is reviewed', detail: 'Look at the accrual for the month and tick that you checked it.', blocks: true },
  { key: 'payroll_booked', title: 'Payroll is booked', detail: 'A payroll entry dated in the month.', blocks: false },
  { key: 'sync_clear', title: 'Nothing waiting to go to QuickBooks', detail: 'With QuickBooks: nothing pending or failed in the month, and the totals match.', blocks: true },
];
