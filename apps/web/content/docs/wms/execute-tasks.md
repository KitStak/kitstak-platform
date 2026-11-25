---
title: Execute, update and reassign tasks
description: Force-complete, re-route, cancel, assign, unassign and recount tasks from the KitStak WMS Task Details pages on the desktop.
section: Tasks
order: 20
---

Most tasks are done on the floor with a handheld. When a task gets stuck, a supervisor can finish it, send it to another location, LP or job, cancel it, or give it to someone else from the desktop. This page covers each action and the rules behind it.

## Before you start

- **Execute** needs **Execute Task** on **Task Details**. **Update**, **Assign** and **Unassign** need **Update Task**. **Cancel** needs **Cancel Task**.
- **Recount** on count tasks needs **Create Recount** on **Count Location Details** or **Count SKU Details**.
- Open the right page first. See [Task details](/docs/wms/task-details).

## Execute tasks

Execute force-completes tasks from the desktop.

1. Select one or more **Pending** or **Started** tasks of one warehouse.
2. Select **Task operations > Execute**. The **Execute task** drawer lists the task IDs.
3. Optionally choose a **Target location** and **Target LPN**.
4. For one task, set the **Quantity**. The drawer shows the remaining quantity and the source location. For several tasks, each is executed for its full remaining quantity.
5. Select **Execute**.

### Execute less than the full quantity

When you execute one task for less than its remaining quantity, the drawer warns **Partial execute** with the number of units short:

- A missing-log row is written, **Pick Short Status** becomes **Open** and the order is flagged pick short.
- For a picking task, you can tick **Create a resolution job to re-pick from another location**. Without a resolution job the order ships short.

When a resolution job is created, the message **Pick short · resolution job created** offers **Open job**.

## Update a task

Update re-routes one pending task.

1. Select exactly one **Pending** task.
2. Select **Task operations > Update**.
3. In **Update task**, change the **Target location**, the **To LPN** or the **Job code**.
4. Select **Save**.

## Cancel tasks

1. Select tasks. Only **Pending** tasks are cancelled; started and completed ones are skipped.
2. Select **Task operations > Cancel**, or **Cancel task** on the replenishment page, or **Cancel** on the count page.
3. Confirm **Cancel task** or **Cancel tasks**.

Cancelled picking tasks release their allocation and reduce or cancel the matching packing, sorting and loading tasks. An order with no picking left goes back to **Open**. A partly cancelled order is flagged pick short.

## Assign or unassign tasks

1. Select open tasks of one warehouse.
2. Select **User actions > Assign**, or **Assign > Assign** on the count page.
3. In **Assign user**, search a user with at least 3 characters and confirm.

To take tasks back to the pool, select **Unassign** and confirm **Unassign the selected tasks?** with **Unassign**, or keep them with **Keep assigned**.

If the selected tasks are in different warehouses, the dialog **Different warehouses selected** explains that assign and unassign only work for tasks in the same warehouse.

## Recount count tasks

1. On **Count Task Details**, select completed count tasks.
2. Select **Recount** and confirm **Create recount**.

Each counted line is marked **Recount Created** and a new count task is planned for the same location. If the recount is cancelled, the original result can still be posted. See [Update inventory from counts](/docs/wms/update-inventory-from-counts).

## Why an action is disabled

| Message | Cause |
| --- | --- |
| **Select at least one task** | Nothing is selected. |
| **Only pending or started tasks can be executed** | A selected task is closed. |
| **Select tasks of one warehouse** | Execute needs one warehouse. |
| **Select exactly one task to update** | Update works on one task. |
| **Only pending tasks can be updated** | The task has started or closed. |
| **Only pending tasks can be cancelled** | None of the selected tasks is pending. |
| **Closed tasks can't be assigned** | None of the selected tasks is open. |
| **None of the selected tasks is assigned** | There is nothing to unassign. |
| **Only completed count tasks can be recounted** | A selected count task is not completed. |
| **You don't have permission for this action** | Your role lacks the permission. |

## Related pages

- [Task details](/docs/wms/task-details)
- [Count plans](/docs/wms/count-plans)
- [Update inventory from counts](/docs/wms/update-inventory-from-counts)
