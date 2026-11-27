---
title: Hold, release, cancel and delete orders
description: Put shipment orders on hold, release them, cancel them with a reason, change their warehouse or delete them, and learn which statuses allow each action.
section: Outbound
order: 30
---

Use holds to stop an order without losing it, and cancellation to close it for good. You can act on one order from its detail page, or on many orders at once from the **Order Backlog**. Each action checks the order status first and tells you why an order was skipped.

## Before you start

- Each action needs its own permission. A menu item you can't use shows "You don't have permission for this action".
- Cancel reasons come from Data Setup. If none exist, the cancel window shows **No cancel reasons in Data Setup**.

## Put orders on hold

1. Go to **Fulfillment > Shipment Orders**.
2. Select one or more orders.
3. Open **Warehouse ops** and choose **Put on hold**.
4. Optionally enter a **Hold reason**, up to 500 characters, for example "Address check with customer".
5. Confirm.

An order on hold can't be allocated, picked or shipped. The order page shows **This order is on hold** with the reason, who held it and when.

You can hold orders in **Open**, **Shortage**, **Ready to Pick**, **Ready to Sort**, **Ready to Pack**, **Ready to Load** and **Ready to Ship**. If none of the selected orders qualifies, the menu item reads "None of the selected orders can be put on hold."

## Release a hold

1. Select the held orders.
2. Open **Warehouse ops** and choose **Release hold**.

The order returns to the status it had before the hold. Only orders in **On Hold** can be released.

## Cancel orders

1. Select the orders.
2. Open **Warehouse ops** and choose **Cancel order**.
3. Choose a **Cancel reason**. It is required.
4. Optionally add a **Note** for the change log.
5. Select **Cancel order** (or **Cancel orders**).

Allocated inventory is released and each order gets a change log entry. Only orders that have not started picking and have no job can be cancelled: **Open**, **Shortage**, **Ready to Pick** and **On Hold**. A cancelled order moves to **Shipped & Canceled Orders** and its detail page shows the **Cancel reason**.

> **Tip:** If an order is already in a picking job, use **Cancel picking** first. Pending picking and packing tasks are cancelled, the order leaves its job, its stock is deallocated and it goes back to **Open**.

## Change warehouse

1. Select the orders.
2. Open **Warehouse ops** and choose **Change warehouse**.
3. Choose the new **Warehouse** and select **Change warehouse**.

Only **Open**, **Shortage** and **On Hold** orders move. Orders that have a picking job are skipped and listed in the result, for example "2 of 3 moved, 1 skipped". Moving orders may cause shortage in the new warehouse.

## Delete an order

1. Select the orders.
2. Open **Delete** and choose **Delete shipment order**.
3. Confirm **Are you sure you want to delete your order?**

Only **Open** orders without a job can be deleted. Deleted orders leave every list. The change log keeps a Delete entry.

## Other backlog actions

| Menu | Action | Rule |
| --- | --- | --- |
| **Warehouse ops** | **Unmerge order** | Merged orders only. Splits them back into the original orders. |
| **Warehouse ops** | **Resolve pick short** | Pick short status must be Open. Short lines are reallocated from other locations. |
| **Warehouse ops** | **Resolve pack short** | Pack short status must be Open. Unpacked units go back to the picked tote and the order returns to **Packing Started**. |
| **Delete** | **Remove serial number** | Removes every serial number in the order. |
| **Print** | **Picking list**, **Batch picking list**, **Packing slip**, **Manifest / BOL**, **Pick / pack short label** | Picking lists need an active picking task. |

## Bulk results

When some orders pass and some don't, a result window lists each skipped order with its reason. The title reads, for example, "Some orders couldn't be shipped".

## Related pages

- [Outbound order lifecycle and statuses](/docs/wms/outbound-order-lifecycle)
- [Shortages and backorders](/docs/wms/order-shortages-and-backorders)
- [Execute picking tasks and handle pick shorts](/docs/wms/pick-execute-picking-tasks)
