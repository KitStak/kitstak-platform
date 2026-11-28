---
title: Collections and aging
description: How Ledger is planned to show unpaid invoices by age, send reminders on a schedule, track promises to pay and disputes, and record partial payments.
section: Getting paid
order: 20
---

> **Note:** Ledger is planned and not available yet. This page describes how it is planned to work, and details may change before launch.

Sending an invoice is half the job. Collections is the other half: knowing who owes you, for how long, and what happens next.

## Aging

Ledger is planned to group every unpaid invoice by how long it has been open:

| Bucket | What it holds |
| --- | --- |
| Current | Not due yet. |
| 1 to 30 days | Past due by up to a month. |
| 31 to 60 days | Past due by one to two months. |
| 61 to 90 days | Past due by two to three months. |
| Over 90 days | Past due by more than three months. |

You can read aging for all customers or for one.

## Reminders

Reminders are planned to go out on a schedule you set, like a few days before the due date and again after it. Each reminder links back to the invoice.

## Promises, disputes and partial payments

- A promise to pay records the date the customer said they would pay. Ledger follows up if the date passes.
- A dispute marks one line on an invoice the customer questions, so the rest can still be collected.
- A partial payment lowers what is owed and keeps the invoice open for the rest.
- A write off closes what you will not collect, with a reason.

## Follow ups as tasks

If you use Projects, collections follow ups are planned to become tasks with an owner and a due date. If you use CRM, each account is planned to show its balance, its oldest open invoice and days past due. See [How Ledger connects to the other apps](/docs/ledger/connected-apps).

## Related

- [Invoices](/docs/ledger/invoices)
- [Bank reconciliation](/docs/ledger/bank-reconciliation)
