---
title: Bank reconciliation
description: How Ledger is planned to read bank and card feeds, match payments and deposits to invoices, bills and expenses, and flag what does not match.
section: Bank and close
order: 10
---

> **Note:** Ledger is planned and not available yet. This page describes how it is planned to work, and details may change before launch.

Reconciliation proves that what Ledger says happened is what the bank says happened. Ledger is planned to read your bank and card activity and match each line to an invoice, a bill or an expense.

## Connect a bank or card

Ledger is planned to connect to your bank and card accounts through a bank feed provider. Which provider is still being decided. Bank connections sometimes need to be signed in again, so Ledger is planned to tell you when a feed stops.

## How matching works

| Bank line | Matched to |
| --- | --- |
| A deposit | One or more customer payments on invoices. |
| A payment out | A vendor bill you recorded as paid. |
| A card charge | An expense. |

Ledger is planned to suggest a match when the amount and date line up. You confirm it, or pick another.

## What does not match

Some lines will not match anything:

- A deposit with no invoice behind it.
- A payment out with no bill.
- A charge with no expense or receipt.

Ledger is planned to flag each one so it gets an invoice, a bill or an expense before the month closes.

## Related

- [Month-end close](/docs/ledger/month-end-close)
- [Collections and aging](/docs/ledger/collections-and-aging)
