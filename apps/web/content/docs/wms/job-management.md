---
title: Manage jobs in Job Management
description: Find, prioritize, assign and cancel picking jobs, print pick lists and cart layouts, and read a job's orders, tasks, pick path and timeline.
section: Outbound
order: 60
---

**Job Management** lists every job in your warehouses: picking jobs from waves and manual batches, work order picking jobs, counts and replenishment. Supervisors use it to set priority, hand jobs to pickers and print what the floor needs. Open a job to see its orders, tasks and the route through the warehouse.

## Before you start

- You need the Job Management view permission to open the page.
- Priority, assignment and cancel are supervisor actions. Floor users see "Supervisor permission required. Ask a supervisor to change job priority, assignment or cancel jobs."

## Find a job

1. Go to **Fulfillment > Job Management**.
2. The grid opens filtered to **Job status** Pending and Started. Remove the chip to see closed jobs.
3. Search by job code, or use the **Overdue** quick filter.

Key columns:

| Column | What it shows |
| --- | --- |
| **Job code** | Opens the job. |
| **Alerts** | Open pick short and overdue badges. |
| **Status** | Pending, Started, Completed or Cancelled. |
| **Priority** | None, Low, Medium, High or Urgent. |
| **Job type** | The job type that built the job. AI jobs show a sparkle icon. |
| **Wave no** and **Wave rule name** | The wave that created the job, if any. |
| **Order count**, **Number of tasks**, **No. of pending picking tasks** | Size and progress. |
| **Mobile cart** | The cart the job uses, if any. |
| **Planned start date** and **Planned finish date** | The plan. A job past its planned finish is overdue. |

## Job statuses

| Status | Meaning |
| --- | --- |
| **Pending** | Created; no task has started. |
| **Started** | At least one task has started or completed. |
| **Completed** | Every task is done. Completed jobs can't be changed. |
| **Cancelled** | The job was cancelled. Cancelled jobs can't be changed. |

## Act on selected jobs

Select one or more jobs. Closed jobs take no assignment, label or pick list work.

| Toolbar | Action | What it does |
| --- | --- | --- |
| **Update priority** | None to Urgent | Sets the job priority. |
| **User actions** | **Assign** | Gives the jobs to a user. |
| **User actions** | **Unassign** | The jobs go back to the job pool; any picker can take them. |
| **Label** | **Create label** | Buys a shipping label for every order in the jobs. |
| **Label** | **Reprint label** or **Void label** | Opens or voids the active labels. Labels apply to picking jobs only. |
| **Print** | **Print job pick list** | Walking-path order, with check boxes. |
| **Print** | **Print job content** | Every task of the job. |
| **Print** | **Print pick short consolidation** | Short lines to re-pick. Needs an open pick short. |
| **Print** | **Mobile cart layout** | Which order goes in which cell. Needs a mobile cart. |
| **Print** | **Print packing list** | One page per order. |
| **Cancel** | **Cancel job** | See below. |

## Cancel a job

1. Select the jobs and select **Cancel**.
2. Read the **Attention** window and select **Cancel job** (or **Cancel jobs**).

All pending tasks are cancelled and all allocations are released. Orders not yet picked go back to **Open**. Work that is already picked is kept, with its packing and loading tasks.

## Read a job

Select a job code. The header shows **Assignee**, **Wave**, **Wave rule**, **Mobile cart**, **Planned start**, **Planned end**, **Actual start**, **Actual finish**, **Label status**, **Pick list** and a **Job progress** bar by task type. The tabs are:

- **Orders**: each order with units, picked, packed, tasks, pick short and label.
- **Tasks**: every task with source, target, planned and actual quantity, assignee and who executed it.
- **Pick path**: the stops in walking order, one card per location, with the SKUs and units to pick.
- **Timeline**: what happened to the job and when.

## Remove an order from a job

1. On the **Orders** tab, select the remove icon next to the order.
2. Confirm with **Remove from job**.

Its pending tasks are cancelled. The order keeps its allocation and can be added to another job. You can't remove an order once picking started for it; the message reads "Picking already started for this order. Finish or cancel its tasks first."

## Related pages

- [Create picking jobs from orders](/docs/wms/job-create-picking-jobs)
- [AI job batches and walk ordering](/docs/wms/job-ai-batches-and-walk-order)
- [Mobile carts and totes for picking](/docs/wms/pick-mobile-carts-and-totes)
