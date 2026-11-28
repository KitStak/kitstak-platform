---
title: Labor planning
description: How Crew is planned to turn planned units and target pace into hours and people needed for each day, compare that with the schedule and show the gap.
section: Planning
order: 10
---

> **Note:** Crew is planned and not available yet. This page describes how it is planned to work, and details may change before launch.

The labor plan answers one question: how many people does the planned work need, and do you have them? Crew is planned to work it out for each day and site, and show the gap beside the schedule.

## How the plan does the math

```
hours_needed  = planned_units / target_units_per_labor_hour + setup_hours + indirect_allowance
people_needed = ceil(hours_needed / shift_length)
gap           = people_needed - people_scheduled
```

In words:

1. Take the units planned for the day and divide by the target pace, how many units one person finishes in an hour. That gives the hours of direct work.
2. Add setup hours for the jobs that run, and an allowance for time not on a job, like cleanup and meetings.
3. Divide the total hours by the length of a shift and round up. That is the people needed.
4. Take away the people already scheduled. What is left is the gap.

Setup hours and time not on a job count the same way they do in Pulse, so the plan and the cost model agree.

## An example

| Line | Value |
| --- | --- |
| Units planned | 1,200 kits |
| Target pace | 20 kits per person per hour |
| Direct hours | 60 |
| Setup and time not on a job | 8 |
| Hours needed | 68 |
| Shift length | 8 hours |
| People needed | 9 |
| People scheduled | 7 |
| Gap | 2 people short |

## Where the numbers come from

| Number | Source |
| --- | --- |
| Planned units and due dates | Projects programs and builds. |
| Warehouse work | WMS work orders, inbound receipts and order volume due. |
| Target pace and setup | Pulse target pace and actual units per person per hour. |
| Early warning | CRM won deals with a start date, like three new programs in January. |
| People scheduled | The Crew schedule. |

Each source is optional. With none of them, you type the planned units yourself.

## The cost of closing the gap

When the plan is short, Crew is planned to show what calling in temps would cost, using the real cost of an hour for their labor class. If you use Pulse, that rate comes from Pulse, so a rate never lives in two places. Without Pulse, Crew uses a plain wage per person for its own estimates.

## Related

- [Shifts and the schedule](/docs/crew/shifts-and-schedule)
- [How Crew connects to the other apps](/docs/crew/connected-apps)
