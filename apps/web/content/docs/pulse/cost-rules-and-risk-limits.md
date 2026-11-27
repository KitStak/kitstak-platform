---
title: Cost rules and risk limits
description: Set who buys the parts, the target margin, how time not on a job and company costs are spread, and the limits that make a job Heads up, At risk or Losing money.
section: Settings and access
order: 20
---

**Cost rules** decide how costs land on jobs and when a job counts as needing a heads up, at risk or losing money. Saving a cost rule or a limit recalculates every open month and checks every job again. Closed months do not move.

## Before you start

- Only an admin or the owner can change cost rules.
- Go to **More > Settings** and open **Cost rules**.

## Cost rules

| Field | Options and what they do |
| --- | --- |
| **Who buys the parts** | **We do. Parts are our cost** or **The client does. Parts cost us nothing**. The usual answer. A client, a job or one material row can say otherwise. |
| **Target margin** | The margin you aim for when a job, job type or client has no target of its own. 30% by default. |
| **Time not on a job** | **Spread by labor hours** (jobs share it by the hours they used), **Spread everything, with paid time nobody logged** (also spreads paid hours on no job and no reason), **A fixed percent of labor** (each job carries a set percent on top of its labor) or **Keep it off the jobs** (it shows only in company profit). |
| **Percent on top of labor** | Shown for the fixed percent rule. Each job carries this share of its own labor cost. |
| **Spread it over** | Shown for the two spread rules: **Each day**, **Each week** or **Each month**. A slow day is shared with the busy days of the same period. |
| **Spread company costs by** | **Calendar days** (every day of the month carries the same share, weekends too) or **Work days** (only your working days carry a share). A whole month is the same either way. |

How each rule works, with a worked example, is in [How Pulse does the math](/docs/pulse/how-pulse-does-the-math).

## Risk limits

These limits feed the status rules in [How Pulse judges a job](/docs/pulse/job-status), the pace words on the log grid and the wall display.

| Field | Default | What it does |
| --- | --- | --- |
| **Losing money when margin is heading under** | 10% | The margin floor. A job whose margin is heading under it is marked **At risk**. |
| **At risk when this far under the target** | 10 points | Points of margin below the target that make a job at risk. |
| **Heads up when labor runs over plan by** | 5% | Labor hours over the plan, for the work done so far. |
| **At risk when labor runs over plan by** | 15% | The same, for at risk. |
| **Heads up when pace is under** | 95% | Percent of the target pace. Under it, a log row reads **A bit slow**. |
| **At risk when pace is under** | 80% | Percent of the target pace. Under it, a log row reads **Too slow**. |
| **Heads up when materials run over plan by** | 5% | Material cost per good unit over the plan. |
| **Nothing logged for** | 3 work days | An active job with no entries for this many work days gets a heads up. |
| **Tell me when work not billed yet passes** | $5,000.00 | Earned on finished work, with no invoice against it. Used by the not billed alert. |
| **And it has waited** | | How many days the work has waited before the alert fires. |

> **Note:** The floor field is labeled **Losing money when margin is heading under**, but a job under the floor is marked **At risk**. A job is **Losing money** when it is heading for a loss.

## Worked example (made-up figures)

Your target margin is 30%, the margin floor is 10% and the at risk gap is 10 points.

- A job heading for 26% gets **Heads up**: a little under target.
- A job heading for 18% gets **At risk**: more than 10 points under 30%.
- A job heading for a loss of $400.00 at the finish gets **Losing money**.

## Related

- [How Pulse judges a job](/docs/pulse/job-status)
- [How Pulse does the math](/docs/pulse/how-pulse-does-the-math)
- [Set alert rules](/docs/pulse/alert-rules)
