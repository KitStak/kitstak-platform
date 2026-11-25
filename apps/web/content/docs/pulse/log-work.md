---
title: Log a day of work
description: Use the Log work grid to type units, people and hours for every active job on a day, with crew lines, live pace, paste from a spreadsheet and autosave.
section: Logging work
order: 10
---

**Log work** is the daily habit Pulse needs. It lists every active job at a site for one day. For each job you type the units finished, how many people worked on it and the hours each. Pulse works out the labor hours, the labor cost, the pace against the target and the margin for the day as you type.

## Before you start

- Logging needs a supervisor, manager, admin or owner. A supervisor can log and edit the last 7 days.
- A job shows on the grid when it is active and its start day has come. See [Add a job](/docs/pulse/add-a-job).
- A labor rate gives the hours a cost. See [Set labor classes and rates](/docs/pulse/labor-rates).

## Open the day

1. Select **Log work** in the top bar, or press `l`.
2. Pick the day with **Day to log**, or use **Day before** and **Day after** (keys `[` and `]`).
3. If you run more than one site, pick the site.

The tabs under the title are **Day**, **Many days**, **Review the day** and **All entries**.

## Type a row

| Column | What to type |
| --- | --- |
| **Units good** | Good units finished. |
| **Scrap** | Units thrown away. |
| **Rework** | Units done again. |
| **Labor class** | Who did the work. Empty uses the **Default class**. |
| **People** | How many people. |
| **Hours each** | Hours each person worked. |
| **Labor hours** | Filled in as people times hours each. Type over it for an uneven crew, and Pulse works the hours each back out. |
| **Overtime** | Optional. Overtime hours inside the labor hours. They cost more. |
| **Note** | Anything worth knowing. |

**Setup hours** sit in the row's menu. They are part of the labor hours, cost the same, and do not count in the pace, so a changeover day does not make the job look slow.

Every row saves itself. The row shows **Saving**, then **Saved**. The bar at the bottom reads **All changes saved** when nothing is waiting. A row that cannot save shows **Not saved** in red with the reason.

## Crew lines

A job can have one line per labor class, for example packers and a line lead. Open the row menu to:

- **Add a crew line**
- **Duplicate this line**
- **Fill the usual crew** (the job's usual crew by labor class)
- **Clear this line**

Each labor class can have one line per job and day. When the job is linked to a project, each line also has a **Task** and **Task units**.

## Read the pace

A filled row shows its pace in units per person per hour against the target pace:

| Word | When |
| --- | --- |
| **On pace** | At or above the heads up line (95% of target by default). |
| **A bit slow** | Under the heads up line, at or above the at risk line (80% by default). |
| **Too slow** | Under the at risk line. |

Both lines come from **Settings > Cost rules**. Open the row's info button, **How we got this**, for its own numbers: pace, target, goal for the day, earned, labor, material, time not on a job, profit and margin today.

## Checks while you type

- If the hours each that comes out is under 1 or over 16, Pulse asks if it is right, for example: "9.6 labor hours for 12 people is 0.8 hours each. A full shift of 8 hours each would be 96 labor hours. Is that right?" It is a question, not a block.
- A job with units and no labor hours names what is missing: **Add the hours each**, **Add people** or **Add people and the hours each**.
- If someone else changed the row while you typed, Pulse shows **Someone else changed this row. Here is the new one.**

## Work faster

| Tool | What it does |
| --- | --- |
| **Copy yesterday's crew** | Fills people and hours from the last day each job ran, in the last 30 days. |
| **Find a job (F)** | Type part of a job, then `Enter` to go to its row. |
| **Add a job** | Adds a job that is not on the grid yet, with a name, units and a price per unit. |
| Paste | Copy cells in a spreadsheet, click a cell and paste. If the first column holds job numbers, each row goes to its job. The next columns are units, people, hours each and a note. |
| Keys | `Tab` next cell, `Enter` save and move down, arrows move up and down, `Esc` put the row back, `Ctrl` `D` copy the cell above. |

Each row has its own undo, and a paste can be undone in one go.

## The day's totals

The bar shows **Units good**, **Labor hours**, **Jobs logged**, and for people who see money, **Labor cost today**, **Earned today** and **Margin today**. A job with units and no hours is left out of the margin until its hours are in.

## Rows from the warehouse

When a job is linked to a WMS work order, kits built in the warehouse come in as units for that day, marked **From the warehouse**. Add the people and the hours to those rows. Until you do, the job shows **Not enough data**.

## Mark the day complete

When the day is done, select **Mark day complete**. A manager then reviews it. See [Review days and fix entries](/docs/pulse/review-days-and-entries). Once a day is marked complete, only a manager can open it again. Days in a closed month cannot change.

## Worked example (made-up figures)

12 packers work 8 hours each, 4 of the hours overtime. A packer really costs $21.76 an hour and $30.48 in overtime.

- Labor hours: 12 x 8 = 96. Regular: 92.
- Labor cost: 92 x $21.76 + 4 x $30.48 = $2,001.92 + $121.92 = $2,123.84.

## Related

- [Catch up on many days](/docs/pulse/log-many-days)
- [Log time not on a job and paid hours](/docs/pulse/other-time-and-paid-hours)
- [Log work on a floor tablet](/docs/pulse/floor-tablet)
