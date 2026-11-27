---
title: How Pulse judges a job
description: How Pulse projects where an open job will finish, how sure it is, and the exact rules behind Losing money, At risk, Not enough data, Heads up and On track.
section: Jobs
order: 40
---

Pulse watches every open job and gives it one of five statuses, with the reason in a sentence and a next step. It works this out from your own numbers each time something changes: no nightly run. This page explains how.

## The five statuses

In the order the Jobs page lists them:

| Status | In plain words |
| --- | --- |
| **Losing money** | The job is heading for a loss, or lost money. |
| **At risk** | Well under your target margin, under your margin floor, far over its labor plan, far under the target pace, late, or short of parts. |
| **Not enough data** | Something is missing, so profit is not complete: units with no hours, no price, hours with no rate, or no plan to price the rest of the work. |
| **Heads up** | A little under target, a bit over plan, a bit slow, nothing logged lately, due soon, or no plan to compare with. |
| **On track** | None of the above. |

Planned, on hold and cancelled jobs have no status. A status always shows as an icon and a word, never color alone.

## Three ways to judge a job

| Mode | Which jobs | What Pulse compares |
| --- | --- | --- |
| Projected | Active one time jobs with planned units or plan labor hours. | Where the job will be at the finish. |
| Actuals | Active ongoing jobs, and active jobs with no planned units and no plan hours. | The last 30 days. The job page shows **Last 30 days**. |
| Final | Completed jobs. | The whole job. The job page shows **Final result**. |

## How the projection works

Pulse blends two paces for the rest of the job: the target pace and the pace of the last 5 days that had both units and hours. Days with missing hours, setup hours and time pulled from Projects are left out of pace, so they cannot make it look fast or slow.

- The weight on the real pace grows with the share of the job done (full weight at 20% done) and with the number of such days (full weight at 3 days).
- Units left divided by the blended pace gives the hours left. Hours left times the cost of an hour gives the labor to come.
- Material, time not on a job and extra services to come follow what each unit has cost so far. Other cost to come is what the plan still has left.
- The finish date counts your working days from today at the units per day the crew has been making.

The confidence word says how much to trust it:

| Word | When |
| --- | --- |
| **Based on the plan** | No day with units and hours yet. |
| **Early guess** | One such day, or less than half weight on the real pace. |
| **Good read** | Half weight or more. |
| **Solid** | Full weight and at least 3 such days. |

When there is no plan and Pulse cannot price the rest of the work, it says the projection is not known yet instead of showing zero.

## The rules

Rules are checked in groups: Losing money first, then At risk, then Not enough data, then Heads up. The first group with a rule that matches sets the status. Losing money and At risk win over Not enough data, because missing hours can only make the real number worse. The limits marked as a setting can be changed in [Cost rules and risk limits](/docs/pulse/cost-rules-and-risk-limits).

| Status | Rule | Default |
| --- | --- | --- |
| **Losing money** | Projected profit is under zero, after 2 days of data or 20% done. | |
| **Losing money** | A completed job lost money. | |
| **Losing money** | Ongoing work lost money in the last 30 days, with entries on 5 or more days. | |
| **At risk** | Margin is heading this far under the target. | 10 points (setting) |
| **At risk** | Margin is heading under the margin floor. | 10% (setting) |
| **At risk** | Labor hours are heading this far over plan, and margin is under target. | 15% (setting) |
| **At risk** | Pace of the last 5 work days is under this share of the target pace, and margin is under target. | 80% (setting) |
| **At risk** | At this pace the job finishes after its due date. | |
| **At risk** | A linked warehouse work order is short of parts. | |
| **Not enough data** | One or more days have units and no hours. | |
| **Not enough data** | The job has no price yet. | |
| **Not enough data** | Some hours have no labor rate. | |
| **Not enough data** | No plan yet, and Pulse cannot price the work still to do. | |
| **Heads up** | Margin is heading a little under the target. | |
| **Heads up** | Labor hours are heading this far over plan. | 5% (setting) |
| **Heads up** | Pace of the last 5 work days is under this share of the target pace. | 95% (setting) |
| **Heads up** | Material cost per good unit is this far over the plan. | 5% (setting) |
| **Heads up** | Nothing logged for this many work days. | 3 (setting) |
| **Heads up** | Due in 3 work days or less and under 90% done. | |
| **Heads up** | No cost plan to compare with. | |
| **Heads up** | More units made than planned. | |

## Which reason comes first

Each reason that matches carries how much it moves projected profit. The reason that costs the most is the headline. Up to three reasons show on the job, each with a next step:

- **Check the crew size**
- **Review the price with the client**
- **See why profit changed**
- **Log the missing days**
- **Add a labor rate**
- **Add the hours**
- **Add a price**
- **Add a quote or a budget**
- **Update the plan or finish the job**
- **Check material use and scrap**
- **Talk to the client about the due date**
- **Check the parts with the warehouse**

## Worked example (made-up figures)

A 10,000 unit job at $1.75 a unit, with a target margin of 30%. The plan is 250 labor hours. After 4,000 units, the last 5 days made 1,600 units in 50 labor hours, so the pace is 32 units per person per hour and the read is **Solid**.

- Units left: 6,000. Hours left: 6,000 / 32 = 187.5. Labor hours at finish: 125 + 187.5 = 312.5.
- Projected revenue $17,500.00, projected cost $13,587.50, projected profit $3,912.50, margin 22.36%.
- Labor check: 312.5 is more than 250 plus 15% (287.5), and 22.36% is under 30%: **At risk**.
- The headline reads "Labor is heading 25% over the plan." Margin a little under target also matches, but it costs less.

## Related

- [Use the Jobs list](/docs/pulse/jobs-list)
- [Cost rules and risk limits](/docs/pulse/cost-rules-and-risk-limits)
- [Compare plan with actual](/docs/pulse/plan-vs-actual)
