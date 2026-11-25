---
title: Add other costs and company costs
description: Record freight, packaging and outside help on a job or a client, and rent, utilities and salaried staff as company costs, with credits as minus amounts.
section: Costs and rates
order: 40
---

Money out has four buckets: labor, materials, other costs and time not on a job. **Other costs** are what a job costs besides labor and material: freight, pallets, packaging, outside help. Leave them out and the job looks better than it is. **Company costs** are bills that belong to no single job, like rent. They count in company profit, never in a job.

## Before you start

- Adding costs needs a manager, admin or owner. Costs are money, so they are hidden from roles that do not see money.

## Where a cost can sit

| Level | Example | Where it counts |
| --- | --- | --- |
| A job | Freight in for one job. | In that job's cost and profit. |
| A client, no job | Storage or a shared pallet run for one client. | In the client's profit and cost to serve, not in any job. |
| The whole company | Rent, utilities, equipment, salaried staff, insurance. | Only in company profit, as your real overhead. |

Put each cost in one place only. A supervisor's pay goes either in overhead per hour or in company costs, never both.

## Add a cost to a job

1. Open the job and go to the **Materials** tab.
2. Under **Other costs on this job**, select **Add costs**.
3. Type one row per cost, or paste rows from a spreadsheet.
4. Save.

You can also start from the job's **Overview** with **Add a cost**.

## Add company costs or client costs

1. Go to **More > Settings** and open **Month close**.
2. Pick the month.
3. Under **Entries dated in** the month, open the **Company costs** tab, select **Add company costs** and type one row per bill.
4. For a cost on a client, open the **All other costs** tab, add the row and pick the client under **For**.

## The columns

| Column | What it holds |
| --- | --- |
| **Date** | The day of the cost. |
| **For** | A job, a client, or **The whole company**. |
| **What for** | **Freight**, **Packaging**, **Equipment**, **Outside help**, **Rework**, **Supplies**, **Storage**, **Rent**, **Utilities**, **Salaried staff**, **Insurance** or **Other**. |
| **Paid to** | Who was paid. |
| **Reference** | A bill number. |
| **Note** | Anything worth knowing. |
| **Amount** | In dollars. Use a minus sign for a credit, like a vendor refund. It cannot be zero. |

Cells edit in place and every change has an undo. The list total adds every row, and a credit takes away from it.

## How company costs reach company profit

Company costs are typed by month. For a week or part of a month, Pulse takes a share of the month's costs by day. **Settings > Cost rules > Spread company costs by** picks **Calendar days** or **Work days**. A whole month is the same either way. Pulse then compares the month's company costs with the overhead your hourly rates already covered. See [How Pulse does the math](/docs/pulse/how-pulse-does-the-math).

## Worked example (made-up figures)

November company costs are $70,500.00. You look at November 1 to 18 with calendar days.

- Share for 18 of 30 days: $70,500.00 x 18 / 30 = $42,300.00.
- If your hourly rates covered $38,000.00 of overhead on those days, the overhead your hourly rate did not cover is $4,300.00.

## Import costs

Use the **Costs** template. A row with a job number goes on that job, a row with a client code goes on that client, and a row with neither is a company cost. See [CSV files and their columns](/docs/pulse/csv-templates).

## Related

- [Track materials and scrap](/docs/pulse/materials)
- [Close a month](/docs/pulse/close-a-month)
- [Set labor classes and rates](/docs/pulse/labor-rates)
