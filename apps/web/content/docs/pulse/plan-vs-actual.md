---
title: Compare plan with actual and see why profit changed
description: Read Plan vs actual and Quote vs actual for a job, scale the plan to the work done, and split the profit gap by cause in the Why profit changed chart.
section: Quote vs actual
order: 20
---

The **Plan vs actual** tab puts the plan next to what happened for units, hours, each cost, revenue and margin. For an open job, the plan is scaled to the work done so far, so a half done job is judged fairly. Below the table, **Why profit changed** splits the gap between plan profit and actual profit by cause, and the bars always add up.

## Before you start

- The job needs a quote or a budget. See [Add a quote or a budget](/docs/pulse/quotes-and-budgets).
- The tab is hidden from roles that do not see money.

## Pick what to compare

1. Open the job and go to **Plan vs actual**.
2. Under **Which view**, pick **Plan vs actual** or **Quote vs actual**.
3. When a budget exists, **Compare with** switches between **Budget** and **Quote**.
4. Under **How much of the plan**, pick **For the work done so far** (the default for an open job) or **Whole job**.

The words above the table say which plan you are reading, for example **There is no budget yet, so your plan is the quote.**

## Read the table

Rows: **Units**, **Labor hours**, **Units per person per hour**, **Labor cost**, **Material cost**, **Other cost**, **Time not on a job**, **Total cost**, **Revenue**, **Profit** and **Margin**.

| Column | What it shows |
| --- | --- |
| Plan | The quote or budget, for the work done so far or the whole job. |
| **Actual** | What happened. |
| **Difference** | Actual less plan. |
| **Difference %** | The difference as a share of the plan. Blank when the plan is zero. |
| **Projected at finish** | Where the job is heading. Left out when there is no projection. |

Each row is marked good or bad. Costs and hours are bad when actual is above plan. Revenue, profit, units and pace are bad when actual is below plan. A row that matches reads **On plan**.

## How the plan is scaled to the work done

The share of the job that is done is good units over plan units. A plan with no units uses labor hours over plan hours. With neither, the whole job is used.

- Units, revenue, material and time not on a job scale with that share.
- Labor hours and labor cost scale too, except setup, which is counted whole.
- Other cost is not scaled. It is compared whole.

The share can go above 100% when more units are made than planned.

## Why profit changed

Under **Which gap**, pick:

| Mode | When | From and to |
| --- | --- | --- |
| **So far** | Open jobs. The default. | From the plan for the work done to actual profit. |
| **At finish** | Open jobs. | From the whole plan to projected profit, with a volume bar. |
| Whole job | Completed jobs. | From the whole plan to final profit, with a volume bar. |

Each bar is one cause. Bars above zero helped profit, bars below hurt it.

| Bar | What it measures |
| --- | --- |
| **Volume** | Making more or fewer units than the whole plan. |
| **Price** | Revenue against the plan's revenue. |
| **Labor rate** | Each hour cost more or less than the plan's cost of an hour. |
| **Labor efficiency** | The crew needed more or fewer hours than planned, at the plan's cost of an hour. |
| **Scrap** | The cost of scrapped parts. |
| **Material** | Material, scrap left out, against the plan. |
| **Time not on a job** | The job's share against the plan. |
| **Other** | Everything else, so the bars add up exactly to the gap. |

Beside the chart, Pulse names **The gap**, the **Biggest drag** and the **Biggest lift**, each in a plain sentence.

## Worked example (made-up figures)

Budget: 10,000 units, revenue $17,500.00, 250 hours, labor $5,500.00, material $4,500.00, time not on a job $500.00, other $1,000.00, profit $6,000.00. So far: 4,000 units, revenue $7,000.00, 125 hours, labor $2,875.00, material $1,900.00 of which scrap $90.00, time not on a job $260.00, other $400.00, profit $1,565.00.

The job is 40% done, so the plan for the work done is revenue $7,000.00, 100 hours, labor $2,200.00 ($22.00 an hour), material $1,800.00, time not on a job $200.00, other $1,000.00, profit $1,800.00.

| Bar | Math | Amount |
| --- | --- | --- |
| Price | 7,000 less 7,000 | $0.00 |
| Labor rate | 2,875 less 125 x 22, as a loss | -$125.00 |
| Labor efficiency | 25 extra hours x 22, as a loss | -$550.00 |
| Scrap | 90, as a loss | -$90.00 |
| Material | 1,810 less 1,800, as a loss | -$10.00 |
| Time not on a job | 260 less 200, as a loss | -$60.00 |
| Other | what is left | $600.00 |
| Total | 1,565 less 1,800 | -$235.00 |

The labor efficiency bar reads like: "the crew needed 25 more hours than planned for this many units."

## Quote lines and the budget strip

On **Quote vs actual**, when the quote has lines, **Quote lines against actual** lists each **Line**, its **Kind**, what was **Quoted** and the **Actual so far**. While the job runs, actual is less than the whole quote, so the colors come on when the job is complete. When a budget exists, **From the quote to your budget** shows the gap between what was sold and what was planned.

## Reports

The **Plan vs actual**, **Quote vs actual** and **Why profit changed** reports show the same numbers across many jobs. See [Run a report](/docs/pulse/ready-made-library).

## Related

- [Add a quote or a budget](/docs/pulse/quotes-and-budgets)
- [How Pulse judges a job](/docs/pulse/job-status)
- [Price a job with the calculator](/docs/pulse/quote-calculator)
