---
title: Work with a job page
description: Read a job's verdict, tiles and charts, test a what if, move it between stages, and copy, archive, delete or restore the job.
section: Jobs
order: 30
---

Each job has its own page with six tabs. The **Overview** says where the job stands and why. The other tabs hold the plan, the daily work, materials, money in and the history. Open a job from the Jobs list, from search, or at `/jobs/` followed by the job number.

## Before you start

- Anyone with a Pulse role can open a job. Money tiles show only to people who see money.
- Changing the job, its stage or its links needs a manager.

## The tabs

| Tab | What is on it |
| --- | --- |
| **Overview** | The verdict, the tiles, the charts, the what if panel and quick actions. |
| **Plan vs actual** | The quote or budget next to what happened, and why profit changed. See [Compare plan with actual](/docs/pulse/plan-vs-actual). |
| **Work log** | Every day of work, with units, people, hours, pace and labor cost. |
| **Materials** | Who buys the parts, how material is costed, parts used and other costs. See [Track materials and scrap](/docs/pulse/materials). |
| **Money in** | The price and its history, earned revenue, invoices, fees and extra services. See [Set prices and track revenue](/docs/pulse/prices-and-revenue). |
| **Activity** | Who changed what, with before and after, and notes. |

## The header

The header shows the job number, name, client and site, and three quick controls:

- **Stage**: select it to move the job to another stage.
- **Owner**: who gets the alerts for this job.
- **Due date**: select it to change or clear the due date.

Linked records (a CRM deal, a work order, a project) show as chips that open the other app in a new tab. **Edit** opens names, dates, units, target pace, target margin, a **Pinned note** and **Notes for the team**. The price and the plan have their own tabs.

## Read the Overview

**Where this job stands** gives the status, up to three reasons in plain words, the next step for each, and where the job is heading at the finish with a confidence word. See [How Pulse judges a job](/docs/pulse/job-status).

| Tile | What it shows |
| --- | --- |
| **Revenue earned** | Units made times the price, plus extra services and fees, less credits. Earned when the work is done, not when the invoice goes out. |
| **Cost so far** | Labor at the real cost of an hour, material, other costs and the job's share of time not on a job. |
| **Profit so far** | Revenue earned less every cost, with what it is heading for. |
| **Job margin** | Profit as a share of revenue. The last line, **Before time not on a job**, shows what the job earns on its own. |
| **Units done** | Good units against planned units. Scrap and rework never earn revenue. |
| **Pace on days with hours** | Good units per person per hour on days that count, against the target pace. |
| **Cost for one unit so far** | All cost so far over good units, next to the should cost from the plan. |
| **Not billed yet** | Revenue the work earned that no approved invoice covers. |
| **Hours logged** | People times hours each, over every row. Overtime is part of the total. |
| **Last entry** | The latest day with a row on the work log. |

Under the tiles: **Money over time** (revenue and cost day by day), **Pace against the target**, **Where the cost went** and **Latest work**. When some days have units and no hours, profit is marked as not complete yet.

## Test a what if

The panel **What if the rest of the job ran like this?** changes nothing that is saved.

1. Move the **Pace for the rest of the job**, **Real cost of an hour**, **Price for one** unit or the total units on the job.
2. Read **Profit at finish, with your changes** next to **Profit at finish, as it runs now**, plus **Margin at finish**, **Cost at finish**, **Labor hours at finish** and **Finish date**.

To keep a what if, open the job in the calculator. See [Price a job with the calculator](/docs/pulse/quote-calculator).

## Quick actions

| Button | What it does |
| --- | --- |
| **Log today** | Opens the Work log to add a day. Reads **Add a late day** on a completed or cancelled job. |
| **Add a cost** | Opens other costs on the Materials tab. |
| **Add an invoice or a fee** | Opens invoices on the Money in tab. |
| **Add an extra service** | Opens extra services on the Money in tab. |
| **Copy this job** | Makes a new planned job with the same price and plan and no entries. |

## Log work on the Work log tab

1. Open **Work log** and use **Add a day of work**.
2. Type the day, good and scrapped units, and one line per labor class with people and hours.
3. Save. Each saved day shows an undo toast.

The table lists each day with labor class, good units, scrap, people, labor hours, pace, the cost of an hour, labor cost and where the row came from (typed in, from the warehouse, from Projects, time clock). Rows in a closed month cannot change. When the job is linked to a project, a **Cost by task** panel shows labor hours, labor cost, share, task units and units per labor hour for each task.

## Move a job between stages

A job has one of five stages: **Planned**, **Active**, **On hold**, **Completed** and **Cancelled**. Open jobs are active and on hold.

| From | Moves you can make |
| --- | --- |
| **Planned** | **Start the job**, **Put on hold**, **Mark complete**, **Cancel the job** |
| **Active** | **Put on hold**, **Mark complete**, **Cancel the job**, **Move back to planned** |
| **On hold** | **Resume the job**, **Mark complete**, **Cancel the job**, **Move back to planned** |
| **Completed** | **Reopen the job** |
| **Cancelled** | **Move back to planned**, **Start the job** |

A cancelled job's entries still count in the months they were logged.

## Copy, archive, delete and restore

Open the **More actions** menu in the header.

- **Copy this job**: the copy starts as planned, with the same price and plan and no entries.
- **Archive**: takes a finished job off the lists. It keeps its numbers and stays in reports. Find it under **All**. An active job cannot be archived: finish, hold or cancel it first. **Bring back from the archive** undoes it.
- **Delete**: the job and its numbers leave every list and report. Its entries stay safe.

To restore a deleted job, go to **Jobs > Deleted** and select **Restore**. It comes back in every list, total and report, with all its entries.

## Related

- [How Pulse judges a job](/docs/pulse/job-status)
- [Log a day of work](/docs/pulse/log-work)
- [Link a job to a deal, work order or project](/docs/pulse/link-a-job)
