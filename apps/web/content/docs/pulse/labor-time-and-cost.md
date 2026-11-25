---
title: Read where time and labor cost go
description: Use the Labor Time and Cost tabs to see hours on jobs, time not on a job, paid time not on any job, the payroll check, overtime share and labor cost by class.
section: Costs and rates
order: 20
---

The **Labor** page has three tabs. **Rates** builds the real cost of an hour (see [Set labor classes and rates](/docs/pulse/labor-rates)). **Time** shows where paid time goes. **Cost** shows what labor adds up to. Pick a period at the top of each tab.

## Before you start

- Everyone with a Pulse role sees **Time**. **Cost** shows money, so it needs a role that sees money. **Rates** needs an admin or the owner.

## The Time tab

The less time that goes missing, the more your job profit can be trusted.

| Tile | What it shows |
| --- | --- |
| **Hours on jobs** | People times hours each on every work log row, plus the labor hours typed on extra service entries. |
| **Time not on a job** | Hours typed as cleaning, meetings, training and waiting on parts, with their cost. |
| **Paid time not on any job** | Paid hours minus all logged hours, with the cost of those hours. Shows **Type paid hours to see this** until paid hours exist. |
| **Share of paid time on jobs** | Hours on jobs divided by paid hours. With no paid hours for the days, it is hours on jobs divided by hours on jobs plus time not on a job. |

Below the tiles:

- **Where the hours went, day by day**: each bar is one day of hours on jobs, time not on a job, and paid time not on any job.
- **Time not on a job, by reason**: hours and cost for each reason.
- **Hours by labor class**: on jobs, not on a job and overtime.
- **Add time for a day**: other time and paid hours for a day and site. See [Log time not on a job and paid hours](/docs/pulse/other-time-and-paid-hours).
- **Time punches**: one row per person per day, with **Add a punch**.

### The payroll check

For people who see money, a line under the tiles compares what payroll paid with the pay the logged hours add up to: "Payroll paid $41,200. The hours in Pulse add up to $39,350 of pay. The payroll gap is $1,850: pay that no logged hour explains." When the hours add up to more than payroll paid, Pulse tells you to check for hours typed twice. It shows only for days that have a gross pay typed.

The payroll gap is a different check from paid time not on any job. Paid time not on any job prices each day's missing hours at that day's average pay, so the two can differ by a few dollars.

### Covered against real

When time not on a job is a fixed percent of labor (see [Cost rules and risk limits](/docs/pulse/cost-rules-and-risk-limits)), a line shows what the percent covered against what the time really cost, so you can tune it.

## The Cost tab

| Tile or table | What it shows |
| --- | --- |
| Labor cost on jobs | Every hour logged on a job, times the real cost of an hour for that labor class on that day. Overtime hours cost more. |
| **Real cost of an hour, on average** | Labor cost on jobs divided by labor hours. |
| **Labor as a share of revenue** | Labor cost on jobs divided by the revenue the work earned in the same days. |
| **Overtime share** | Overtime hours divided by all labor hours, on jobs and not on a job. |
| **Labor cost by labor class** | Hours and cost on jobs and not on a job, the cost of an hour and the overtime share, for each class. |
| **Labor cost by job type** | Labor hours and cost for each job type. |
| **Labor cost by client** | Labor hours and cost for each client. |

Every tab can save its rows as a CSV file. Each figure has a **How we got this** button. See [See how Pulse got a number](/docs/pulse/how-we-got-this).

## Related

- [Set labor classes and rates](/docs/pulse/labor-rates)
- [Log time not on a job and paid hours](/docs/pulse/other-time-and-paid-hours)
- [How Pulse does the math](/docs/pulse/how-pulse-does-the-math)
