---
title: How Ledger connects to the other apps
description: What Ledger is planned to read from WMS, Pulse, Projects, CRM and Crew, and what it sends back, so no bill line or customer is typed twice.
section: Connected apps
order: 10
---

> **Note:** Ledger is planned and not available yet. This page describes how it is planned to work, and details may change before launch.

Ledger is planned to work on its own, and to fill in more of itself with each KitStak app you add. The apps share one account and one list of customers, so nothing moves by file between them.

## What Ledger reads

| From | What comes across | What Ledger does with it |
| --- | --- | --- |
| [WMS](/docs/wms) | Approved 3PL bill lines per client and period | Drafts an invoice. WMS stays the source of truth for the line amounts. |
| [Pulse](/docs/pulse) | Work done and not billed yet per job and client | Ready to bill becomes a draft invoice instead of a CSV file. |
| [Projects](/docs/projects) | Program price card lines and runs | Program runs invoice on a cadence. |
| [CRM](/docs/crm) | Account, billing contact and payment terms from the won deal | Fills the customer on an invoice. |
| [Crew](/docs/crew) | Approved hours per temp agency and week | Checks temp agency bills against the hours. |

## What Ledger sends

| To | What goes across |
| --- | --- |
| [Pulse](/docs/pulse) | Invoices, as billed amounts that never change profit. Bills and expenses tagged to a job or client, as costs at the job, client or company level. |
| [CRM](/docs/crm) | Each account's balance, oldest open invoice and days past due. |
| [Projects](/docs/projects) | Collections follow ups and close checklist items, as tasks with an owner and a due date. |
| The Portal | A money owed to you tile and a bills due tile on the launcher home. |

## Pulse earned and Ledger billed

Pulse's rule stays the same: profit uses what the work earned, and invoices never change it. Ledger holds what was billed and what was collected. You see both side by side.

## The WMS invoice export

WMS exports approved invoice lines today. Whether that export stays once you have Ledger, or becomes a way to send the lines to Ledger, is still being decided.

## Related

- [Invoices](/docs/ledger/invoices)
- [Month-end close](/docs/ledger/month-end-close)
