---
title: Shortages and backorders
description: Find orders that could not be fully allocated, see why in the Shortage report, retry allocation, and split the short quantity into a backorder.
section: Outbound
order: 40
---

An order goes to **Shortage** when allocation can't reserve every unit it needs. You can wait for stock and retry, or ship what you have now and move the rest to a backorder. The **Shortage report** lists every short line with the reason, so you can decide line by line.

## Before you start

- Allocation runs when a wave rule runs or when you use **Picking / job operations** on orders. See [Create and run wave rules](/docs/wms/wave-rules).
- You need permission to change orders to retry allocation or create backorders.

## Why an order is short

| Shortage reason | What it means |
| --- | --- |
| **Insufficient Inventory** | There is not enough free inventory in the warehouse to allocate this order line. |
| **No Eligible Stock Found** | Stock exists, but none of it is eligible for allocation: it is damaged, locked or in locations that prevent allocation. |

Allocation also follows the rules of the warehouse's allocation algorithm. A rule's inventory conditions can rule out stock that is otherwise free. Use **Dry run for order** to see which rule matched. See [Allocation algorithms and dry run](/docs/wms/allocation-algorithms).

## Open the Shortage report

1. Go to **Reports > Shortage Report**. It is also a tab under **Fulfillment > Job Management**.
2. Search by order code, or filter by **Shortage reason**, **Client**, **Status** or **Warehouse**.

| Column | What it shows |
| --- | --- |
| **Order code** and **Store order name** | The short order. |
| **SKU** and **Product name** | The short product. |
| **Shortage reason** | Insufficient Inventory or No Eligible Stock Found. |
| **Order line pack qty** and **Shortage pack qty** | What the line needs and what is missing. |
| **Free pack qty**, **Damaged pack qty**, **On hand pack qty** | Stock of the SKU right now. |
| **Last allocation trial time** | When allocation last tried. |
| **Order age** | Days since the order was created. |
| **Missing triggered** | A pick short reported the stock missing. |
| **Master order code** | The original order, when this order is a backorder. |

When nothing is short, the report shows **No shortages** and "Every open order line is fully allocated."

## Retry allocation

1. Select the short lines in the **Shortage Report**, or the rows in **Allocation exceptions**.
2. Select **Retry allocation**. The button shows how many orders it will try.

Orders that now find stock move to **Ready to Pick**. The rest stay in **Shortage**.

## Create a backorder from the Shortage report

1. Select the short lines.
2. Select **Create backorder**.
3. Confirm **Create backorders for 1 order?** (the count matches your selection) with **Create backorders**.

The short quantity moves to a new backorder. The original order keeps what is allocated and can ship now. Only orders in **Shortage** can be back-ordered.

## Create a backorder from the backlog

1. Go to **Fulfillment > Shipment Orders**.
2. Select the **Shortage** orders.
3. Open **Warehouse ops** and choose **Create backorder**.
4. Select **Merge into existing job** to add the order to a pending picking job, or **Create new job** to put it into a new one.

The allocated quantity stays on the original order and gets a picking job. The short quantity moves to a new back order that keeps the original as its master. An order is eligible only when it is in **Shortage** and something is already allocated. Otherwise the window explains "Nothing is allocated yet; allocate stock first."

## Find backorders

- The order page **Summary** card shows **Master order** on a backorder and **Backorders** on the original.
- Wave rule filters and job type conditions can use **Is back order** to handle backorders separately.

## Related pages

- [Outbound order lifecycle and statuses](/docs/wms/outbound-order-lifecycle)
- [Wave log and allocation exceptions](/docs/wms/wave-log-and-exceptions)
- [Hold, release, cancel and delete orders](/docs/wms/order-holds-and-cancellations)
