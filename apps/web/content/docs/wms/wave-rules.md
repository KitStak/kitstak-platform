---
title: Create and run wave rules
description: Build wave rules that select open orders, allocate stock and create jobs on a schedule or on demand, with filters, release order, job types and assignment.
section: Automation
order: 20
---

A wave rule is a saved recipe for releasing work. Each run selects the open orders that match its filters, allocates stock in the order you set, and builds jobs with the job types you check. Rules run on a schedule, or when you press **Run**. Besides picking waves, rules can build AI jobs, cycle counts, replenishment and order merges.

## Before you start

- You need the Wave Rules view permission. Creating, editing, deleting and running rules each need their own permission.
- For picking waves, the warehouse needs picking job types. See [Picking job types and batch templates](/docs/wms/job-types-for-picking).

## Operation types

| Operation | What a run does |
| --- | --- |
| **Picking** | Selects orders, allocates them and creates picking jobs. |
| **AI job** | Like picking, then regroups the jobs and plans the walk. See [AI job batches and walk ordering](/docs/wms/job-ai-batches-and-walk-order). |
| **Cycle count** | Builds a count plan from the first checked count job type that matches. |
| **Replenishment** | Compares pick faces with their min and max levels and creates replenishment tasks. |
| **Order merge** | Merges orders that match configured criteria. |

## Create a wave rule

1. Go to **Automation > Wave Rules**. It is also a tab on **Fulfillment > Job Management**.
2. Select **Create a new wave rule** and choose the operation type.
3. Fill in **General**, **Selection**, **Schedule** and **Assign**. Order merge rules have no assign step.
4. Select **Save**.

### General

| Field | What it does | Required |
| --- | --- | --- |
| **Rule set name** | The name in lists and logs. | Yes |
| **Warehouse** | The warehouse whose orders the rule selects. | Yes |
| **Priority** | None, Low, Medium, High or Urgent. Given to the jobs. | No |
| **Delete the jobs if not started** | Removes jobs nobody started. | No |
| **Delete method** | **At Specific Time** with a **Delete time**, or **After Hours** with **Hours after creation**. | When delete is on |

Cycle count rules add **Count type** (Location or SKU) and **Lock locations**: counted locations are blocked for picking and putaway until the count is approved. Replenishment rules add **Enable soft allocation for dynamic replenishment**, which reserves the source stock so waves don't allocate it to orders.

### Selection

- **Select job types**: check at least one. Orders are matched to the checked types from top to bottom; drag to change the precedence.
- **Filters**: only orders matching every filter join the wave. Leave empty to select every open order of the warehouse. Fields include **Client**, **Channel**, **Carrier**, **Priority**, **Expected shipment date**, **Order tag**, **SKU**, **Is back order** and custom fields.
- **Order by**: the order release sort, which decides which orders are allocated first when stock is short. Options include **Shipment order date**, **Expected shipment date**, **Priority**, **Order quantity** and **Order price**.

For order merge rules, **Order merge rules** replaces the job types: select at least one rule and drag to set the execution sequence.

### Schedule

1. Under **Days**, pick the weekdays. With no days selected, the rule only runs when you press **Run**.
2. Under **Time**, select **Set time**.
3. Choose **Set specific time** and enter a time, or **Set time period** with **From**, **To** and **Repeat every (minutes)** between 5 and 720.

Times are in the warehouse's time zone. Many runs a day show a high frequency warning, because every run allocates stock and creates jobs.

### Assign

| Option | Who can execute the jobs |
| --- | --- |
| **Add to job pool** | Any user can execute the created jobs from the pool. |
| **Assign to user roles** | The users with the selected roles. |
| **Assign to users** | Only assigned users. Several users share the jobs round-robin. |

## Run a wave now

1. In the wave rule list, select up to 20 rules.
2. Select **Run**.

Long waves keep running on the server. You can keep working in KitStak; a toast with a **View log** link appears when the wave finishes.

## Read the rule list

The list shows **Wave rule name**, **Warehouse**, **Scheduled**, **Status**, **Next run**, **Last run**, **Last wave ID**, **Priority**, **Operation type**, **Assignee** and **Last executed by**. Select **Last wave ID** to see the jobs of that wave. **Show details** lists the recent runs with **Met**, **Allocated**, **Short** and **Jobs**, and shows scheduled runs as **Auto Run**.

## Related pages

- [Wave log and allocation exceptions](/docs/wms/wave-log-and-exceptions)
- [Allocation algorithms and dry run](/docs/wms/allocation-algorithms)
- [Create picking jobs from orders](/docs/wms/job-create-picking-jobs)
