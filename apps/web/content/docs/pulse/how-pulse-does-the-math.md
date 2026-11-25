---
title: How Pulse does the math
description: The Pulse cost model in plain words: money in, the four buckets of money out, profit and margin, how time not on a job is shared, and job profit versus company profit.
section: Profit
order: 30
---

Pulse does plain math on your own numbers. This page is the whole cost model in plain words, with worked examples. The same summary is in Pulse under **Settings > How Pulse does the math**.

## Money in

What the client pays: the price per unit times units finished, plus any extra services, plus other fees, less credits. Revenue is **earned** when the work is done. Invoices are a record of what was **billed** and never change profit. **Not billed yet** is earned less billed.

## Money out: four buckets

| Bucket | How it is worked out |
| --- | --- |
| Labor | Labor hours times the real cost of an hour. Overtime hours cost the overtime rate. |
| Materials | Parts and supplies you pay for, scrap included. Parts the client supplies cost nothing. |
| Other costs | Freight, packaging, outside help, typed in on a job or a client. |
| Time not on a job | Meetings, cleanup and waiting, spread across the jobs that ran. |

- **Profit** = money in less money out.
- **Job margin** = profit on jobs as a share of revenue.
- **Before time not on a job** = revenue less labor, material and other costs, as a share of revenue. It shows what a job earns on its own.
- **Cost per unit** = all cost over good units.

When revenue is zero, Pulse shows **No revenue yet** instead of a margin.

## How time not on a job is shared

**Settings > Cost rules > Time not on a job** picks the rule:

| Rule | What it does |
| --- | --- |
| **Spread by labor hours** | The cost of time not on a job in a period is shared over the jobs of the same site and period, by the labor hours each used. |
| **Spread everything, with paid time nobody logged** | The same, but paid time on no job and no reason is spread too, so jobs carry all paid time. |
| **A fixed percent of labor** | Each job carries a set percent of its own labor cost. |
| **Keep it off the jobs** | Jobs carry none. It shows only in company profit. |

The period is **Each day**, **Each week** or **Each month** (**Spread it over**). A week that crosses a month end is split at the month boundary, so a closed month never changes. Production and extra service entries with hours take a share. When a period has cost and no job ran, that cost stays with the company.

### Worked example (made-up figures)

A week has $100.00 of time not on a job. Three jobs logged 96.00, 40.00 and 24.50 labor hours, 160.50 in all.

- Job 1: $100.00 x 96 / 160.5 = $59.81.
- Job 2: $100.00 x 40 / 160.5 = $24.92.
- Job 3: $100.00 x 24.5 / 160.5 = $15.27.

The left over cent goes to the row with the largest remainder, so the shares always add up to the pool exactly.

## Job profit and company profit

These are two numbers. Jobs carry the costs you put on them. The company also pays for rent, salaried staff and paid time nobody logged. Pulse shows the walk from one number to the other, line by line:

| Line | What it is |
| --- | --- |
| **Profit on jobs** | Profit on jobs and on rows put on a client with no job. |
| **Time not on a job that no job carried** | Time not on a job that was not spread to a job. |
| **Paid time not on any job** | Paid hours nobody logged to a job or a reason. Zero under the spread everything rule, because it is already on the jobs. |
| **Overhead your hourly rate did not cover** | Company costs less the overhead your hourly rates already covered. When the rates covered more, the line reads **Your hourly rate covered more overhead than you spent** and adds to profit. |
| **Company profit** | Profit on jobs less the lines above. **Company margin** is company profit as a share of revenue. |

With no company costs typed for a month, Pulse trusts the overhead inside your hourly rates for that month, and the overhead line is left out.

### Company costs for part of a month

Company costs are typed by month. For a part of a month, Pulse counts a share by day, by calendar days or by work days (**Settings > Cost rules > Spread company costs by**). The parts of a month always add back to the whole month to the cent, so month close is the same either way.

Example (made-up figures): November company costs are $70,500.00. November 1 to 18 by calendar day counts $70,500.00 x 18 / 30 = $42,300.00. November 19 to 30 gets the other $28,200.00.

## One place per cost

Put each cost in one place only. A supervisor's pay goes either in overhead per hour or in company costs, never both. Otherwise it counts twice.

## Rounding and history

- Money is kept in whole cents and rounded once, half away from zero, so every total equals the sum of its rows to the cent.
- Each entry keeps the cost and revenue worked out when it was saved. A new rate, price or rule works the entries out again only from its start day, and only in open months.
- When a month is closed its numbers stop moving. See [Close a month](/docs/pulse/close-a-month).

## Related

- [See how Pulse got a number](/docs/pulse/how-we-got-this)
- [Set labor classes and rates](/docs/pulse/labor-rates)
- [Cost rules and risk limits](/docs/pulse/cost-rules-and-risk-limits)
