---
title: Create count jobs
description: Turn count plans into count jobs in KitStak WMS, split them by batch size, assign a counter or leave them in the job pool.
section: Counts
order: 30
---

Counters work on count jobs, not on plans. **Create Job** splits one or more pending count plans into jobs of a set number of locations, and either assigns them to a counter or leaves them in the job pool for anyone to take. The plans then move to **Ready to Count**.

## Before you start

- You need the **Create Job** permission on **Count Plans**.
- The warehouse needs an active Count job type. Count job types are set up in **Settings > Configuration > Job Types**.
- The plans must be **Pending**, and all from one warehouse.

## Create count jobs

1. Go to **Inventory > Count Plan**.
2. Select one or more pending plans, then select **Create Job**. Or use **Create Job** in a plan's row menu.
3. In **Create New Job**, fill in the fields below.
4. Check the **Jobs preview** under **Below jobs will be created**.
5. Select **Save**.

| Field | What it does | Required |
| --- | --- | --- |
| **Job Type** | One of the warehouse's Count job types. Its settings decide how the count runs. | Yes |
| **Batch Size (Location)** | How many locations each job contains, so one plan can be split across several counters. A whole number from 1 to 1000. | Yes |
| **Assign to** | A counter in this warehouse. Leave it empty to leave the jobs in the job pool. | No |

The footer shows how many people are assigned and the total number of jobs. Jobs equal locations divided by batch size, rounded up. SKU counts expand to one line per stocked location.

## What blocks Save

| Message | What to do |
| --- | --- |
| **Select plans from one warehouse** | Job types belong to one warehouse. Select plans of one warehouse only. |
| **Create a Count job type first** | The warehouse has no Count job type yet. |
| **Choose a job type** | Pick a job type. |
| **Batch Size (Location): at least 1** | Enter a batch size of 1 or more. |
| **Only pending count plans, or plans whose count job was cancelled, can get a job** | The plan already has jobs. |

## Count job type settings

The job type you pick carries these count settings:

| Setting | Effect |
| --- | --- |
| **One by one count** | Each unit is scanned during the count. |
| **Auto-update no-difference count lines** | Lines whose count matches the system are approved automatically. |
| **Instant count** | Counts can be started from the handheld without a count plan. |
| **Lock location for instant count** | Blocks the location while an instant count runs. |
| **Auto fill tracking attributes** | Lot, expiry and serials are pre-filled from the system stock. |

## Re-create a cancelled count job

If a count job is cancelled while the plan is **Ready to Count** or **Count Started**, its lines are left without a count task. The plan says how many lines have no count task. Select **Create Job** again: the dialog is titled **Re-create count job** and re-issues those lines to counters. Or cancel the lines to release their locations.

## After the jobs are created

- Counters see their jobs on the handheld under **Your jobs**, and unassigned jobs under **Job pool**. See [Enter counts on the count sheet](/docs/wms/count-sheet).
- Each job's count tasks are listed in **Fulfillment > Count Task Details**. See [Task details](/docs/wms/task-details).

## Related pages

- [Count plans](/docs/wms/count-plans)
- [Create a count plan](/docs/wms/create-count-plan)
- [Enter counts on the count sheet](/docs/wms/count-sheet)
