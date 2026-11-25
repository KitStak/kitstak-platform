---
title: Add a quote or a budget
description: Save what you told the client as the quote, make your own budget from it when your plan differs, and see where each plan came from.
section: Quote vs actual
order: 10
---

A job can hold two plans. The **quote** is what you told the client: the revenue and the costs you expected for the whole job. The **budget** is your own plan, when it differs from what you quoted. Most shops have one plan, so a budget does not exist until you make one, and until then the quote is the plan.

With a plan, Pulse shows where the job beat it and where it fell short, in dollars. See [Compare plan with actual](/docs/pulse/plan-vs-actual).

## Before you start

- Plans need a manager, admin or owner. Other roles can read plans but not change them.
- The **Plan vs actual** tab is hidden from roles that do not see money.

## Where a quote comes from

| Source | How it gets there |
| --- | --- |
| **Typed in** | Typed on the Plan vs actual tab, or made by the new job page from your price and labor plan. |
| **From a spreadsheet** | The **Quotes and budgets** import, or the quote columns of the **Jobs** import. |
| **From the calculator** | **Create a job from this** in the calculator. |
| **From the CRM deal** | A job made from a won deal. The deal value becomes the quote revenue. |
| **From the warehouse contract rate** | A linked work order priced by the client's warehouse contract. |
| **Copied from the quote** | A budget made with **Make my own budget**. |

The plan shows its source and when it last changed.

## Add or edit the quote

1. Open the job and go to **Plan vs actual**.
2. Select **Add a quote**, or **Edit the quote**.
3. Fill in the totals and select **Save the quote**.

| Field | What to type |
| --- | --- |
| **Units** | Planned units for the whole job. |
| **Revenue** | Everything the client pays for the job. |
| **Labor hours** | People times hours, setup included. |
| **Labor cost** | Those hours at the real cost of an hour. |
| **Setup hours** | Part of the labor hours. They make no units. |
| **Setup cost** | Part of the labor cost. |
| **Material cost** | Parts you buy for the job. |
| **Other cost** | Freight, pallets, outside help. |
| **Time not on a job** | Turn on **Let Pulse fill it in** to use your workspace's usual share of meetings, cleanup and waiting, or type an amount. |
| **Why this plan changed** | A short reason, kept with the plan. |

A plan made in the new job wizard keeps its lines, and Plan vs actual compares each line.

## Make your own budget

1. On **Plan vs actual**, select **Make my own budget**.
2. Pulse copies the quote into a budget: **Budget made from the quote. Edit it to match your own plan.**
3. Select **Edit the budget**, change the numbers, and select **Save the budget**.

Once a budget exists, the job is judged against it, and a **Compare with** switch (**Budget** or **Quote**) appears. To go back to one plan, select **Delete the budget**. The job is judged by the quote again.

## How Pulse fills in time not on a job

When you let Pulse fill it in, the plan carries the same kind of cost as the actual:

- Under **A fixed percent of labor**: the plan's labor cost times that percent.
- Under the spread rules: the plan's labor cost times your share of time not on a job over labor cost in the last 90 days.
- Under **Keep it off the jobs**: zero.

## Related

- [Compare plan with actual](/docs/pulse/plan-vs-actual)
- [Price a job with the calculator](/docs/pulse/quote-calculator)
- [CSV files and their columns](/docs/pulse/csv-templates)
