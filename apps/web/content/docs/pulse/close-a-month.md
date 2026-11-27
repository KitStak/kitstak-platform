---
title: Close a month
description: Work the month close checklist, read job profit down to company profit, lock the month so its numbers stop moving, and reopen it with a reason when you must.
section: Month close
order: 10
---

Closing a month locks its numbers. After that nobody can change an entry, a cost or a rate inside it by accident, so the profit you reported stays the profit you reported. Pulse saves the month's numbers at the moment of the close, and a closed month shows those saved figures.

## Before you start

- Closing a month needs an admin or the owner. Reopening a closed month needs the owner.
- A month can be closed once it is over.
- Readers who do not see money get the checklist and the lock counts with every figure blank.

## Find the month

1. Go to **More > Settings** and open the **Month close** tab.
2. The list shows each month with its status and, once closed, its company profit and company margin:

| Status | What it means |
| --- | --- |
| **In progress** | The month is not over yet. |
| Things to fix | The checklist has steps marked **Fix this first**. The badge says how many. |
| **Ready to close** | The checklist is clear. |
| **Closed** | Its entries are locked. |

3. Select a month to open it.

## Work the checklist

Each step says what it found and links to where to fix it. A step is marked **Fix this first** or **Worth a look**.

| Step | What it checks |
| --- | --- |
| **Every hour has a labor rate** | No logged hours are missing a real cost of an hour. |
| **Every day with units has hours** | No job day has units and no hours. |
| **Every extra service has a price** | Every extra service entry earned its price. |
| **Days are reviewed** | A manager approved every logged day. You can still close without it. |
| **Payroll check** | Payroll paid against the pay the logged hours add up to, when gross pay was typed. Shows the payroll gap. |
| **Company costs are in** | Rent, utilities and other company costs are typed for the month. Without them, company profit trusts your overhead per hour. |
| **Programs settled** and **Programs synced** | Shown when KitStak Projects programs feed your jobs. |

## Read the month's numbers

**Job profit** shows revenue earned in the month, less the cost of its jobs: labor, material, other costs and the time not on a job that jobs carried. It shows the **Job margin**.

**Company profit** starts from job profit and takes away the costs no job carried:

- **Time not on a job that no job carried**
- **Paid time not on any job**
- **Overhead your hourly rate did not cover**, from **Company costs typed in** less **Overhead your hourly rates covered**

It ends on **Company profit** with the **Company margin**. See [How Pulse does the math](/docs/pulse/how-pulse-does-the-math).

## Look over the entries

**Entries dated in** the month has tabs for **Company costs**, **All other costs**, **Parts used**, **Invoices and fees** and **Extra services**. Fix or add rows here before you close. **What is locked** counts the rows a close will lock: work log entries, time not on a job, paid hours, material usage, other costs, invoices and fees, and extra service entries.

## Close the month

1. Select **Close the month**. If steps still need fixing, the button reads **Close it anyway**: the saved numbers will carry the gap.
2. Read the dialog: closing saves the month's numbers and locks its entries, with how many rows will be locked.
3. Confirm with the close button.

## What a close locks

Any edit, delete, import or sync that would touch a row dated in a closed month is refused with a message like "October 2026 is closed. Ask the owner to reopen it." New rates, prices and cost rules change open months only, so a closed month never moves. Rows from a connected app that land in a closed month are counted as left out, never as an error.

## Reopen a month

1. Open the closed month and select **Reopen the month**.
2. Type **Why are you reopening it**, for example "A late freight bill came in."
3. Confirm. Select **Keep it closed** to back out.

Entries in the month can change again, so its profit can move. The reason, who reopened it and when are kept in the history, and in the audit log.

## Related

- [Add other costs and company costs](/docs/pulse/other-and-company-costs)
- [Review days and fix entries](/docs/pulse/review-days-and-entries)
- [Read the audit log](/docs/pulse/audit-log)
