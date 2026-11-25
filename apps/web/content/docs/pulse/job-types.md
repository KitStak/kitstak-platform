---
title: Set up job types
description: Add job types like kitting, relabeling or returns, with a unit word, usual pricing, labor class, target pace and target margin for each new job.
section: Jobs
order: 50
---

A job type is a kind of work you do, like kitting, relabeling or returns. It gives a new job its unit word, its usual pricing and its target margin, and it lets you compare profit by kind of work on the **Job types** tab of Profit.

Every workspace starts with the built in job type **General**. Quick add uses it.

## Before you start

- Adding and changing job types needs an admin or the owner, because they live in Settings.

## Add a job type

1. Go to **More > Settings** and open **Job types**.
2. Select **Add a job type**.
3. Fill in the fields below.
4. Select **Add job type**.

| Field | What to type |
| --- | --- |
| **Name** | The kind of work, like Kitting. |
| **Short code** | Used in files and reports. Leave it empty and Pulse makes one. |
| **What one unit is called** | Like kits, cases or pallets. |
| **Usual pricing** | The pricing a new job of this type starts with: price per unit, one fixed price or price per labor hour. |
| **Usual labor class** | Who normally does this work. |
| **Target pace** | Units one person finishes in an hour. |
| **Target margin** | Leave it empty to use the company target. |

## Change, archive or delete a job type

Each row has **Edit**, **Archive** and **Delete**.

- **Archive** keeps the job type off new jobs. **Bring back** undoes it.
- A job type that jobs still use cannot be deleted. Archive it instead.

## Where job type settings are used

- **Target pace**: a job uses its own target pace first. Without one, it uses the best matching target pace row, then its plan, then the job type's target pace. See [Set a target pace](/docs/pulse/target-pace).
- **Target margin**: a job uses its own target first, then its job type's, then its client's, then the company target in **Cost rules**.

## Import job types

Use the **Job types** template in Import and export. See [CSV files and their columns](/docs/pulse/csv-templates).

## Related

- [Add a job](/docs/pulse/add-a-job)
- [Explore profit](/docs/pulse/profit-explorer)
- [Workspace settings](/docs/pulse/workspace-settings)
