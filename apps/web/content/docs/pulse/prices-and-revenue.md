---
title: Set prices and track revenue
description: Set a job's price per unit, fixed price or hourly rate from a given day, see what the work earned, and record invoices, fees, adjustments and credits.
section: Revenue and services
order: 10
---

Revenue in Pulse is what the work earned: units done times the price, plus extra services, plus fees, less credits. It is earned when the work is done, not when the invoice goes out. Invoices are a second number, **billed**, kept next to earned so nothing goes unbilled. An invoice never changes profit.

## Before you start

- Prices, invoices and fees need a manager, admin or owner. The **Money in** tab is hidden from roles that do not see money.

## The three ways to charge

| Pricing | How revenue is earned |
| --- | --- |
| **Price per unit** | Good units times the price in force on the work day. |
| **One fixed price** | Earned as the units get done: the share of planned units finished so far, times the fixed price. It never earns more than the fixed price. |
| **Price per labor hour** | Labor hours times the rate you bill for one hour. |

When a fixed price job is completed, Pulse writes one row, **Fixed price true up**, so the job earns exactly its fixed price. The row changes when the price or the work changes, and is removed if the job is reopened.

## Change a price from a day

1. Open the job and go to **Money in**.
2. Select **Change the price**.
3. Type the new price: **New price for one** unit, **New price for one labor hour** or **New price for the whole job**.
4. Under **From which day?**, pick **From a day I pick** and set **Starts on**, or **The whole job, from the start**.
5. Optionally say **Why it changed**, then save.

Entries from that day on are worked out again. Earlier days keep the old price. Entries in a closed month never change. The **Price history** lists every change with its start day and reason. Removing a change puts entries from that day back on the earlier price.

## Read Money in

| Part | What it shows |
| --- | --- |
| **Revenue earned** | Split into **From the work itself**, **Extra services**, and **Fees, corrections and credits**. |
| **Approved invoices** | Every approved invoice on the job, added up. A record only. |
| **Not billed yet** | What the work has earned, less what approved invoices cover. |
| **Earned by day** | Revenue earned each day. |
| **Invoices, fees and credits** | The rows below. |
| **Extra services** | Services done on this job. See [Set up and track extra services](/docs/pulse/extra-services). |

## Add invoices, fees and credits

1. On **Money in**, select **Add invoices, fees or credits**, or start from the job's **Overview** with **Add an invoice or a fee**.
2. Type one row each, or paste rows from a spreadsheet.
3. Save.

| Kind | What it is |
| --- | --- |
| **Invoice** | What you billed. A record only. |
| **Fee** | Extra money earned, like a rush fee. Adds to revenue. |
| **Adjustment** | A correction to revenue. |
| **Credit** | Money given back. It lowers revenue. |

Each row has a **Date**, **Kind**, **What for**, **Invoice number** and **Amount**. A credit is saved as money given back.

## Worked example (made-up figures)

A fixed price job: $9,400.00 for 2,000 planned units. Three days make 500, 700 and 900 units.

- After day 1: 500 of 2,000 done, earned $2,350.00.
- After day 2: 1,200 done, earned to date $5,640.00, so day 2 earns $3,290.00.
- After day 3: 2,100 done, capped at 2,000, earned to date $9,400.00, so day 3 earns $3,760.00.

If the job had been completed after day 2, the **Fixed price true up** would be $9,400.00 less $5,640.00 = $3,760.00.

## Ready to bill

The **Ready to bill** report lists work that is done and earned but not billed yet, by client and job, so you can hand it to accounting. See [Run a report](/docs/pulse/reports).

## Related

- [Set up and track extra services](/docs/pulse/extra-services)
- [Work with a job page](/docs/pulse/job-page)
- [Work the alerts inbox](/docs/pulse/alerts-inbox)
