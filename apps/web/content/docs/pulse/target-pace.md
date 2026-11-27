---
title: Set a target pace
description: Set how many units one person should finish in an hour by job type, client, labor class or service, use a suggestion, and track pace.
section: Goals and pace
order: 10
---

A target pace is your yardstick: for example 42 units per person per hour for kitting. With a target, Pulse can tell you the moment a crew falls behind, and what that costs. The log grid, the job page, the wall display and the risk rules all compare pace with it.

## Before you start

- Setting targets needs a manager, admin or owner. Everyone else sees pace against the targets.
- Pace is good units divided by labor hours on days that have both. Setup hours and time pulled from Projects are left out, so a changeover day does not make the job look slow.

## Add a target pace

1. Go to **More > Target pace**.
2. Select **Add a target pace**.
3. Under **What the target is for**, pick a **Job type** or an **Extra service**.
4. Optionally narrow it to **One client** (for a client that runs faster or slower) and to **One class** of labor.
5. Type the units per person per hour.
6. Pick **Starts on**. Days before it keep the older target.
7. Select **Add the target**.

**Targets with a start day** lists every target with what it is for, the client, the labor class, the pace, the start day and **Where it came from**: **Typed in**, **From history** or **Time study**. Each row can be edited or removed. After a save, jobs it applies to are checked against it again.

## Take a suggestion from your history

Once about 20 days are logged, **Suggested from your history** shows, for each job type:

| Column | What it shows |
| --- | --- |
| **Target now** | The target in use, if any. |
| **History says** | The median pace of the last 20 days with units and hours. |
| **Slowest to fastest day** | The spread, so you can see how steady the work is. |
| **Based on** | How many days. |

Select **Use it** to make the suggestion the target.

## Set a target for one job

Under **Target pace for one job**, pick a job and type its own target. You can also type it on the job's **Edit** dialog. Blank uses the pace for its kind of work.

## Which target a job uses

1. The job's own target pace.
2. Else the best matching target row that started on or before the day. A row for the job's client wins over one for all clients, then a row for the job's labor class wins over one for all classes, then the latest start day.
3. Else the plan: planned units over planned labor hours less setup hours.
4. Else the target pace set on the job type in Settings.

## Pace against target

**Pace against target** shows how the floor did in the period. Group it **By job**, **By labor class** or **By day**. 100% means the crews ran right at their target pace. Each job is measured against its own target. A row with no target says **Set a target for the job**.

## Worked example (made-up figures)

A crew made 1,600 kits in 50 labor hours on its last five days. Pace: 1,600 / 50 = 32 kits per person per hour. With a target of 40, that is 80% of target. On the log grid that row reads **A bit slow** with the default lines (heads up under 95%, at risk under 80%).

## Related

- [Set goals and track them](/docs/pulse/goals)
- [Log a day of work](/docs/pulse/log-work)
- [How Pulse judges a job](/docs/pulse/job-status)
