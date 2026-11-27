---
title: Log time not on a job and paid hours
description: Log meetings, cleanup and waiting as other time, type the hours payroll paid each day, and add time punches so Pulse can find paid time not on any job.
section: Logging work
order: 30
---

Not every paid hour is spent on a job. Meetings, training, cleanup and waiting are real costs. Pulse calls them **Time not on a job** and spreads their cost over the jobs that ran in the same period, so job profit is honest. When you also type the hours payroll paid, Pulse finds paid time that nobody logged anywhere.

## Before you start

- Other time and paid hours need a role that can log work: supervisor, manager, admin or owner.
- How the cost is spread is set in [Cost rules and risk limits](/docs/pulse/cost-rules-and-risk-limits).

## Log other time

You can log other time on **Log work** (under the job rows) or on **Labor > Time** in **Add time for a day**.

1. Under **Other time**, select **Add other time**.
2. Pick the **Reason**: **Meeting**, **Training**, **Cleanup**, **Waiting**, **Maintenance**, **Break** or **Other**.
3. Pick the **Labor class**, or leave **Default class**.
4. Type the people and the **Labor hours**. Labor hours are people times hours each: 6 people in a 30 minute meeting is 3 labor hours.
5. Optionally say what happened, then save.

Each row can be edited or removed. A removal shows an undo toast.

## Type the paid hours for the day

1. Under **Paid hours for the day**, type the **Hours paid**: all the hours the time clock paid at this site that day.
2. Optionally type the **Gross pay for the day**.
3. Save.

When time punches exist for the day, the box says **Filled in from the time punches of this day**. Paid hours by labor class can be imported with the **Paid hours** template.

## Add time punches

A time punch is one person's hours on one day, from your time clock.

1. Go to **Labor > Time** and find **Time punches**.
2. Select **Add a punch**.
3. Type the employee id from your time clock, the hours the person worked, and any overtime. Overtime cannot be more than the hours.
4. Pick the job or the reason. A punch with neither is paid time not on any job.
5. Save. The hours of that day are added up again.

Many punches at once come in with the **Time punches** import. See [CSV files and their columns](/docs/pulse/csv-templates).

## Paid time not on any job

For each site and day: paid hours, less hours on jobs, less time not on a job. It is never below zero. When more hours are logged than paid, the day is marked **More hours logged than paid** instead.

Its cost uses the gross pay of the day when every paid row has one. Otherwise it uses the average pay of an hour for the labor classes of that day, without overhead.

## Worked example (made-up figures)

On Tuesday the time clock paid 120 hours at the main site. The crews logged 104 labor hours on jobs and 10 hours of cleanup and meetings.

- Paid time not on any job: 120 less 104 less 10 = 6 hours.
- Share of paid time spent on jobs: 104 / 120 = 86.7%.

## Where the numbers show

- **Labor > Time** shows hours on jobs, time not on a job and paid time not on any job, day by day. See [Read where time and labor cost go](/docs/pulse/labor-time-and-cost).
- Home shows a **Paid time not on any job** tile.
- Company profit takes the cost of paid time not on any job away from job profit. See [How Pulse does the math](/docs/pulse/how-pulse-does-the-math).

## Related

- [Log a day of work](/docs/pulse/log-work)
- [Cost rules and risk limits](/docs/pulse/cost-rules-and-risk-limits)
- [Read where time and labor cost go](/docs/pulse/labor-time-and-cost)
