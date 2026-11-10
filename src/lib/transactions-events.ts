/**
 * Window events for the header Transactions tray. Refresh only re-polls the task list;
 * open shows the tray (e.g. from the "Open Transactions" toast action). Opening is never
 * implicit, so a later click on the tray trigger always opens it rather than closing it.
 */
export const TRANSACTIONS_REFRESH_EVENT = "ks:transactions-refresh";
export const TRANSACTIONS_OPEN_EVENT = "ks:transactions-open";

export function refreshTransactions(): void {
  window.dispatchEvent(new Event(TRANSACTIONS_REFRESH_EVENT));
}

export function openTransactionsTray(): void {
  window.dispatchEvent(new Event(TRANSACTIONS_OPEN_EVENT));
}
