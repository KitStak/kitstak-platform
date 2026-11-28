---
title: Month-end close
description: How Ledger is planned to run a close checklist, book accruals for work not billed yet, and lock the month once for Ledger and Pulse together.
section: Bank and close
order: 20
---

> **Note:** Ledger is planned and not available yet. This page describes how it is planned to work, and details may change before launch.

Closing a month locks its numbers, so what you reported stays what you reported. Pulse already closes months today. Ledger is planned to make that one close for every app, not two.

## One close, not two

If Ledger and Pulse each closed months on their own, you could close October in one and not the other. The plan:

- When you have Ledger, the Ledger close is the close. It runs the Pulse checklist as one of its steps, and locks the Pulse month in the same action.
- Without Ledger, Pulse closes on its own, the way it does today. See [Pulse](/docs/pulse).
- Reopening a month needs a reason, and the reopen is logged.

This is the planned approach, and it is still being confirmed.

## The close checklist

Ledger is planned to walk you through a checklist before the month locks. The exact steps are still being worked out. Steps like these are expected:

- The bank is reconciled, with nothing left unmatched. See [Bank reconciliation](/docs/ledger/bank-reconciliation).
- Bills and expenses for the month are in.
- Invoices for the month are sent.
- The Pulse checklist is clear, when you use Pulse.

## Accruals

Pulse counts revenue when the work is done. Ledger counts it when it is billed and paid. At month end, work done and not billed yet is the gap between them. Ledger is planned to book that gap as an accrual, so the month shows what you really earned.

## After the close

A closed month locks. Nobody can change an entry in it by accident. Every posted entry keeps an audit trail of who made it and when.

## Related

- [Invoices](/docs/ledger/invoices)
- [How Ledger connects to the other apps](/docs/ledger/connected-apps)
