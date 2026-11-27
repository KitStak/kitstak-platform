---
title: Create picking jobs from orders
description: Turn selected shipment orders into picking jobs by hand with Picking / job operations, choose the job type and batch size, or merge them into a pending job.
section: Outbound
order: 50
---

A picking job groups orders so one picker can collect their stock in one trip. Wave rules create jobs on a schedule. When you want to batch specific orders now, select them in the backlog and use **Picking / job operations**. KitStak allocates any orders that still need stock while it creates the job.

## Before you start

- The warehouse needs at least one job type with the **Picking** operation. See [Picking job types and batch templates](/docs/wms/job-types-for-picking).
- You need permission to create jobs from shipment orders.
- Selected orders must all belong to one warehouse. A picking job belongs to a single warehouse.

## Create a new job

1. Go to **Fulfillment > Shipment Orders**.
2. Select the orders. Only **Open**, **Shortage** or **Ready to Pick** orders without a job can join.
3. Open **Warehouse ops** and choose **Picking / job operations**.
4. Choose **Create new job** (batch the orders into new picking jobs).
5. Check the **Job type**. KitStak preselects the type that matches the most orders.
6. Set the **Batch size**.
7. Optionally pick a user in **Assign to**.
8. Review **Below jobs will be created** and select **Create job**.

| Field | What it does | Required |
| --- | --- | --- |
| **Job type** | A picking job type of this warehouse. Its conditions decide which orders it accepts. | Yes |
| **Batch size** | Orders per job, or units per job when the job type limits by number of items. It must stay inside the range the job type allows. | Yes |
| **Assign to** | The user who executes the jobs. Leave empty and the preview reads **Unassigned · anyone can start it**. | No |

The window runs a live check as you change the fields. Orders the job type rejects appear under **Excluded by the job rules**. Orders without enough stock appear under **Not enough allocatable stock**. When orders split across several jobs, the last job takes the remainder.

## Merge into an existing job

1. Follow steps 1 to 3 above.
2. Choose **Merge into existing job** (add the orders to a pending picking job).
3. Select a job in the list. It shows the job code, type, quantity, progress and assignee.
4. Select **Merge into job**.

Only pending picking jobs of the same warehouse are listed.

## What happens after you save

- **Open** and **Shortage** orders are allocated first. A toast reports how many were allocated.
- Fully allocated orders become **Ready to Pick** and get picking tasks.
- Orders that still lack stock stay in **Shortage** and are listed with their reason.
- If some orders fail, the result reads **Jobs created with exceptions** and names the first failure.

## Other ways to create jobs

- **Wave rules** select and batch orders automatically. See [Create and run wave rules](/docs/wms/wave-rules).
- A shipment plan has **Picking/job operations** for all of its orders. See [Plan truck loads with shipment plans](/docs/wms/ship-shipment-plans).
- **Create backorder** puts the allocated part of short orders into a job. See [Shortages and backorders](/docs/wms/order-shortages-and-backorders).

## Messages you may see

| Message | Meaning |
| --- | --- |
| Select orders from one warehouse. A picking job belongs to a single warehouse. | Your selection spans warehouses. |
| None of the selected orders can get a picking job. | Every order is in a status that can't join a job. |
| No picking job types in this warehouse | Create a picking job type first. |

## Related pages

- [Manage jobs in Job Management](/docs/wms/job-management)
- [AI job batches and walk ordering](/docs/wms/job-ai-batches-and-walk-order)
- [Execute picking tasks and handle pick shorts](/docs/wms/pick-execute-picking-tasks)
