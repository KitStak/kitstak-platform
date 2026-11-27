---
title: Invoices
description: How Ledger is planned to draft invoices from WMS bill lines, Pulse work not billed yet, Projects price cards or by hand, then send them as a PDF by email.
section: Getting paid
order: 10
---

> **Note:** Ledger is planned and not available yet. This page describes how it is planned to work, and details may change before launch.

An invoice is what you send a customer for work done. Ledger is planned to draft most invoices for you from what the other apps already know, so nobody retypes a bill line.

## Where an invoice starts

| Start from | What fills in |
| --- | --- |
| WMS bill lines | Approved receiving, storage, pick and pack, shipment and work order lines for a client and period. The amounts stay as WMS approved them. |
| Pulse work not billed yet | The Ready to bill report becomes a draft invoice instead of a CSV file. |
| Projects price cards | Program runs invoice on a cadence, like weekly or monthly. |
| By hand | You type the lines yourself. |

Every source is optional. A shop with only Ledger invoices by hand.

## What an invoice holds

- The customer, their billing contact and payment terms. If you use CRM, these come from the account, so no customer is typed twice.
- Line items with a quantity and a unit price.
- Sales tax, when you charge it. Many kitting and 3PL shops charge none and some must, so tax is planned to be a rate table you set.
- Credits.
- The due date, from the terms.

## Recurring invoices

Some charges repeat, like monthly storage. A recurring invoice is planned to draft itself on its schedule, for you to check and send.

## Send it

Ledger is planned to make a PDF of each invoice and email it to the customer's billing contact. Online card and bank payment links are planned, using your own payment account. Whether they are in the first release is still being decided.

## Invoices and profit

In Pulse, profit uses what the work earned. Invoices never change profit. Ledger is where billed and paid live. The two sit side by side, and the gap between earned and billed is the accrual Ledger books at month end. See [Month-end close](/docs/ledger/month-end-close).

## Related

- [Collections and aging](/docs/ledger/collections-and-aging)
- [How Ledger connects to the other apps](/docs/ledger/connected-apps)
