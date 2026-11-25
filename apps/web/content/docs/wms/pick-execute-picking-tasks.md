---
title: Execute picking tasks and handle pick shorts
description: Complete picking tasks from Order Operations Task Details, record a partial pick as a pick short, create a resolution job and resolve the short on the order.
section: Outbound
order: 90
---

Every picking job is made of tasks. A picking task names an order, a SKU, a source location and a planned quantity. When a task is executed, the units move from the source location to the target, such as a tote or the packing station, and the order moves to **Picking Started**. If the picker finds fewer units than planned, the task closes as a pick short and KitStak helps you re-pick from somewhere else.

## Before you start

- You need the Execute Task permission.
- The order must be in a picking job. See [Create picking jobs from orders](/docs/wms/job-create-picking-jobs).

## Execute picking tasks

1. Go to **Fulfillment > Order Operations Task Details**.
2. Filter by job code or task type, and select the tasks.
3. Open **Task operations** and choose **Execute** (force-complete from the desktop).
4. Choose the **Target location**, for example the packing station or a staging location.
5. Optionally choose a **Target LPN**, such as a tote.
6. For a single task, check the **Quantity**. The hint shows how many units remain at the source.
7. Select **Execute**.

When you select several tasks, every selected task is executed for its full remaining quantity. Only pending or started tasks can be executed, and all selected tasks must be in one warehouse.

| Field | What it does | Required |
| --- | --- | --- |
| **Target location** | Where the picked units go. | Yes |
| **Target LPN** | The tote or LP that receives the units. | No |
| **Quantity** | Units picked. Single task only. Less than the remaining quantity is a partial execute. | Yes, single task |

## Record a pick short

When you enter less than the remaining quantity, the drawer shows **Partial execute** with the number of units short. On execute:

- A missing log row is written.
- The order's Pick Short Status becomes Open and the order is flagged **Pick short**.
- The job shows an open pick short badge in **Job Management**.

## Create a resolution job

The partial execute panel has a switch: **Create a resolution job to re-pick from another location**. KitStak checks free stock of the SKU elsewhere in the warehouse and turns the switch on when a re-pick is possible.

- On: a resolution job re-picks the short units from another location. The order stays flagged **Pick short** until it is picked. The result toast reads **Pick short · resolution job created** with an **Open job** link.
- Off: the order ships short unless you resolve it later.

The switch stays off, with the reason, when:

- The task is not a picking task tied to an order line.
- The client retains the allocation during missing, so the short stays allocated at the source for investigation.
- The client prevents reallocation of missing stock.
- There is no free stock of the SKU elsewhere in the warehouse.

## Resolve a pick short on the order

1. Go to **Fulfillment > Shipment Orders** and select the orders.
2. Open **Warehouse ops** and choose **Resolve pick short**.
3. Confirm with **Resolve**.

Short lines are reallocated from other locations that have stock. Lines that still can't be filled are reduced to the picked quantity. The action is enabled only when the pick short status is Open.

## Print what the floor needs

- **Print > Pick / pack short label** on the backlog prints an issue label for orders with an open or resolved pick or pack short.
- **Print > Print pick short consolidation** in **Job Management** lists the short lines to re-pick.

## Cancel or change picking tasks

- **Task operations > Update** changes the target location, LPN or job of one pending task.
- **Task operations > Cancel** cancels pending tasks. Cancelled picking tasks release their allocation and reduce or cancel the matching packing, sorting and loading tasks. An order with no picking left goes back to **Open**; a partly cancelled order is flagged pick short. Started and completed tasks are skipped.

## Related pages

- [Manage jobs in Job Management](/docs/wms/job-management)
- [Mobile carts and totes for picking](/docs/wms/pick-mobile-carts-and-totes)
- [Report a pack issue and use hospital locations](/docs/wms/pack-report-issue-and-hospitals)
